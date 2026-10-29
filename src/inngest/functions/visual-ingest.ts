/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: visualIngestFunction, footage/requested,
 *   CHOICE_IS_RE_READ_NOT_REPLAYED, FETCH_ONCE_THEN_HAND_OVER,
 *   ONE_BLOCK_ONE_RUN, A_FAILED_BLOCK_IS_NOT_A_FAILED_VIDEO,
 *   INGEST_IS_INVOKED_NOT_ENQUEUED, NonRetriableError
 *
 * WHAT:  Brings ONE script block's chosen visual into our bucket — a stock clip
 *        downloaded, or an image generated — hands it to the ordinary ingest
 *        pipeline, and records the asset against the block.
 *
 * WHY:   FETCH_ONCE_THEN_HAND_OVER, the shape `library-ingest` established and
 *        for the same reason. This workflow does exactly the one thing the
 *        upload path does not — get somebody else's bytes (or a model's) to a
 *        storage key — and then the PROBE, the variants, the moderation pass
 *        and the readiness transition all happen in `asset-ingest`, which owns
 *        them. The alternative, a second ingest pipeline for generated media,
 *        is how "a generated image gets the same variants as an upload" stops
 *        being true six months later: one of the two pipelines gets a fix and
 *        the other does not. Three producers now, one pipeline.
 *
 *        ONE_BLOCK_ONE_RUN. A five-block script is five runs rather than one,
 *        which looks wasteful until you ask what the alternative does when
 *        block three's prompt is refused. A single run would either abandon
 *        blocks four and five or need its own per-block error accounting, and
 *        the step ids would be the only thing making it resumable. One run per
 *        block makes the queue do that for free: each has its own retries, its
 *        own concurrency slot and its own failure handler, and a block that
 *        cannot be fetched marks ITSELF failed without touching its neighbours.
 *        That is also the phase's "swapping one block's visual leaves the other
 *        blocks untouched", enforced at the queue rather than remembered.
 *
 *        CHOICE_IS_RE_READ_NOT_REPLAYED. The event carries the BLOCK ID, never
 *        the choice. The choice lives on the project's settings, so putting it
 *        in the payload would mean a run that resumes after a customer swapped
 *        the visual re-applies the one they just replaced — and
 *        SMALL_STEP_PAYLOADS says the same thing for a different reason: a
 *        stock choice carries two URLs and a licence, which is a lot of
 *        somebody else's data to copy into a queue. The same decision
 *        MANIFEST_IS_RE_READ_NOT_REPLAYED records for the library sync.
 *
 *        INGEST_IS_INVOKED_NOT_ENQUEUED, which is where this differs from
 *        `library-ingest` and the difference is deliberate. A library sync fires
 *        and forgets: nobody is waiting, and the catalogue fills in. Here the
 *        GENERATE PIPELINE is waiting — the `visuals` stage cannot complete
 *        until the asset is `ready`, because `resolveBlockVisuals` refuses
 *        anything that is not (READY_AND_CLEARED), and a document built a
 *        second too early would quietly fall back to the backdrop for every
 *        block. `step.invoke` makes this run WAIT for the ingest it started,
 *        so the stage that invoked this one can trust that a `ready` block is
 *        genuinely renderable.
 *
 *        A_FAILED_BLOCK_IS_NOT_A_FAILED_VIDEO. Every terminal failure here ends
 *        with the block marked `failed` and the run stopping — never with the
 *        parent pipeline failing. The generator reads a non-`ready` block as a
 *        block with no visual, which is the styled backdrop, which is a
 *        complete video (FALLBACK_CHAIN_IS_THE_POINT). That is why this
 *        workflow has an `onFailure` at all: a run that dies without reaching
 *        its own error branches would otherwise leave the block `pending`
 *        forever, and a pending block looks to the picker like one that is
 *        still working.
 * WHERE: Registered in src/inngest/functions/index.ts, served at /api/inngest.
 *        Triggered by `footage/requested`, sent by the `visuals` stage of
 *        ./project-generate.ts and by `visuals.setBlockVisual`.
 */

