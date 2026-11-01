/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getVideoAdapter, VideoAdapter, PROVIDER_ISOLATION,
 *   dynamic import, VIDEO_PROVIDER, START_AND_POLL_NOT_GENERATE
 *
 * WHAT:  The only sanctioned way for app code to ask a video model for a clip.
 *
 * WHY:   The dynamic `import()` is the isolation guarantee, as in every other
 *        seam: the provider SDK — here a plain `fetch` client, but the rule
 *        holds — is never evaluated in a process that is not generating, and
 *        can never reach a page bundle, which would put a credential in the
 *        browser.
 *
 *        Call it from a WORKFLOW STEP, never from a router or a component. A
 *        generation takes MINUTES; a tRPC mutation runs inside a short
 *        transaction, so anything that waits for a clip belongs behind a job.
 *        The footage router enqueues. Grep START_AND_POLL_NOT_GENERATE for why
 *        the waiting is split across steps rather than awaited.
 * WHERE: src/inngest/functions/footage-generate.ts.
 */

import "server-only";

import { VIDEO_PROVIDER } from "./provider";
import type { VideoAdapter } from "./types";

export type {
  VideoAdapter,
  VideoGenerateArgs,
  VideoPollResult,
  VideoProviderId,
  VideoStartResult,
} from "./types";
export { VIDEO_FETCH_ERRORS, VIDEO_PROVIDER_IDS, VideoError } from "./types";
export { VIDEO_PROVIDER, DEFAULT_VIDEO_PROVIDER } from "./provider";

let adapterPromise: Promise<VideoAdapter> | null = null;

async function loadAdapter(): Promise<VideoAdapter> {
  /* Exhaustive over VideoProviderId — a new id without a case here is a
   * compile error at the `never` branch. */
  switch (VIDEO_PROVIDER) {
    case "replicate": {
      const mod = await import("./replicate");
      return mod.replicateVideoAdapter;
    }
    default: {
      const exhaustive: never = VIDEO_PROVIDER;
      throw new Error(
        `[adapters/video] No adapter registered for "${String(exhaustive)}".`,
      );
    }
  }
}

export async function getVideoAdapter(): Promise<VideoAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter();
  }
  return adapterPromise;
}
