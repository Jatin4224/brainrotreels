/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MEDIA_PROVIDER, mediaSelector,
 *   assertMediaProviderActive, DEFAULT_MEDIA_PROVIDER
 *
 * WHAT:  Resolves which media-processing implementation is selected, once.
 * WHY:   Server-only and selected exactly like the jobs and storage seams — see
 *        src/lib/adapters/select-provider.ts for why these cannot share the
 *        auth machinery. No client half exists: a browser never transcodes
 *        anything, it uploads bytes and reads a signed URL.
 * WHERE: Used by ./index.ts and asserted at module scope by ./ffmpeg.
 */

import { createProviderSelector } from "../select-provider";
import { MEDIA_PROVIDER_IDS, type MediaProviderId } from "./types";

export const DEFAULT_MEDIA_PROVIDER: MediaProviderId = "ffmpeg";

export const mediaSelector = createProviderSelector<MediaProviderId>({
  label: "media",
  envVar: "MEDIA_PROVIDER",
  rawValue: process.env["MEDIA_PROVIDER"],
  ids: MEDIA_PROVIDER_IDS,
  fallback: DEFAULT_MEDIA_PROVIDER,
});

export const MEDIA_PROVIDER: MediaProviderId = mediaSelector.provider;

export function assertMediaProviderActive(id: MediaProviderId): void {
  mediaSelector.assertActive(id);
}
