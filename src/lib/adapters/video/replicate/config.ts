/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: videoModelConfig, isVideoModelConfigured,
 *   VIDEO_API_KEY, VIDEO_MODEL, DEFAULT_VIDEO_MODEL, LAZY_CONFIG,
 *   THE_MODEL_IS_NOT_PINNED_IN_CODE
 *
 * WHAT:  The credential and the model this deployment generates with.
 *
 * WHY:   LAZY_CONFIG, as in every other provider folder: read when used rather
 *        than at import, so a deployment with no video credential boots
 *        normally and the feature reports itself unavailable instead of
 *        crashing the process.
 *
 *        THE_MODEL_IS_NOT_PINNED_IN_CODE. The default below is a MODEL NAME,
 *        and which model to run is an owner decision this phase was
 *        deliberately built around rather than through — it depends on
 *        commercial-use terms nobody has settled yet. Putting it in an env var
 *        means changing it is a deploy, not a release, which is what you want
 *        for a choice that may be made on legal advice.
 *
 *        Replicate resolves a model name to an immutable VERSION and returns
 *        it on the prediction, which is what the asset's `modelVersion` column
 *        records (MODEL_VERSION_IS_RETURNED_NOT_ASSUMED). So pinning a version
 *        here would be belt and braces against a provider that already tells
 *        us exactly what it ran.
 * WHERE: ./index.ts.
 */

import "server-only";

/**
 * SOURCE OF TRUTH KEYWORDS: DEFAULT_VIDEO_MODEL, THE_DEFAULT_IS_A_PLACEHOLDER
 *
 * THE_DEFAULT_IS_A_PLACEHOLDER, and deliberately a conservative one. The model
 * that ships is an owner decision gated on commercial-use terms, so this
 * constant exists to make the env var optional in development rather than to
 * assert that this is the right model. Set `VIDEO_MODEL` to whatever the terms
 * permit before the feature is enabled on a paying plan.
 */
const DEFAULT_VIDEO_MODEL = "minimax/video-01";

/** Replicate's REST base. Versioned by path, so this is stable. */
export const REPLICATE_API_BASE = "https://api.replicate.com/v1";

export interface VideoModelConfig {
  apiKey: string;
  model: string;
}

export function isVideoModelConfigured(): boolean {
  return Boolean(process.env["VIDEO_API_KEY"]?.trim());
}

export function videoModelConfig(): VideoModelConfig {
  const apiKey = process.env["VIDEO_API_KEY"]?.trim();

  if (!apiKey) {
    throw new Error(
      "[video/replicate] VIDEO_API_KEY is not set. Footage generation is " +
        "unavailable until it is configured; the screen says so rather than failing a job.",
    );
  }

  const configured = process.env["VIDEO_MODEL"]?.trim();

  return {
    apiKey,
    model:
      configured !== undefined && configured.length > 0
        ? configured
        : DEFAULT_VIDEO_MODEL,
  };
}