import { NonRetriableError } from "inngest";
import { z } from "zod";

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import { ImageError } from "@/lib/adapters/image";
import { prisma } from "@/lib/config/prisma";
import { blockVisualSchema } from "@/lib/types/visual";
import {
  ingestBlockVisual,
  readBlockVisuals,
  upsertBlockVisual,
} from "@/services/visuals.service";
import { assetIngestFunction } from "./asset-ingest";

/**
 * SOURCE OF TRUTH KEYWORDS: footageRequestedEventSchema, EVENT_PAYLOAD_PARSED
 *
 * WHAT:  The shape of a `footage/requested` event's data.
 * WHY:   EVENT_PAYLOAD_PARSED, as everywhere: `JobEvent.data` crosses a queue
 *        as JSON with no types attached and may have been enqueued by an older
 *        deploy. Three ids and nothing else — see
 *        CHOICE_IS_RE_READ_NOT_REPLAYED for why the choice is not here.
 * WHERE: The first step below.
 */
const footageRequestedEventSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  blockId: z.string().min(1),
});

const failureEventSchema = z.object({
  data: z.object({
    event: z.object({ data: footageRequestedEventSchema }),
  }),
});

/** What the fetch step hands the next one. STEP_RESULTS_ARE_JSON. */
const fetchedSchema = z.object({
  assetId: z.string().min(1),
  cached: z.boolean(),
  needsIngest: z.boolean(),
  /** 1 when a model was actually called, 0 when the prompt cache hit. */
  imagesGenerated: z.number().int().min(0),
});

/**
 * SOURCE OF TRUTH KEYWORDS: FETCH_FAILED_COPY, FAILURE_IS_EXPLAINED_NOT_DUMPED
 *
 * What a customer is told when a block's visual could not be fetched. Generic
 * on purpose: the specific reasons are a provider's status code, an expired CDN
 * URL or a model's internal message, none of which a customer can act on — and
 * the action they CAN take is the same in every case, which is to pick
 * something else. The technical detail goes to `console.error`, where an
 * operator reads it.
 */
const FETCH_FAILED_COPY =
  "This picture could not be fetched. Pick another one, or leave the paragraph on the background.";

