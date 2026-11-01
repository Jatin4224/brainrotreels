/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: replicateVideoAdapter, PROVIDER_ISOLATION,
 *   VideoError, PREDICTIONS_ARE_START_AND_POLL, STATUS_IS_MAPPED_NOT_PASSED,
 *   REFUSED_IS_NOT_FAILED, NO_PREFER_WAIT, THE_OUTPUT_SHAPE_VARIES_BY_MODEL
 *
 * WHAT:  The Replicate implementation of the video seam, over plain `fetch`.
 *
 * WHY:   PREDICTIONS_ARE_START_AND_POLL. Replicate's API is a near-exact match
 *        for this seam's shape: `POST /predictions` returns immediately with
 *        an id and a status, and `GET /predictions/{id}` reports progress. So
 *        `start` and `poll` map one-to-one and there is nothing to invent.
 *
 *        NO_PREFER_WAIT. Replicate offers a `Prefer: wait` header that holds
 *        the connection until the prediction finishes, and this adapter
 *        deliberately does not use it. It is the same mistake the phase file
 *        warns about — "polling inside one step times out" — moved to the
 *        provider: a held connection inside a workflow step is still a step
 *        that cannot outlive its own timeout, and video generations run for
 *        minutes.
 *
 *        NO SDK, for the reason the MCP server gives at more length: this uses
 *        two endpoints with JSON bodies, and `fetch` is already how every
 *        other HTTP provider in this codebase is called. A client library
 *        would be a dependency with a moving API for twenty lines of request
 *        construction.
 *
 *        STATUS_IS_MAPPED_NOT_PASSED. Replicate reports `starting`, `processing`,
 *        `succeeded`, `failed` and `canceled`; the seam has three states. The
 *        collapse happens HERE, inside the provider folder, which is what
 *        keeps the workflow's branching stable across a provider swap.
 *
 *        REFUSED_IS_NOT_FAILED. A prediction that failed because the provider
 *        declined the prompt is reported as `refused`, which the caller must
 *        not retry. Replicate does not give a machine-readable refusal code,
 *        so this reads the error TEXT — which is fragile and is written down
 *        as such: the cost of a miss is one wasted retry, not a wrong answer,
 *        because the generation failed either way. It is EXPORTED for a test
 *        precisely because it is a heuristic: its boundaries are the only part
 *        of this folder that can be checked without a provider, and a
 *        heuristic nobody pinned down drifts.
 *
 *        THE_OUTPUT_SHAPE_VARIES_BY_MODEL. Video models on Replicate return
 *        either a URL string or an array of them, and which one is a property
 *        of the model rather than of the API. Both are accepted and anything
 *        else is `failed` with the shape in the detail, because a model
 *        returning something unexpected is a configuration mistake somebody
 *        has to see rather than a crash in a workflow step.
 * WHERE: Loaded by ../index.ts through a dynamic import.
 */

import "server-only";

import { assertVideoProviderActive } from "../provider";
import {
  VideoError,
  type VideoAdapter,
  type VideoGenerateArgs,
  type VideoPollResult,
  type VideoStartResult,
} from "../types";
import {
  REPLICATE_API_BASE,
  isVideoModelConfigured,
  videoModelConfig,
} from "./config";

/* Fails loudly at module scope if this folder was loaded while another
 * provider is selected — the same guard every other provider folder has. */
assertVideoProviderActive("replicate");

/* A start or a poll is a small JSON round trip. If one has not answered in
 * this long the provider is not answering, and the workflow's own retry is a
 * better move than waiting inside a step. */
const REQUEST_TIMEOUT_MS = 30_000;

