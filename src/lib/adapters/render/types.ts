/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: RenderAdapter, RenderOptions, RenderStartResult,
 *   RenderProgressResult, RENDER_PROVIDER_IDS, RenderProviderId,
 *   LAMBDA_IS_RIGHT_FOR_RENDERING, RenderProviderError, start, getProgress
 *
 * WHAT:  The contract for turning a timeline document into a video file
 *        somewhere other than this process.
 *
 * WHY:   LAMBDA_IS_RIGHT_FOR_RENDERING — the mirror of the decision recorded
 *        in src/lib/adapters/media/types.ts under FFMPEG_RUNS_IN_A_CONTAINER,
 *        and worth stating next to it because the two seams reach opposite
 *        conclusions on purpose:
 *
 *          - INGEST is many short jobs that each want a warm process and a
 *            local disk, so it runs in a long-lived container.
 *          - A RENDER is one long job per project that PARALLELISES ACROSS
 *            FRAMES. Remotion Lambda splits the frame range into chunks, runs
 *            a function per chunk and stitches the result, which turns a
 *            ten-minute render into a one-minute one for the same compute. A
 *            container cannot do that without becoming a scheduler, and
 *            writing a scheduler is how this seam gets replaced later rather
 *            than now.
 *
 *        The interface is TWO METHODS and no more, which is the shape the
 *        phase asks for and is also the smallest thing a self-hosted renderer
 *        could implement. Specifically it does NOT include "wait for the
 *        render" or "download the output":
 *
 *          - Waiting is the workflow's job, by webhook. A `wait()` on this
 *            interface would be a method no caller is allowed to use, because
 *            a step that blocks for ten minutes times out (see the phase's
 *            step 4, and maxDuration on src/app/api/inngest/route.ts).
 *          - Downloading is the STORAGE seam's job. The adapter returns a URL
 *            and the workflow streams it into R2 through
 *            src/lib/adapters/storage — so a provider swap cannot change where
 *            outputs live, and this folder never learns what a bucket is.
 *
 *        `getProgress` therefore exists for exactly one caller: the timeout
 *        path, which has to find out whether a render that never called back
 *        is dead or merely slow. It is NOT a polling loop, and the phase's
 *        "without any polling step" check is about the happy path, which uses
 *        the webhook. Grep PROGRESS_IS_FOR_THE_TIMEOUT_PATH.
 * WHERE: Implemented by ./lambda. Reached through getRenderAdapter() in
 *        ./index. Called ONLY from src/inngest/functions/project-render.ts —
 *        never from a route, a router or a component, because starting a
 *        render is an action with a bill attached and the gates that authorise
 *        it live in the procedure layer.
 */

import type { TimelineDoc } from "@/lib/timeline";
import type { AssetUrlMap, RenderResolution } from "@/lib/types/render";

/**
 * SOURCE OF TRUTH KEYWORDS: RenderOptions, PRE_RESOLVED_ASSETS,
 *   WEBHOOK_URL_IS_AN_INPUT
 *
 * WHAT:  Everything the provider needs besides the document.
 * WHY:   PRE_RESOLVED_ASSETS. `assets` is the signed-URL map, resolved and
 *        verified BEFORE the render starts (the phase's step 5), because the
 *        renderer runs where this process cannot sign anything and a render
 *        that discovers a missing asset forty minutes in is the expensive
 *        failure mode. The map is the same `AssetUrlMap` the composition takes
 *        as a prop — one shape, produced once, so the preview and the render
 *        cannot disagree about which rendition is which.
 *
 *        WEBHOOK_URL_IS_AN_INPUT rather than a value this folder reads from
 *        the environment. The caller knows which deployment it is and
 *        therefore which URL the provider must call back; an adapter that
 *        resolved its own would make a preview deployment's renders report to
 *        production. It is also what keeps this contract testable without an
 *        env.
 *
 *        `watermark` and `resolution` are carried here rather than baked into
 *        the document for the reasons on `timelineRendererPropsSchema` and
 *        `renderCacheKey` respectively — both are properties of THIS render,
 *        not of the video.
 * WHERE: The one argument of RenderAdapter.start.
 */
