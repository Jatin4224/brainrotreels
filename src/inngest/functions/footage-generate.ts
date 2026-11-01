/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: footageGenerateFunction, clip/requested,
 *   POLL_IN_SEPARATE_STEPS, HOLD_IN_THE_WORKFLOW, ONE_REF_PER_CLIP,
 *   A_FAILURE_RELEASES_THE_HOLD, REFUSED_IS_NOT_RETRIED,
 *   FETCH_ONCE_THEN_HAND_OVER, MODERATION_HAPPENED_IN_THE_ROUTER
 *
 * WHAT:  Generates one video clip: hold the credits, start the generation,
 *        poll across steps until it finishes, stream the result into storage,
 *        and hand over to the ordinary ingest for variants.
 *
 * WHY:   POLL_IN_SEPARATE_STEPS is the phase's step 2, stated as a warning:
 *        "poll in separate steps with sleeps between — polling inside one step
 *        times out". A video generation runs for minutes; a loop inside one
 *        `step.run` is a single function invocation that has to survive the
 *        whole wait, and it does not. So each poll is its OWN durable step
 *        with a `step.sleep` between, which means the worker is free during
 *        the wait, the run survives a deploy, and a replay resumes at the last
 *        poll rather than starting another generation.
 *
 *        That is also why the provider's job id is carried in a STEP RESULT
 *        rather than on a column: Inngest memoises a completed step, so a
 *        replay of `start-generation` returns the id it already got instead of
 *        starting — and paying for — a second clip. A column would work too
 *        and would be a migration for something the queue already guarantees.
 *
 *        HOLD_IN_THE_WORKFLOW, as in the render path and for the same reason:
 *        the router REFUSES on the estimate, and the hold is placed here.
 *        Holding inside the request would put a credit movement in a
 *        transaction that may time out, stranding money with no run in
 *        existence to release it.
 *
 *        ONE_REF_PER_CLIP — the ledger reference is `clip:<assetId>`, which is
 *        unique because the row is created before this runs. It is
 *        deliberately NOT in `PROJECT_HOLD_REFS`: a clip belongs to the
 *        workspace's library rather than to a project, so cancelling a
 *        project's generation must not release a clip the customer is still
 *        waiting for.
 *
 *        A_FAILURE_RELEASES_THE_HOLD, in every failure path including
 *        `onFailure`. A customer who got no clip must not be charged, and a
 *        hold nobody settles sits against their balance until the Phase 05
 *        reconciler notices.
 *
 *        REFUSED_IS_NOT_RETRIED. A provider that declined the prompt will
 *        decline it again, and each attempt may be billed — so a refusal is
 *        raised as `NonRetriableError` and the customer is told to reword.
 *        Only a rate limit or an outage is allowed a second attempt.
 *
 *        FETCH_ONCE_THEN_HAND_OVER, copied from the library ingest: this
 *        workflow downloads the provider's file, uploads it under our key, and
 *        then sends `asset/uploaded` so the ONE ingest pipeline that owns
 *        probing, variants and the readiness transition does that work. The
 *        vertical variant and the proxy the phase's first done-when asks for
 *        come from there, not from here.
 *
 *        MODERATION_HAPPENED_IN_THE_ROUTER and is not repeated. `footage.generate`
 *        classifies the prompt under the stricter `prompt` standard, records
 *        the decision, and refuses synchronously so the customer can reword
 *        immediately — which is better than a row that fails a minute later.
 *        This workflow has exactly one producer, and re-classifying here would
 *        be a second paid classifier call for an answer already recorded.
 * WHERE: Triggered by `clip/requested`, sent by `footage.generate`.
 */

import { NonRetriableError } from "inngest";
import { z } from "zod";

import { getVideoAdapter, VideoError } from "@/lib/adapters/video";
import { prisma } from "@/lib/config/prisma";
import { estimate } from "@/lib/credits";
import { downloadUrlToFile, uploadFile, withStagingDir } from "@/lib/media";
import { enqueue } from "@/lib/adapters/jobs";
import { markAssetFailed, setModerationStatus } from "@/services/assets.service";
import { commit, hold, release } from "@/services/credits.service";
import { recordFootageProvenance } from "@/services/footage.service";
import { incrementUsage } from "@/services/usage.service";

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";