export const replicateVideoAdapter: VideoAdapter = {
  id: "replicate",

  get configured(): boolean {
    return isVideoModelConfigured();
  },

  async start(args: VideoGenerateArgs): Promise<VideoStartResult> {
    const config = videoModelConfig();

    const response = await request({
      apiKey: config.apiKey,
      method: "POST",
      path: `/models/${config.model}/predictions`,
      body: {
        input: {
          prompt: args.prompt,
          /* ASPECT_IS_NOT_A_SUGGESTION. Sent as the provider's own parameter
           * name; a model that ignores it produces the wrong shape, which is a
           * model configuration problem rather than something to paper over
           * by cropping afterwards. */
          aspect_ratio: "9:16",
          duration: args.durationSec,
        },
      },
    });

    const id = readString(response, "id");
    if (id === null) {
      throw new VideoError(
        "failed",
        "The video provider accepted the request but did not say what it was working on.",
        `[video/replicate] start returned no id: ${preview(response)}`,
      );
    }

    return { jobId: id };
  },

  async poll(jobId: string): Promise<VideoPollResult> {
    const config = videoModelConfig();

    const response = await request({
      apiKey: config.apiKey,
      method: "GET",
      path: `/predictions/${encodeURIComponent(jobId)}`,
    });

    const status = readString(response, "status");

    /* STATUS_IS_MAPPED_NOT_PASSED — the provider's five states become three. */
    if (status === "starting" || status === "processing") {
      return {
        status: "pending",
        url: null,
        modelVersion: null,
        durationSec: null,
        error: null,
      };
    }

    if (status === "succeeded") {
      const url = readOutputUrl(response);
      if (url === null) {
        return {
          status: "failed",
          url: null,
          modelVersion: null,
          durationSec: null,
          error:
            "The model finished but returned nothing we could download. This is a configuration problem, not something you did.",
        };
      }

      return {
        status: "completed",
        url,
        /* MODEL_VERSION_IS_RETURNED_NOT_ASSUMED — Replicate's immutable
         * version hash, which is exactly what the audit column means. Falls
         * back to the model NAME rather than null, because "which model made
         * this" is better answered imprecisely than not at all. */
        modelVersion: readString(response, "version") ?? config.model,
        /* Not reported by Replicate, so the caller keeps what it asked for.
         * Null rather than a guess: a wrong duration on the asset would
         * mis-time every timeline that used the clip. */
        durationSec: null,
        error: null,
      };
    }

    /* `failed`, `canceled`, or something new. All terminal. */
    const detail = readString(response, "error") ?? "";
    return {
      status: "failed",
      url: null,
      modelVersion: null,
      durationSec: null,
      error:
        detail.length > 0
          ? detail
          : "The video model could not produce this clip.",
    };
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: request, VideoError, STATUS_CODES_ARE_MAPPED
 *
 * WHAT:  One JSON round trip, with every documented failure turned into a
 *        `VideoError` the caller can branch on.
 * WHY:   The status mapping is the whole reason this is a function rather than
 *        two inline fetches: `transient` decides whether the workflow retries,
 *        and getting a 429 wrong means either hammering a rate-limited
 *        provider or giving up on a blip. A 402 is mapped to `refused` because
 *        it means the PROVIDER's billing, which no retry of ours will fix.
 * WHERE: Both methods above.
 */
async function request(args: {
  apiKey: string;
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  let response: Response;

  try {
    response = await fetch(`${REPLICATE_API_BASE}${args.path}`, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      ...(args.body === undefined
        ? {}
        : { body: JSON.stringify(args.body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    /* A network failure or our own timeout. Both are worth retrying. */
    throw new VideoError(
      "unavailable",
      "The video provider could not be reached. This usually clears on its own.",
      `[video/replicate] ${args.method} ${args.path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw toProviderError(response.status, text, args.path);
  }

  const parsed: unknown = await response.json().catch(() => null);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new VideoError(
      "failed",
      "The video provider returned something we could not read.",
      `[video/replicate] ${args.method} ${args.path}: body was not a JSON object.`,
    );
  }

  return { ...parsed };
}

function toProviderError(
  status: number,
  body: string,
  path: string,
): VideoError {
  const detail = `[video/replicate] ${path} responded ${status}: ${body.slice(0, 300)}`;

  if (status === 401 || status === 403) {
    return new VideoError(
      "unauthorized",
      "Footage generation is not configured correctly. This is on our side.",
      detail,
    );
  }

  if (status === 429) {
    return new VideoError(
      "rate_limited",
      "The video provider is busy. Try again shortly.",
      detail,
    );
  }

  /* 402 is the provider's own billing, which no retry of ours fixes, and 422
   * is a prompt or parameter it will not accept — both are answers rather than
   * outages, so neither is transient. */
  if (status === 402 || status === 422 || looksLikeRefusal(body)) {
    return new VideoError(
      "refused",
      "The video model would not generate this clip. Try describing it differently.",
      detail,
    );
  }

  if (status >= 500) {
    return new VideoError(
      "unavailable",
      "The video provider is having trouble. This usually clears on its own.",
      detail,
    );
  }

  return new VideoError(
    "failed",
    "The video model could not produce this clip.",
    detail,
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: looksLikeRefusal, REFUSED_IS_NOT_FAILED
 *
 * WHAT:  Whether a provider error reads like a safety decline.
 * WHY:   Replicate has no machine-readable refusal code, so this reads the
 *        TEXT, which is fragile and is written down as such. The cost of a
 *        miss is bounded: a refusal read as a failure costs one pointless
 *        retry, and a failure read as a refusal costs a retry we would
 *        probably have lost anyway. What it buys is a customer being told to
 *        reword rather than being told to try again forever.
 * WHERE: toProviderError.
 */
export function looksLikeRefusal(body: string): boolean {
  const text = body.toLowerCase();
  return (
    text.includes("safety") ||
    text.includes("content policy") ||
    text.includes("flagged") ||
    text.includes("nsfw")
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: readOutputUrl, THE_OUTPUT_SHAPE_VARIES_BY_MODEL
 *
 * WHAT:  The clip's URL, however this model chose to report it.
 * WHY:   See THE_OUTPUT_SHAPE_VARIES_BY_MODEL. A string and a one-element
 *        array are both normal; the first element is taken because this seam
 *        asks for one clip and a model returning several has produced variants
 *        nobody asked for.
 * WHERE: poll.
 */
export function readOutputUrl(response: Record<string, unknown>): string | null {
  const output = response["output"];

  if (typeof output === "string" && output.length > 0) return output;

  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === "string" && first.length > 0) return first;
  }

  return null;
}

function readString(
  response: Record<string, unknown>,
  key: string,
): string | null {
  const value = response[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/* Enough of a body to debug with, short enough for a log line. */
function preview(response: Record<string, unknown>): string {
  return JSON.stringify(response).slice(0, 300);
}