export interface RenderOptions {
  /** Signed URLs for every handle in the document — see PRE_RESOLVED_ASSETS. */
  assets: AssetUrlMap;
  watermark: boolean;
  resolution: RenderResolution;
  /** Absolute URL the provider POSTs its completion payload to. */
  webhookUrl: string;
  /**
   * Shared secret the provider signs that payload with. Null means unsigned,
   * which the webhook route REFUSES — so this is effectively required, and is
   * nullable only because the provider's own type models "no secret" that way
   * and silently rewriting it to a placeholder would produce a signature that
   * verifies against nothing.
   */
  webhookSecret: string | null;
  /**
   * Opaque data the provider echoes back on the webhook. This is how the
   * callback is tied to OUR row: the provider knows its own render id and
   * nothing about a `Render`, so the renderId travels out here and comes home
   * in the payload. Without it the webhook can only match on
   * `providerRenderId`, which is unset for the window between the provider
   * accepting the render and our transaction committing the id.
   */
  customData: Record<string, string>;
}

/**
 * SOURCE OF TRUTH KEYWORDS: RenderStartResult, providerRenderId
 *
 * WHAT:  What the provider gives back the instant it accepts a render.
 * WHY:   `providerRenderId` is stored on the row and is UNIQUE there, which is
 *        what makes "exactly one retry with a fresh id" enforceable — see the
 *        note on the Render model.
 *
 *        It is the ONLY field, which is the phase's contract and is also the
 *        right boundary: anything else a provider needs in order to answer a
 *        question about one of its own renders — a bucket, an account, an
 *        endpoint — is that provider's CONFIGURATION, and it resolves it
 *        itself. Carrying a bucket name through the app and back would make
 *        the `Render` row hold a column only one implementation can interpret.
 * WHERE: Returned by start, persisted by the `start-render` step.
 */
export interface RenderStartResult {
  providerRenderId: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: RenderProgressResult, PROGRESS_IS_FOR_THE_TIMEOUT_PATH
 *
 * WHAT:  Where a render has got to.
 * WHY:   `status` is the APP's vocabulary (`RenderStatus`), not the provider's,
 *        which is the entire value of putting an adapter here: the workflow
 *        decides what to write on the row by reading this, and a provider that
 *        reports twelve states of its own must collapse them into these five
 *        inside its own folder. `progress` is 0..1, normalised for the same
 *        reason — a provider reporting a percentage and another reporting a
 *        fraction would show as a progress bar that is right on one deploy.
 *        `outputUrl` is nullable because it only exists once the render is
 *        `completed`, and `error` because it only exists when it is not.
 * WHERE: The timeout branch of the render workflow.
 */
export interface RenderProgressResult {
  status: "queued" | "rendering" | "completed" | "failed";
  /** 0..1. */
  progress: number;
  outputUrl: string | null;
  error: string | null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: RenderProviderError, PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  A render operation that failed, carrying whether it is worth retrying.
 * WHY:   The same distinction, and for the same reason, as
 *        MediaProcessingError in the media seam: the workflow has to decide
 *        whether a customer waits. `permanent: true` means this document will
 *        not render however many times it is tried — a composition that throws,
 *        a configuration that does not exist — and must be written to the row
 *        as `failed` immediately. `permanent: false` is a blip reaching the
 *        provider and is allowed to retry with backoff. Getting it backwards
 *        means either three pointless paid renders of a broken document, or a
 *        permanent failure recorded against a momentary network fault.
 *
 *        `message` is the sentence shown to the customer; `detail` is for the
 *        operator and is never rendered.
 * WHERE: Thrown by ./lambda; caught in src/inngest/functions/project-render.ts.
 */
export class RenderProviderError extends Error {
  readonly detail: string;
  readonly permanent: boolean;

  constructor(
    message: string,
    options: { detail?: string; permanent?: boolean } = {},
  ) {
    super(message);
    this.name = "RenderProviderError";
    this.detail = options.detail ?? "";
    this.permanent = options.permanent ?? false;
  }
}

export interface RenderAdapter {
  readonly id: RenderProviderId;

  /**
   * Hands the document to the provider and returns as soon as it is accepted.
   * Does NOT wait for the render — see the file header.
   */
  start(doc: TimelineDoc, options: RenderOptions): Promise<RenderStartResult>;

  /** Where one already-started render has got to. See RenderProgressResult. */
  getProgress(providerRenderId: string): Promise<RenderProgressResult>;
}

export const RENDER_PROVIDER_IDS = ["lambda"] as const;

export type RenderProviderId = (typeof RENDER_PROVIDER_IDS)[number];
