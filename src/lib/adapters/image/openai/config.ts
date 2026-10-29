/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: imageModelConfig, isImageModelConfigured,
 *   IMAGE_API_BASE, DEFAULT_IMAGE_MODEL, PORTRAIT_SIZE,
 *   CREDENTIAL_IS_FENCED, LAZY_CONFIG, CREDENTIAL_IS_VENDOR_NEUTRAL,
 *   PORTRAIT_IS_THE_CLOSEST_OFFERED
 *
 * WHAT:  Everything the image client needs from the environment, and the
 *        output size it asks for.
 *
 * WHY:   CREDENTIAL_IS_FENCED. `IMAGE_API_KEY` may be read only inside this
 *        folder, and eslint enforces it with a SYNTAX rule rather than an
 *        import restriction — the same mechanism as `ELEVENLABS_API_KEY`,
 *        `REDDIT_CLIENT_SECRET` and `STOCK_API_KEY`, and for the same reason:
 *        this adapter uses `fetch` and has no SDK to restrict.
 *
 *        CREDENTIAL_IS_VENDOR_NEUTRAL, which is why the variable is
 *        `IMAGE_API_KEY` and not the vendor's name. The seam exists precisely
 *        because the commercial-rights question may move this product to a
 *        different model (COMMERCIAL_TERMS_ARE_THE_REASON_FOR_THE_SEAM), and an
 *        operator who switches providers should be changing `IMAGE_PROVIDER`
 *        and the value of one key — not editing a deployment's secret NAMES.
 *        `STOCK_API_KEY` is named the same way, by the phase itself.
 *
 *        PORTRAIT_IS_THE_CLOSEST_OFFERED, and it is worth being exact about
 *        because it is a compromise rather than a match. The contract asks for
 *        9:16 (0.5625); the model offers 2:3 (0.667) as its tallest portrait
 *        size. The ingest already produces a 9:16 master by cropping
 *        (CROP_AT_TRANSCODE), so asking for the tallest available and letting
 *        the transcode take the middle is strictly better than asking for a
 *        square and cropping away half the subject. A model that one day offers
 *        a true 9:16 is a one-line change here.
 *
 *        LAZY_CONFIG, matching every other provider: nothing throws at import.
 *        Image generation is OPTIONAL by design — the phase requires a video to
 *        complete with this seam unconfigured — so a module-scope throw would
 *        crash the setup checklist, the one screen whose job is to report which
 *        variables are missing.
 * WHERE: ./index.ts, on every generation.
 */

import { assertImageProviderActive } from "../provider";
import type { ImageGenerateOptions } from "../types";

assertImageProviderActive("openai");

export const IMAGE_API_BASE = "https://api.openai.com/v1";

/**
 * SOURCE OF TRUTH KEYWORDS: DEFAULT_IMAGE_MODEL, MODEL_IS_AN_OVERRIDE
 *
 * The model used unless `IMAGE_MODEL` names another. An env override exists
 * for the same reason `ANTHROPIC_MODEL` does: trading cost against quality
 * should not need a deploy.
 */
export const DEFAULT_IMAGE_MODEL = "gpt-image-1";

/**
 * SOURCE OF TRUTH KEYWORDS: SIZE_BY_ASPECT, PORTRAIT_IS_THE_CLOSEST_OFFERED
 *
 * The size asked for, per aspect the contract allows. A full `Record` over the
 * union rather than a constant, so a second aspect cannot ship without somebody
 * deciding what size it maps to — the same shape as `SAFE_ZONE_BY_ASPECT` and
 * `CANVAS_BY_ASPECT`. See PORTRAIT_IS_THE_CLOSEST_OFFERED in the file header
 * for why 9:16 maps to a 2:3 request.
 */
export const SIZE_BY_ASPECT: Readonly<Record<ImageGenerateOptions["aspect"], string>> =
  {
    "9:16": "1024x1536",
  };

/**
 * SOURCE OF TRUTH KEYWORDS: IMAGE_OUTPUT_FORMAT, PNG_IS_THE_INGEST_FRIENDLY_ONE
 *
 * PNG rather than WebP, because the ingest's own allowlist and its ffmpeg
 * variant plan are built around the formats a customer can upload, and PNG is
 * the one every one of those paths already handles. A format chosen for its
 * byte count would save bandwidth on a file that is transcoded immediately and
 * then never served.
 */
export const IMAGE_OUTPUT_FORMAT = "png";
export const IMAGE_CONTENT_TYPE = "image/png";

export interface ImageModelConfig {
  apiKey: string;
  model: string;
}

export function isImageModelConfigured(): boolean {
  return Boolean(process.env["IMAGE_API_KEY"]?.trim());
}

export function imageModelConfig(): ImageModelConfig {
  const apiKey = process.env["IMAGE_API_KEY"]?.trim();

  if (!apiKey) {
    throw new Error(
      "[image/openai] IMAGE_API_KEY is not set. Image generation is unavailable " +
        "until it is configured, and blocks with no stock match fall back to the styled backdrop.",
    );
  }

  const configured = process.env["IMAGE_MODEL"]?.trim();

  return {
    apiKey,
    model:
      configured !== undefined && configured.length > 0
        ? configured
        : DEFAULT_IMAGE_MODEL,
  };
}