/**
 * SOURCE OF TRUTH KEYWORDS: clipRequestedEventSchema, EVENT_PAYLOAD_PARSED
 *
 * WHAT:  The shape of a `clip/requested` event's data.
 * WHY:   EVENT_PAYLOAD_PARSED, as in every other workflow here: `JobEvent.data`
 *        crosses a queue as JSON with no types attached and may have been
 *        enqueued by an older release. A payload that does not parse is a
 *        permanent failure, because no retry makes a malformed event valid.
 * WHERE: The first line of the handler.
 */
const clipRequestedEventSchema = z.object({
  organizationId: z.string().min(1),
  assetId: z.string().min(1),
  prompt: z.string().min(1),
  durationSec: z.number().positive(),
});

/**
 * SOURCE OF TRUTH KEYWORDS: POLL_BUDGET, THE_WAIT_IS_BOUNDED
 *
 * How long to wait for a clip before giving up, as a number of polls and the
 * gap between them.
 *
 * THE_WAIT_IS_BOUNDED. Ten minutes is generous for current video models and is
 * a deliberate ceiling rather than a guess at the slowest case: a generation
 * still running after ten minutes is almost certainly stuck, and the customer
 * is better served by a released hold and a clear failure than by a tile that
 * spins for an hour. Fifteen seconds between polls because the provider is
 * billed per request on some plans and a three-second poll buys nothing — the
 * clip is not going to arrive sooner for being asked more often.
 */
const POLL_INTERVAL = "15s";
const POLL_ATTEMPTS = 40;

