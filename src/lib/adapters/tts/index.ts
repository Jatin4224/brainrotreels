/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getTtsAdapter, TtsAdapter, PROVIDER_ISOLATION,
 *   dynamic import, TTS_PROVIDER, BACKUP_MODEL_INSIDE_THE_ADAPTER
 *
 * WHAT:  The only sanctioned way for app code to synthesise speech.
 * WHY:   The dynamic `import()` is the isolation guarantee, as in every other
 *        seam: the provider module — and the API key it reads — is never
 *        evaluated in a process that is not synthesising, and can never reach
 *        a page bundle.
 *
 *        Call it from a WORKFLOW STEP, never from a router. A synthesis is a
 *        provider round-trip with a bill attached, and a tRPC mutation runs
 *        inside a 10-second Prisma transaction; a script of thirty lines is
 *        thirty of those.
 * WHERE: src/inngest/functions/project-tts.ts and line-resynth.ts.
 */

import "server-only";

import { TTS_PROVIDER } from "./provider";
import type { TtsAdapter } from "./types";

export type {
  TtsAdapter,
  TtsCatalogueVoice,
  TtsProviderId,
  TtsResult,
  TtsSynthesizeArgs,
} from "./types";
export { TTS_PROVIDER_IDS, TtsError } from "./types";
export { TTS_PROVIDER, DEFAULT_TTS_PROVIDER } from "./provider";

let adapterPromise: Promise<TtsAdapter> | null = null;

async function loadAdapter(): Promise<TtsAdapter> {
  /* Exhaustive over TtsProviderId — a new id without a case here is a compile
   * error at the `never` branch. */
  switch (TTS_PROVIDER) {
    case "elevenlabs": {
      const mod = await import("./elevenlabs");
      return mod.elevenLabsTtsAdapter;
    }
    default: {
      const exhaustive: never = TTS_PROVIDER;
      throw new Error(
        `[adapters/tts] No adapter registered for "${String(exhaustive)}".`,
      );
    }
  }
}

export async function getTtsAdapter(): Promise<TtsAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter();
  }
  return adapterPromise;
}
