/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getMediaAdapter, MediaAdapter, PROVIDER_ISOLATION,
 *   dynamic import, MEDIA_PROVIDER, FFMPEG_RUNS_IN_A_CONTAINER
 *
 * WHAT:  The only sanctioned way for app code to inspect or transcode media.
 * WHY:   The dynamic `import()` is the isolation guarantee, exactly as in the
 *        jobs and storage seams: the implementation — and therefore
 *        node:child_process — is never evaluated in a process that does not
 *        process media, so nothing about it can reach a page bundle.
 *        Where the work runs is recorded in ./types.ts under
 *        FFMPEG_RUNS_IN_A_CONTAINER. Read it before calling any of this from
 *        somewhere new: these methods must only ever be called from a workflow
 *        step, never from a route handler or a tRPC mutation, both of which run
 *        inside budgets an ffmpeg invocation will exceed.
 * WHERE: src/inngest/functions/asset-ingest.ts.
 */

import "server-only";

import { MEDIA_PROVIDER } from "./provider";
import type { MediaAdapter } from "./types";

export type {
  MediaAdapter,
  MediaProbe,
  MediaProbeAudio,
  MediaProbeVideo,
  MediaProviderId,
  TranscodeFit,
  TranscodeRequest,
} from "./types";
export { MEDIA_PROVIDER_IDS, MediaProcessingError } from "./types";
export { MEDIA_PROVIDER, DEFAULT_MEDIA_PROVIDER } from "./provider";

let adapterPromise: Promise<MediaAdapter> | null = null;

async function loadAdapter(): Promise<MediaAdapter> {
  /* Exhaustive over MediaProviderId — a new id without a case here is a
   * compile error at the `never` branch. */
  switch (MEDIA_PROVIDER) {
    case "ffmpeg": {
      const mod = await import("./ffmpeg");
      return mod.ffmpegMediaAdapter;
    }
    default: {
      const exhaustive: never = MEDIA_PROVIDER;
      throw new Error(
        `[adapters/media] No adapter registered for "${String(exhaustive)}".`,
      );
    }
  }
}

export async function getMediaAdapter(): Promise<MediaAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter();
  }
  return adapterPromise;
}