export const footageGenerateFunction = inngestClient.createFunction(
  {
    id: "footage-generate",
    name: "Generate one video clip",
    triggers: [{ event: "clip/requested" }],
    /**
     * ONE retry, not the default three. Every attempt that reaches the model
     * is BILLED by the provider, and the failures worth retrying here — a
     * rate limit, a 5xx — clear fast or not at all. A refusal and a malformed
     * event are raised as `NonRetriableError` and never see a second attempt.
     */
    retries: 1,
    /**
     * One generation at a time per workspace. The most expensive call in the
     * product, so a customer who queues ten clips should not be able to hold
     * ten provider slots — and the queue draining in order is what keeps one
     * workspace from starving every other tenant's generations.
     */
    concurrency: { key: "event.data.organizationId", limit: 1 },
    /**
     * A_FAILURE_RELEASES_THE_HOLD. A run that exhausts its retries still has
     * to leave the row honest and the money back: otherwise the asset sits on
     * `processing` forever and the hold sits against the balance until the
     * reconciler notices.
     */
    onFailure: async ({ event }) => {
      const input = clipRequestedEventSchema.safeParse(
        event.data.event?.data ?? {},
      );
      if (!input.success) {
        console.error(
          "[footage.generate] Failure handler could not read the original event.",
        );
        return;
      }

      const { organizationId, assetId } = input.data;

      await markAssetFailed(
        prisma,
        assetId,
        "The clip could not be generated. The credits for it have been returned.",
      ).catch((error: unknown) => {
        console.error("[footage.generate] Could not mark the asset failed:", error);
      });

      await releaseClipHold(organizationId, assetId);
    },
  },
  async ({ event, step }) => {
    const input = clipRequestedEventSchema.safeParse(event.data);
    if (!input.success) {
      throw new NonRetriableError(
        `[footage.generate] Event payload is not valid: ${input.error.message}`,
      );
    }

    const { organizationId, assetId, prompt, durationSec } = input.data;

    // ───────────────────────────────────────────────────────────────────────
    // [1] HOLD — see HOLD_IN_THE_WORKFLOW. The router already refused on the
    //     estimate, so this reserves what that estimate said.
    // ───────────────────────────────────────────────────────────────────────
    const held = await step.run("hold-credits", async () => {
      const cost = estimate({ kind: "aiFootage", durationSeconds: durationSec });

      const holdId = await hold(
        prisma,
        organizationId,
        cost.total,
        clipHoldRef(assetId),
        { assetId, durationSec },
      );

      return { holdId, cost: cost.total };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [2] START — hand the prompt over and remember the provider's job id.
    //     Memoised, so a replay never starts a second generation.
    // ───────────────────────────────────────────────────────────────────────
    const started = await step.run("start-generation", async () => {
      const adapter = await getVideoAdapter();

      if (!adapter.configured) {
        /* NOT_CONFIGURED_IS_A_CASE. The router refuses before enqueueing, so
         * reaching here means the credential was removed between the request
         * and the run. Permanent: no retry configures a provider. */
        throw new NonRetriableError(
          "[footage.generate] No video provider is configured.",
        );
      }

      try {
        const result = await adapter.start({
          prompt,
          durationSec,
          aspect: "9:16",
        });
        return { jobId: result.jobId, provider: adapter.id };
      } catch (error) {
        throw toWorkflowError(error, "start");
      }
    });

    // ───────────────────────────────────────────────────────────────────────
    // [3] POLL — one step per attempt, with a sleep between. See
    //     POLL_IN_SEPARATE_STEPS for why this is not a loop inside one step.
    // ───────────────────────────────────────────────────────────────────────
    let finished: {
      url: string;
      modelVersion: string;
    } | null = null;

    for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
      /* Before the first poll as well as between them: a generation that has
       * only just been accepted is never ready, so asking immediately spends a
       * request to be told `pending`. */
      await step.sleep(`wait-${attempt}`, POLL_INTERVAL);

      const polled = await step.run(`poll-${attempt}`, async () => {
        const adapter = await getVideoAdapter();
        try {
          return await adapter.poll(started.jobId);
        } catch (error) {
          throw toWorkflowError(error, "poll");
        }
      });

      if (polled.status === "completed" && polled.url !== null) {
        finished = {
          url: polled.url,
          /* MODEL_VERSION_IS_RETURNED_NOT_ASSUMED, with the provider id as the
           * floor — "which model made this" is better answered imprecisely
           * than not at all. */
          modelVersion: polled.modelVersion ?? started.provider,
        };
        break;
      }

      if (polled.status === "failed") {
        /* The provider's own reason, which is already a sentence. Permanent:
         * a generation that failed does not un-fail. */
        await step.run(`fail-${attempt}`, async () => {
          await markAssetFailed(
            prisma,
            assetId,
            polled.error ??
              "The video model could not produce this clip. The credits have been returned.",
          );
          await releaseClipHold(organizationId, assetId);
          return { failed: true };
        });

        throw new NonRetriableError(
          `[footage.generate] ${assetId}: ${polled.error ?? "the generation failed"}`,
        );
      }
    }

    if (finished === null) {
      /* THE_WAIT_IS_BOUNDED — ten minutes and no clip. */
      await step.run("give-up", async () => {
        await markAssetFailed(
          prisma,
          assetId,
          "The clip took too long to generate and was abandoned. The credits have been returned.",
        );
        await releaseClipHold(organizationId, assetId);
        return { abandoned: true };
      });

      throw new NonRetriableError(
        `[footage.generate] ${assetId}: no clip after ${POLL_ATTEMPTS} polls.`,
      );
    }

    // ───────────────────────────────────────────────────────────────────────
    // [4] STORE — stream the provider's file under our key, record what made
    //     it, and settle the hold. FETCH_ONCE_THEN_HAND_OVER.
    // ───────────────────────────────────────────────────────────────────────
    const stored = await step.run("store-clip", async () => {
      const asset = await prisma.asset.findFirst({
        where: { id: assetId, organizationId },
        select: { storageKey: true, contentType: true },
      });
      if (asset === null) {
        /* Deleted while we were generating. Nothing to write to, so the money
         * goes back and the run ends. */
        await releaseClipHold(organizationId, assetId);
        throw new NonRetriableError(
          `[footage.generate] Asset ${assetId} no longer exists.`,
        );
      }

      const bytes = await withStagingDir(async (dir) => {
        const localPath = dir.file("clip.mp4");
        /* FOREIGN_BYTES — the label is what makes a download failure readable,
         * since the URL is the provider's and may be long and opaque. */
        await downloadUrlToFile(
          finished.url,
          localPath,
          `the generated clip for ${assetId}`,
        );
        return uploadFile({
          localPath,
          storageKey: asset.storageKey,
          contentType: asset.contentType,
        });
      });

      await recordFootageProvenance(prisma, {
        assetId,
        modelVersion: finished.modelVersion,
        sourceProvider: started.provider,
        bytes,
      });

      /**
       * SOURCE OF TRUTH KEYWORDS: GENERATED_CLIP_IS_CLEARED_UPSTREAM
       *
       * `skipped`, for the same reason a generated image is: this is our own
       * synthesis from a prompt the router already classified under the
       * stricter `prompt` standard, and the model applied its own policy on
       * top. There is no video classifier to send the frames to, and leaving
       * the row `pending` would withhold the clip from the customer who paid
       * for it. It is NOT `approved`, because nothing looked at the frames —
       * `skipped` means "moderation applies and it happened upstream", which
       * is exactly true.
       */
      await setModerationStatus(prisma, assetId, "skipped");

      /* The clip exists and is ours. Settle at the held amount: the estimate
       * was the price quoted on the button and the length is what was
       * generated, so there is nothing to true up. */
      await commit(prisma, held.holdId, held.cost, { assetId });

      /* COUNTED_WHEN_THE_CLIP_EXISTS. The plan's monthly allowance is spent
       * here rather than at request time, so a failed or refused generation
       * costs a customer nothing from their quota either. */
      await incrementUsage(organizationId, "aiFootage", 1);

      return { bytes };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [5] HAND OVER — the ordinary ingest probes the file and builds the
    //     vertical variant and the proxy. FETCH_ONCE_THEN_HAND_OVER.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("request-ingest", async () => {
      await enqueue({
        name: "asset/uploaded",
        data: { assetId, organizationId },
        /* Keyed on the asset, as every other ingest producer is: a replay
         * collapses onto the run that already processed it. */
        id: `asset-ingest-${assetId}`,
      });
      return { queued: true };
    });

    return { assetId, bytes: stored.bytes, provider: started.provider };
  },
);

/**
 * SOURCE OF TRUTH KEYWORDS: clipHoldRef, ONE_REF_PER_CLIP
 *
 * The ledger reference for one clip's hold. Namespaced so it is greppable in
 * the ledger and so it cannot collide with a project's holds — see
 * ONE_REF_PER_CLIP in the file header for why it is not a project ref.
 */
function clipHoldRef(assetId: string): string {
  return `clip:${assetId}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: releaseClipHold, A_FAILURE_RELEASES_THE_HOLD
 *
 * WHAT:  Returns the money for a clip that did not happen.
 * WHY:   Looks the hold up by REFERENCE rather than taking an id, because the
 *        failure paths that need it include `onFailure`, which has the event
 *        payload and not the step results. Failures are logged and swallowed:
 *        this runs where there is no error path left, and the Phase 05
 *        reconciler is the backstop for what it misses.
 * WHERE: Every failure path in this file.
 */
async function releaseClipHold(
  organizationId: string,
  assetId: string,
): Promise<void> {
  try {
    const { findOpenHoldForRef } = await import("@/services/credits.service");
    const open = await findOpenHoldForRef(prisma, clipHoldRef(assetId));
    if (open === null) return;

    await release(prisma, open.id, { assetId, organizationId });
  } catch (error) {
    console.error(
      `[footage.generate] Could not release the hold for ${assetId}:`,
      error,
    );
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: toWorkflowError, REFUSED_IS_NOT_RETRIED,
 *   PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  A provider failure as the error the queue should act on.
 * WHY:   REFUSED_IS_NOT_RETRIED — a declined prompt, a bad credential and a
 *        failed generation are permanent, and each retry of one is a billed
 *        request for the same answer. Only `transient` reasons (a rate limit,
 *        an outage) are allowed to throw an ordinary error and be retried.
 * WHERE: The start and poll steps.
 */
function toWorkflowError(error: unknown, stage: string): Error {
  if (error instanceof VideoError) {
    if (error.transient) {
      /* An ordinary throw, so Inngest retries with backoff. */
      return new Error(`[footage.generate] ${stage}: ${error.detail}`);
    }
    return new NonRetriableError(
      `[footage.generate] ${stage} refused: ${error.detail || error.message}`,
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}