export const visualIngestFunction = inngestClient.createFunction(
  {
    id: "visual-ingest",
    name: "Fetch or generate one block's visual",
    triggers: [{ event: "footage/requested" }],
    /* Two retries. The failures worth retrying are a flaky CDN and a busy image
     * model, which clear fast or not at all — the same reasoning as
     * `asset-ingest` and `library-ingest`. A refused prompt and an unregistered
     * download host are raised as NonRetriableError and never see a second
     * attempt, because each attempt at a generation is BILLED. */
    retries: 2,
    /* Two at a time per workspace. Higher than the upload path's one, because
     * these are mostly network waits rather than ffmpeg CPU and a five-block
     * script should not take five sequential downloads; low enough that one
     * workspace generating a long script cannot saturate the pool. The ingests
     * this run invokes are themselves serialised at one per workspace, which is
     * the real throttle on the expensive half. */
    concurrency: { key: "event.data.organizationId", limit: 2 },
    /**
     * A_FAILED_BLOCK_IS_NOT_A_FAILED_VIDEO's net: a run that exhausts its
     * retries still has to leave the block honest, or the picker shows a
     * spinner forever and the generator waits for something that will never
     * arrive.
     */
    onFailure: async ({ event }) => {
      const parsed = failureEventSchema.safeParse(event);
      if (!parsed.success) {
        console.error(
          "[visual.ingest] Failure handler could not read the original event.",
        );
        return;
      }
      const { organizationId, projectId, blockId } = parsed.data.data.event.data;
      await markBlockFailed({
        organizationId,
        projectId,
        blockId,
        reason: FETCH_FAILED_COPY,
      });
    },
  },
  async ({ event, step }) => {
    const input = footageRequestedEventSchema.safeParse(event.data);
    if (!input.success) {
      throw new NonRetriableError(
        `[visual.ingest] Event payload is not valid: ${input.error.message}`,
      );
    }
    const { organizationId, projectId, blockId } = input.data;

    // ───────────────────────────────────────────────────────────────────────
    // [1] FETCH OR GENERATE — the one thing this workflow exists to do.
    //     Both caches are checked inside `ingestBlockVisual`, so an identical
    //     prompt or a repeated clip costs nothing (CACHE_BEFORE_SPEND).
    // ───────────────────────────────────────────────────────────────────────
    const rawFetched = await step.run("fetch-visual", async () => {
      /* CHOICE_IS_RE_READ_NOT_REPLAYED — resolved from the settings, here, on
       * the far side of the queue. */
      const visuals = await readBlockVisuals(prisma, organizationId, projectId);
      if (visuals === null) {
        /* The project was deleted while the event was in flight. Nothing to
         * mark and nothing to leak. */
        throw new NonRetriableError(
          `[visual.ingest] Project ${projectId} is no longer available.`,
        );
      }

      const block = visuals.blocks.find((entry) => entry.blockId === blockId);
      if (block === undefined) {
        /* The block's entry was replaced by a swap, or the script was
         * regenerated. The newer choice has its own run; this one is stale and
         * must not overwrite it. */
        throw new NonRetriableError(
          `[visual.ingest] Block ${blockId} has no stored visual choice.`,
        );
      }

      if (block.choice.source === "background") {
        /* Nothing to fetch. Reachable when a stage wrote the events before the
         * chain's answers, or on a replay of an older payload. */
        return {
          assetId: "",
          cached: true,
          needsIngest: false,
          imagesGenerated: 0,
        };
      }

      try {
        const result = await ingestBlockVisual(prisma, {
          organizationId,
          projectId,
          blockId,
          choice: block.choice,
        });
        return {
          ...result,
          /* The image counter moves only when a model was actually called —
           * IMAGES_GENERATED_IS_CUMULATIVE counts spend, not pictures. */
          imagesGenerated:
            block.choice.source === "ai_image" && !result.cached ? 1 : 0,
        };
      } catch (error) {
        /**
         * PERMANENT_VS_TRANSIENT_FAILURE. A refused prompt, a key that is not
         * configured and a download URL on an unregistered host will not
         * improve on a second attempt, and a generation attempt is BILLED — so
         * those end the run after marking the block. Everything else (a CDN
         * blip, a busy model) throws normally and Inngest retries with backoff.
         */
        const permanent =
          error instanceof ImageError
            ? !error.transient
            : /* `assertStockDownloadUrl` and the upload re-check throw plain
               * Errors, and both are statements about stored data rather than
               * about the network. */
              isPermanentFetchError(error);

        const detail =
          error instanceof ImageError
            ? `${error.reason}: ${error.detail || error.message}`
            : error instanceof Error
              ? error.message
              : String(error);

        console.error(
          `[visual.ingest] ${projectId} block ${blockId}: ${permanent ? "permanent" : "transient"} — ${detail}`,
        );

        if (!permanent) throw error;

        await markBlockFailed({
          organizationId,
          projectId,
          blockId,
          /* An ImageError's own message is already a plain customer-facing
           * sentence (a refused prompt says what to do about it); anything
           * else gets the generic copy. */
          reason:
            error instanceof ImageError ? error.message : FETCH_FAILED_COPY,
        });
        throw new NonRetriableError(
          `[visual.ingest] ${projectId} block ${blockId} cannot be fetched: ${detail}`,
        );
      }
    });

    const fetched = fetchedSchema.parse(rawFetched);

    /* A `background` choice resolved to nothing to fetch. Already `ready`. */
    if (fetched.assetId.length === 0) {
      return { projectId, blockId, assetId: null, cached: true };
    }

    // ───────────────────────────────────────────────────────────────────────
    // [2] HAND OVER AND WAIT — the ordinary ingest probes, builds the three
    //     variants, moderates and marks the row ready. Invoked rather than
    //     enqueued because the generate pipeline is waiting on the answer
    //     (INGEST_IS_INVOKED_NOT_ENQUEUED).
    // ───────────────────────────────────────────────────────────────────────
    if (fetched.needsIngest) {
      await step.invoke("ingest-asset", {
        function: assetIngestFunction,
        data: { assetId: fetched.assetId, organizationId },
      });
    }

    // ───────────────────────────────────────────────────────────────────────
    // [3] RECORD — the block now points at a real, ingested asset.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("record-visual", async () => {
      const visuals = await readBlockVisuals(prisma, organizationId, projectId);
      const block = visuals?.blocks.find((entry) => entry.blockId === blockId);
      if (block === undefined) {
        /* Swapped while this run was fetching. The newer choice owns the block
         * and this run's asset is simply unused — it stays in the workspace's
         * media, which is the honest outcome: the customer paid for it. */
        return { recorded: false };
      }

      await upsertBlockVisual(prisma, {
        organizationId,
        projectId,
        block: blockVisualSchema.parse({
          ...block,
          status: "ready",
          assetId: fetched.assetId,
        }),
        imagesGenerated: fetched.imagesGenerated,
      });
      return { recorded: true };
    });

    return {
      projectId,
      blockId,
      assetId: fetched.assetId,
      cached: fetched.cached,
    };
  },
);

