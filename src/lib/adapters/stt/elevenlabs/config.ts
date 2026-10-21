/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: scribeConfig, isScribeConfigured, SCRIBE_MODEL,
 *   ELEVENLABS_API_KEY, LAZY_CONFIG, CREDENTIAL_IS_FENCED,
 *   ONE_KEY_TWO_SEAMS
 *
 * WHAT:  Everything the Scribe aligner needs from the environment.
 *
 * WHY:   CREDENTIAL_IS_FENCED. `ELEVENLABS_API_KEY` may be read only inside
 *        the two adapter folders that talk to that vendor — the TTS one and
 *        this one — and eslint enforces it with a syntax rule rather than an
 *        import restriction, because both adapters use `fetch` and have no
 *        SDK to restrict.
 *
 *        ONE_KEY_TWO_SEAMS, and the duplication is deliberate rather than
 *        shared. This module does NOT import the TTS adapter's config: the
 *        two seams are selected independently (see ./provider.ts), and the
 *        realistic first change here is aligning with a different vendor
 *        while keeping the voices. A shared config module would have to be
 *        split again at exactly that moment, and in the meantime it would
 *        make the TTS adapter's module body run in a process that only ever
 *        aligns.
 *
 *        LAZY_CONFIG, matching every other provider here: nothing throws at
 *        import. Alignment is optional until somebody generates, and a
 *        module-scope throw would crash the setup checklist — the one screen
 *        whose job is to report which variables are missing.
 * WHERE: ./index.ts, on every request.
 */

import { assertSttProviderActive } from "../provider";

assertSttProviderActive("elevenlabs");

export const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

/**
 * SOURCE OF TRUTH KEYWORDS: DEFAULT_SCRIBE_MODEL
 *
 * The provider's alignment-capable transcription model. Overridable without
 * a deploy, because transcription models are retired on short notice — and
 * unlike the TTS seam there is no BACKUP model here: a second transcription
 * model is not a fallback for a bad alignment, it is a different set of
 * timings for the same audio. The fallback for a failed alignment is the
 * DEGRADE path, which is a product decision rather than a provider one.
 */
const DEFAULT_SCRIBE_MODEL = "scribe_v1";

export interface ScribeConfig {
  apiKey: string;
  model: string;
}

export function isScribeConfigured(): boolean {
  return Boolean(process.env["ELEVENLABS_API_KEY"]?.trim());
}

export function scribeConfig(): ScribeConfig {
  const apiKey = process.env["ELEVENLABS_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error(
      "[stt/elevenlabs] ELEVENLABS_API_KEY is not set. Caption alignment is unavailable until it is configured.",
    );
  }

  const model = process.env["ELEVENLABS_STT_MODEL"]?.trim() || DEFAULT_SCRIBE_MODEL;

  return { apiKey, model };
}
