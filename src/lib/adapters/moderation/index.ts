/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getModerationAdapter, ModerationAdapter,
 *   PROVIDER_ISOLATION, dynamic import, MODERATION_PROVIDER,
 *   THIS_SEAM_FAILS_CLOSED, ONE_CALLER_ONLY
 *
 * WHAT:  The only sanctioned way to obtain a content classifier.
 *
 * WHY:   The dynamic `import()` is the isolation guarantee, as in every other
 *        seam: an unselected provider's module is never evaluated.
 *
 *        ONE_CALLER_ONLY, and this seam is stricter about it than the others.
 *        Call it from `src/services/moderation.service.ts` and nowhere else —
 *        not from a router, not from a workflow step, not from a component.
 *        That is not style: the service is where THIS_SEAM_FAILS_CLOSED is
 *        implemented, where the `ModerationRecord` is written, and where the
 *        verdict becomes a customer-facing sentence. A caller that reached
 *        past it would be a caller that can forget to block on a thrown error,
 *        forget to record the decision, or invent its own refusal copy — and
 *        the first of those three is a silent hole in the safety layer rather
 *        than a bug anybody notices.
 * WHERE: src/services/moderation.service.ts.
 */

import "server-only";

import { MODERATION_PROVIDER } from "./provider";
import type { ModerationAdapter } from "./types";

export type {
  ModerationAdapter,
  ModerationClassifyArgs,
  ModerationContext,
  ModerationProviderId,
  ModerationVerdict,
} from "./types";
export { MODERATION_PROVIDER_IDS, ModerationError } from "./types";
export { MODERATION_PROVIDER, DEFAULT_MODERATION_PROVIDER } from "./provider";

let adapterPromise: Promise<ModerationAdapter> | null = null;

async function loadAdapter(): Promise<ModerationAdapter> {
  /* Exhaustive over ModerationProviderId — a new id without a case here is a
   * compile error at the `never` branch, so a classifier cannot be
   * unreachable. */
  switch (MODERATION_PROVIDER) {
    case "claude": {
      const mod = await import("./claude");
      return mod.claudeModerationAdapter;
    }
    default: {
      const exhaustive: never = MODERATION_PROVIDER;
      throw new Error(
        `[adapters/moderation] No adapter registered for "${String(exhaustive)}".`,
      );
    }
  }
}

export async function getModerationAdapter(): Promise<ModerationAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter();
  }
  return adapterPromise;
}