/**
 * SOURCE OF TRUTH KEYWORDS: isPermanentFetchError, STORED_DATA_IS_PERMANENT
 *
 * WHAT:  Whether a plain `Error` from the fetch is worth retrying.
 * WHY:   STORED_DATA_IS_PERMANENT. The two plain errors this path raises are
 *        both statements about what is STORED rather than about the network: a
 *        download URL whose host is not a registered delivery host
 *        (NO_SSRF_THROUGH_A_STORED_URL), and an `upload` choice naming an asset
 *        that is no longer a ready row in this workspace. Neither becomes true
 *        on a second attempt, and retrying the first would mean three more
 *        attempts to fetch a host we have decided not to fetch.
 *
 *        Matched on the message prefix, which is the honest version of a weak
 *        signal: these are thrown by named functions with `[stock/hosts]` and
 *        `[visuals.service]` prefixes, so the match is on a string this
 *        codebase controls rather than on a provider's wording. Anything
 *        unrecognised is treated as TRANSIENT, which is the safe default — a
 *        retry of a genuinely permanent failure costs three attempts and ends
 *        in the same place, while treating a blip as permanent loses a picture
 *        the customer would have got.
 * WHERE: The fetch step's catch.
 */
function isPermanentFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.startsWith("[stock/hosts]") ||
    error.message.startsWith("[visuals.service]")
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: markBlockFailed, A_FAILED_BLOCK_IS_NOT_A_FAILED_VIDEO
 *
 * WHAT:  Records that one block's visual could not be fetched, with a sentence
 *        a customer can act on.
 * WHY:   Swallows its own errors, because it runs from `onFailure` and from a
 *        path where something has already gone wrong — a throw in either
 *        produces an unhandled rejection in a context with no error path left,
 *        and the worst case of losing this write is a block that stays
 *        `pending` and renders on the backdrop. Exactly the posture
 *        `releaseProjectHolds` takes.
 * WHERE: The fetch step's permanent branch, and `onFailure`.
 */
async function markBlockFailed(args: {
  organizationId: string;
  projectId: string;
  blockId: string;
  reason: string;
}): Promise<void> {
  try {
    const visuals = await readBlockVisuals(
      prisma,
      args.organizationId,
      args.projectId,
    );
    const block = visuals?.blocks.find(
      (entry) => entry.blockId === args.blockId,
    );
    if (block === undefined) return;

    await upsertBlockVisual(prisma, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      block: blockVisualSchema.parse({
        ...block,
        status: "failed",
        error: args.reason.slice(0, 300),
      }),
    });
  } catch (error) {
    console.error(
      `[visual.ingest] ${args.projectId} block ${args.blockId}: could not record the failure.`,
      error,
    );
  }
}
