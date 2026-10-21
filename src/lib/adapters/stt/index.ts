/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getSttAdapter, SttAdapter, PROVIDER_ISOLATION,
 *   dynamic import, STT_PROVIDER, ALIGNMENT_IS_A_SINGLE_POINT
 *
 * WHAT:  The only sanctioned way for app code to obtain word timings.
 * WHY:   The dynamic `import()` is the isolation guarantee, as in every other
 *        seam: the provider module — and the API key it reads — is never
 *        evaluated in a process that is not aligning, and can never reach a
 *        page bundle.
 *
 *        Call it from a WORKFLOW STEP, never from a router. An alignment is a
 *        provider round-trip per narration line with a bill attached, and a
 *        tRPC mutation runs inside a 10-second Prisma transaction.
 * WHERE: src/inngest/functions/project-align.ts, through
 *        src/services/alignment.service.ts.
 */

import "server-only";

import { STT_PROVIDER } from "./provider";
import type { SttAdapter } from "./types";

export type {
  HeardWord,
  SttAdapter,
  SttAlignArgs,
  SttProviderId,
} from "./types";
export { STT_PROVIDER_IDS, SttError } from "./types";
export { STT_PROVIDER, DEFAULT_STT_PROVIDER } from "./provider";

let adapterPromise: Promise<SttAdapter> | null = null;

async function loadAdapter(): Promise<SttAdapter> {
  /* Exhaustive over SttProviderId — a new id without a case here is a compile
   * error at the `never` branch. */
  switch (STT_PROVIDER) {
    case "elevenlabs": {
      const mod = await import("./elevenlabs");
      return mod.elevenLabsSttAdapter;
    }
    default: {
      const exhaustive: never = STT_PROVIDER;
      throw new Error(
        `[adapters/stt] No adapter registered for "${String(exhaustive)}".`,
      );
    }
  }
}

export async function getSttAdapter(): Promise<SttAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter();
  }
  return adapterPromise;
}
