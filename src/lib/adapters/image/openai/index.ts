/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: openaiImageAdapter, generate,
 *   RESPONSE_SHAPE_IS_PARSED, REFUSAL_IS_READ_FROM_THE_STATUS,
 *   BYTES_NOT_A_URL, GENERATION_IS_SLOW_SO_THE_TIMEOUT_IS_LONG,
 *   NO_UNBOUNDED_PROVIDER_CALL
 *
 * WHAT:  The image-model implementation of ImageAdapter: one prompt in, one
 *        vertical PNG and the model version that drew it out.
 *
 * WHY:   BYTES_NOT_A_URL. The request asks for base64 rather than a hosted
 *        URL, which is what the phase's step 5 requires — the bytes go through
 *        `asset.ingest` into our own bucket, and "never reference a provider's
 *        hotlink from a timeline" because the URL will rot and the render will
 *        fail months later for no visible reason. A hosted URL would also mean
 *        a second fetch, from a host that would then need its own allowlist
 *        entry.
 *
 *        REFUSAL_IS_READ_FROM_THE_STATUS. A content refusal comes back as a
 *        400 with a machine-readable code, not as an empty success, and it is
 *        mapped to `refused` rather than to `unavailable` — see
 *        REFUSAL_IS_ITS_OWN_CASE in ../types.ts for why that distinction is
 *        worth a union member. Everything else about a 400 is our own request
 *        being wrong, which is permanent and belongs in a log rather than in
 *        front of a customer.
 *
 *        GENERATION_IS_SLOW_SO_THE_TIMEOUT_IS_LONG. An image takes tens of
 *        seconds, not the single-digit seconds a search or a thread fetch
 *        takes, so the bound here is far wider than in the other adapters —
 *        and it is still a bound, because NO_UNBOUNDED_PROVIDER_CALL holds
 *        everywhere. This runs inside a workflow step, which is the only place
 *        a wait that long is acceptable.
 *
 *        RESPONSE_SHAPE_IS_PARSED, as everywhere: a zod parse rather than
 *        `json.data[0].b64_json`, so a changed response is a readable refusal
 *        instead of a TypeError inside a step.
 * WHERE: Loaded by ../index.ts through a dynamic import.
 */

import "server-only";

import { z } from "zod";

import {
  ImageError,
  type ImageAdapter,
  type ImageGenerateOptions,
  type ImageGenerateResult,
} from "../types";
import {
  IMAGE_API_BASE,
  IMAGE_CONTENT_TYPE,
  IMAGE_OUTPUT_FORMAT,
  SIZE_BY_ASPECT,
  imageModelConfig,
  isImageModelConfigured,
} from "./config";

/** See GENERATION_IS_SLOW_SO_THE_TIMEOUT_IS_LONG in the file header. */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * SOURCE OF TRUTH KEYWORDS: generateResponseSchema, RESPONSE_SHAPE_IS_PARSED
 *
 * Only the fields used. `model` is optional because not every provider echoes
 * it; the configured name is the fallback, and the comment on
 * MODEL_VERSION_IS_RETURNED_NOT_ASSUMED explains why the echoed one is
 * preferred when it is there.
 */
const generateResponseSchema = z.object({
  model: z.string().optional(),
  data: z
    .array(z.object({ b64_json: z.string().optional() }))
    .min(1),
});

/* The provider's own error envelope, which carries the refusal code. */
const errorResponseSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      code: z.string().nullish(),
      type: z.string().nullish(),
    })
    .optional(),
});

