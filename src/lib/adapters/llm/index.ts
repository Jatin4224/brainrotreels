/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getLlmAdapter, LlmAdapter, PROVIDER_ISOLATION,
 *   dynamic import, LLM_PROVIDER, SCHEMA_IS_THE_CONTRACT
 *
 * WHAT:  The only sanctioned way for app code to ask a language model for
 *        anything.
 * WHY:   The dynamic `import()` is the isolation guarantee, as in every other
 *        seam: the SDK is never evaluated in a process that is not generating,
 *        and — more importantly here — it can never reach a page bundle, which
 *        would put an API key in the browser.
 *
 *        Call it from a WORKFLOW STEP or a router, never from a component. A
 *        generation takes tens of seconds; a tRPC mutation runs inside a
 *        10-second Prisma transaction, so anything that generates a whole
 *        script belongs behind a job. The scripts router enqueues.
 * WHERE: src/lib/script/generate.ts.
 */

import "server-only";

import { LLM_PROVIDER } from "./provider";
import type { LlmAdapter } from "./types";

export type { LlmAdapter, LlmGenerateArgs, LlmProviderId } from "./types";
export { LLM_PROVIDER_IDS, LlmError } from "./types";
export { LLM_PROVIDER, DEFAULT_LLM_PROVIDER } from "./provider";

let adapterPromise: Promise<LlmAdapter> | null = null;

async function loadAdapter(): Promise<LlmAdapter> {
  /* Exhaustive over LlmProviderId — a new id without a case here is a compile
   * error at the `never` branch. */
  switch (LLM_PROVIDER) {
    case "anthropic": {
      const mod = await import("./anthropic");
      return mod.anthropicLlmAdapter;
    }
    default: {
      const exhaustive: never = LLM_PROVIDER;
      throw new Error(
        `[adapters/llm] No adapter registered for "${String(exhaustive)}".`,
      );
    }
  }
}

export async function getLlmAdapter(): Promise<LlmAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter();
  }
  return adapterPromise;
}
