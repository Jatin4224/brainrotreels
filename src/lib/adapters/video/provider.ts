/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: VIDEO_PROVIDER, DEFAULT_VIDEO_PROVIDER,
 *   videoSelector, assertVideoProviderActive, PROVIDER_IS_AN_ENV_CHOICE,
 *   THE_TERMS_DECIDE_THE_PROVIDER
 *
 * WHAT:  Which video provider this deployment talks to.
 *
 * WHY:   PROVIDER_IS_AN_ENV_CHOICE, through the same selector every other seam
 *        uses, so an unrecognised value fails loudly at module scope rather
 *        than silently falling back in production.
 *
 *        THE_TERMS_DECIDE_THE_PROVIDER, and this is the open question the
 *        phase was built against. `docs/phases/17-platform-surface.md` is
 *        blunt: "confirm the chosen model's terms permit commercial use before
 *        building on it — ask the owner, do not assume", and that decision has
 *        not been made. Replicate is implemented because it had the stronger
 *        reason on the one axis the phase file DOES specify — step 4 requires
 *        storing `modelVersion` for the audit trail, and Replicate's API is
 *        built around immutable version hashes, so what we record is exact
 *        rather than a label that may have moved.
 *
 *        That is a reason to implement it FIRST, not a reason it is the right
 *        answer: when the terms are settled the answer may well be a different
 *        provider, and this seam is what makes that a folder and an env var
 *        rather than a rewrite of the footage pipeline. The same sentence the
 *        image seam's provider file carries, and for the same open decision.
 * WHERE: Used by ./index.ts and asserted at module scope by ./replicate.
 */

import { createProviderSelector } from "../select-provider";
import { VIDEO_PROVIDER_IDS, type VideoProviderId } from "./types";

export const DEFAULT_VIDEO_PROVIDER: VideoProviderId = "replicate";

export const videoSelector = createProviderSelector<VideoProviderId>({
  label: "video",
  envVar: "VIDEO_PROVIDER",
  rawValue: process.env["VIDEO_PROVIDER"],
  ids: VIDEO_PROVIDER_IDS,
  fallback: DEFAULT_VIDEO_PROVIDER,
});

export const VIDEO_PROVIDER: VideoProviderId = videoSelector.provider;

export function assertVideoProviderActive(id: VideoProviderId): void {
  videoSelector.assertActive(id);
}
