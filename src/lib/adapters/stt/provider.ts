/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: STT_PROVIDER, sttSelector, assertSttProviderActive,
 *   DEFAULT_STT_PROVIDER
 *
 * WHAT:  Resolves which speech-to-text implementation is selected, once.
 * WHY:   Server-only and selected exactly like the jobs, storage, media,
 *        render, llm and tts seams — see src/lib/adapters/select-provider.ts
 *        for why these cannot share the auth machinery. No client half
 *        exists: a browser never aligns anything, it reads stored words.
 *
 *        It is a SEPARATE selector from the TTS one even though both default
 *        to the same vendor today. They are different products with different
 *        failure modes and different prices, and the realistic first swap is
 *        moving alignment to a cheaper aligner while keeping the voices —
 *        which one shared `ELEVENLABS_PROVIDER` switch would make impossible.
 * WHERE: Used by ./index.ts and asserted at module scope by ./elevenlabs.
 */

import { createProviderSelector } from "../select-provider";
import { STT_PROVIDER_IDS, type SttProviderId } from "./types";

export const DEFAULT_STT_PROVIDER: SttProviderId = "elevenlabs";

export const sttSelector = createProviderSelector<SttProviderId>({
  label: "stt",
  envVar: "STT_PROVIDER",
  rawValue: process.env["STT_PROVIDER"],
  ids: STT_PROVIDER_IDS,
  fallback: DEFAULT_STT_PROVIDER,
});

export const STT_PROVIDER: SttProviderId = sttSelector.provider;

export function assertSttProviderActive(id: SttProviderId): void {
  sttSelector.assertActive(id);
}
