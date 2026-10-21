/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: TTS_PROVIDER, ttsSelector, assertTtsProviderActive,
 *   DEFAULT_TTS_PROVIDER
 *
 * WHAT:  Resolves which text-to-speech implementation is selected, once.
 * WHY:   Server-only and selected exactly like the jobs, storage, media,
 *        render and llm seams — see src/lib/adapters/select-provider.ts for
 *        why these cannot share the auth machinery. No client half exists: a
 *        browser never synthesises anything, it plays a signed URL.
 * WHERE: Used by ./index.ts and asserted at module scope by ./elevenlabs.
 */

import { createProviderSelector } from "../select-provider";
import { TTS_PROVIDER_IDS, type TtsProviderId } from "./types";

export const DEFAULT_TTS_PROVIDER: TtsProviderId = "elevenlabs";

export const ttsSelector = createProviderSelector<TtsProviderId>({
  label: "tts",
  envVar: "TTS_PROVIDER",
  rawValue: process.env["TTS_PROVIDER"],
  ids: TTS_PROVIDER_IDS,
  fallback: DEFAULT_TTS_PROVIDER,
});

export const TTS_PROVIDER: TtsProviderId = ttsSelector.provider;

export function assertTtsProviderActive(id: TtsProviderId): void {
  ttsSelector.assertActive(id);
}