export const openaiImageAdapter: ImageAdapter = {
  id: "openai",

  /* Read at module scope rather than per call: the key does not appear while a
   * process is running, and `configured` is checked per block of every script
   * (NOT_CONFIGURED_IS_A_CASE). */
  configured: isImageModelConfigured(),

  async generate(
    prompt: string,
    opts: ImageGenerateOptions,
  ): Promise<ImageGenerateResult> {
    if (!isImageModelConfigured()) {
      throw new ImageError(
        "not_configured",
        "Image generation is not available on this deployment.",
        "IMAGE_API_KEY is not set",
      );
    }

    const config = imageModelConfig();

    /* Mapped rather than hard-coded, so a second aspect cannot ship without a
     * size — see SIZE_BY_ASPECT and PORTRAIT_IS_THE_CLOSEST_OFFERED. */
    const size = SIZE_BY_ASPECT[opts.aspect];

    const response = await withTimeout((signal) =>
      fetch(`${IMAGE_API_BASE}/images/generations`, {
        method: "POST",
        signal,
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          prompt,
          n: 1,
          size,
          output_format: IMAGE_OUTPUT_FORMAT,
        }),
      }),
    );

    if (!response.ok) {
      throw await errorForStatus(response, config.model);
    }

    const parsed = generateResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ImageError(
        "unavailable",
        "The image could not be generated. Try again in a moment.",
        `response did not parse: ${parsed.error.message}`,
      );
    }

    const encoded = parsed.data.data[0]?.b64_json;
    if (encoded === undefined || encoded.length === 0) {
      /* A success with no image. Treated as unavailable rather than refused:
       * a refusal arrives as a 400 with a code, and guessing that an empty
       * payload means a policy block would mislabel an outage. */
      throw new ImageError(
        "unavailable",
        "The image could not be generated. Try again in a moment.",
        "response carried no image data",
      );
    }

    return {
      image: Buffer.from(encoded, "base64"),
      /* MODEL_VERSION_IS_RETURNED_NOT_ASSUMED — the served model when the
       * provider states it, our request when it does not. */
      modelVersion: parsed.data.model ?? config.model,
      contentType: IMAGE_CONTENT_TYPE,
    };
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: errorForStatus, REFUSAL_IS_READ_FROM_THE_STATUS
 *
 * WHAT:  The status code and error envelope as one of the union's members.
 * WHY:   The 400 is the interesting one: a malformed request and a refused
 *        prompt share it, and only the body's `code` tells them apart. Reading
 *        it is worth the parse, because the two lead to completely different
 *        places — one to an operator's logs and one to a sentence the customer
 *        can act on.
 * WHERE: `generate`, on any non-ok response.
 */
async function errorForStatus(
  response: Response,
  model: string,
): Promise<ImageError> {
  const detail = `${response.status} ${response.statusText} (model ${model})`;

  const body = await response
    .json()
    .then((value: unknown) => errorResponseSchema.safeParse(value))
    .catch(() => null);

  const code = body?.success === true ? (body.data.error?.code ?? "") : "";
  const message = body?.success === true ? (body.data.error?.message ?? "") : "";

  if (response.status === 429) {
    return new ImageError(
      "rate_limited",
      "The image model is busy. Try again in a moment.",
      detail,
    );
  }

  if (response.status === 401 || response.status === 403) {
    return new ImageError(
      "not_configured",
      "Image generation is not available on this deployment.",
      `${detail} — the key was refused`,
    );
  }

  if (
    response.status === 400 &&
    (code.includes("moderation") ||
      code.includes("content_policy") ||
      message.toLowerCase().includes("safety system"))
  ) {
    return new ImageError(
      "refused",
      "The image model would not draw this. Try describing the shot differently, or pick a stock clip instead.",
      `${detail} code=${code || "none"}`,
    );
  }

  if (response.status >= 400 && response.status < 500) {
    return new ImageError(
      "unavailable",
      "The image could not be generated.",
      `${detail} code=${code || "none"} message=${message}`,
    );
  }

  return new ImageError(
    "unavailable",
    "The image model is unavailable. Try again in a moment.",
    detail,
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: withTimeout, NO_UNBOUNDED_PROVIDER_CALL
 *
 * Bounded, like every other provider call here — see the file header for why
 * the bound is so much wider than the other adapters'.
 */
async function withTimeout(
  run: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ImageError(
        "rate_limited",
        "The image model took too long. Try again in a moment.",
        `request timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );
    }
    throw new ImageError(
      "unavailable",
      "The image model is unavailable. Try again in a moment.",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}
