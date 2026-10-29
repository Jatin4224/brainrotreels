/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: IMAGE_PROVIDER, imageSelector,
 *   assertImageProviderActive, DEFAULT_IMAGE_PROVIDER,
 *   COMMERCIAL_TERMS_ARE_THE_REASON_FOR_THE_SEAM
 *
 * WHAT:  Resolves which image model is selected, once.
 *
 * WHY:   Selected exactly like the jobs, storage, media, render, llm, tts, stt,
 *        moderation, reddit and stock seams — see
 *        src/lib/adapters/select-provider.ts for why these cannot share the
 *        auth machinery.
 *
 *        COMMERCIAL_TERMS_ARE_THE_REASON_FOR_THE_SEAM, and it is a stronger
 *        reason here than for most of the others. Image models differ on the
 *        one question this product cannot be wrong about: whether the customer
 *        owns commercial rights to the output. `ASSET_SOURCES` in
 *        src/lib/types/asset.ts already records that as an open owner decision
 *        for generated media. When it is settled, the answer may well be "that
 *        provider and not this one" — and a seam is what makes that a one-line
 *        env change rather than a rewrite of the visuals pipeline.
 * WHERE: Used by ./index.ts and asserted at module scope by ./openai.
 */

import { createProviderSelector } from "../select-provider";
import { IMAGE_PROVIDER_IDS, type ImageProviderId } from "./types";

export const DEFAULT_IMAGE_PROVIDER: ImageProviderId = "openai";

export const imageSelector = createProviderSelector<ImageProviderId>({
  label: "image",
  envVar: "IMAGE_PROVIDER",
  rawValue: process.env["IMAGE_PROVIDER"],
  ids: IMAGE_PROVIDER_IDS,
  fallback: DEFAULT_IMAGE_PROVIDER,
});

export const IMAGE_PROVIDER: ImageProviderId = imageSelector.provider;

export function assertImageProviderActive(id: ImageProviderId): void {
  imageSelector.assertActive(id);
}
