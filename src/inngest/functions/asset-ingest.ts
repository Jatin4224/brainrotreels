/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: assetIngestFunction, asset/uploaded, asset.ingest,
 *   FFMPEG_RUNS_IN_A_CONTAINER, STEP_PER_VARIANT, RESUMABLE_INGEST,
 *   PERMANENT_VS_TRANSIENT_FAILURE, MODERATION_STUB, NonRetriableError
 *
 * WHAT:  The ingest pipeline: probe the uploaded file, refuse what cannot be
 *        processed, build the vertical master, the proxy, the poster and the
 *        waveform, moderate, and mark the asset ready.
 *
 * WHY:   WHERE FFMPEG RUNS — the decision Phase 02 asked for, recorded in full
 *        in src/lib/adapters/media/types.ts under FFMPEG_RUNS_IN_A_CONTAINER.
 *        In short: ffmpeg runs IN THIS PROCESS, which therefore has to be a
 *        long-lived container serving /api/inngest (or a dedicated worker
 *        image) — not a serverless function, because an ffmpeg build is larger
 *        than a serverless bundle, a transcode is longer than a serverless
 *        execution budget, and a retried step needs a real local disk. Lambda
 *        is the right answer for RENDERING in Phase 04 and the wrong one here;
 *        the seam is what keeps that revisable. Nothing in this file is ever
 *        called from a route or a tRPC handler.
 *
 *        STEP_PER_VARIANT / RESUMABLE_INGEST: every variant is its own
 *        `step.run`, and each step stages its own input, writes its own object
 *        and upserts its own AssetVariant row before returning. That is what
 *        "a retry resumes" means in practice — a run that produced the master
 *        and then died on the poster re-enters with the master recorded in the
 *        database and in the bucket, and Inngest replays the completed steps
 *        from memory rather than re-running them. Steps share NOTHING on disk,
 *        because they may not run on the same machine (see STAGE_PER_STEP in
 *        src/lib/media/staging.ts).
 *
 *        PERMANENT_VS_TRANSIENT_FAILURE is the distinction that decides whether
 *        a customer waits. An unsupported codec, a corrupt file, a missing row
 *        — none of those improve by being retried, so they are raised as
 *        NonRetriableError after the asset has been marked `failed` with a
 *        readable reason. A download timeout or a full disk is transient and is
 *        allowed to throw normally so Inngest retries it with backoff. Getting
 *        this backwards means either four pointless transcodes of a broken file
 *        or a permanent failure on a blip.
 *
 *        MODERATION_STUB: moderation is `skipped`, not `approved`. Phase 10
 *        makes it real. Writing `approved` here would be a claim that something
 *        checked the file, and every later phase would be entitled to believe
 *        it — a lie that is cheap to tell now and expensive to find later.
 * WHERE: Registered in src/inngest/functions/index.ts, served at /api/inngest.
 *        Triggered by `asset/uploaded`, sent by assets.completeUpload.
 */

import { NonRetriableError } from "inngest";
import { z } from "zod";

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import { getMediaAdapter } from "@/lib/adapters/media";
import { MediaProcessingError } from "@/lib/adapters/media/types";
import { uploadKey } from "@/lib/adapters/storage";
import { prisma } from "@/lib/config/prisma";
import {
  UnsupportedMediaError,
  assertSupportedMedia,
  downloadToFile,
  planVariants,
  uploadFile,
  withStagingDir,
  type VariantPlan,
} from "@/lib/media";
import { assetKindSchema, mediaFamilyOf } from "@/lib/types/asset";
import {
  findAssetById,
  markAssetFailed,
  markAssetReady,
  setModerationStatus,
  upsertAssetVariant,
} from "@/services/assets.service";

/**
 * SOURCE OF TRUTH KEYWORDS: assetUploadedEventSchema, EVENT_PAYLOAD_PARSED
 *
 * WHAT:  The shape of an `asset/uploaded` event's data.
 * WHY:   EVENT_PAYLOAD_PARSED. `JobEvent.data` is `Record<string, unknown>` by
 *        contract — it crosses a queue, so it arrives as JSON with no types
 *        attached, and it may have been enqueued by an older deploy. Parsing it
 *        is the same rule as validating any other input (CLAUDE.md rule 5);
 *        reading `event.data.assetId as string` would turn a renamed field into
 *        a Prisma query for `undefined`.
 * WHERE: The first step below.
 */
const assetUploadedEventSchema = z.object({
  assetId: z.string().min(1),
  organizationId: z.string().min(1),
});

/**
 * SOURCE OF TRUTH KEYWORDS: failureEventSchema, inngest/function.failed
 *
 * WHAT:  The shape `onFailure` receives — the engine's failure event, which
 *        carries the ORIGINAL event nested inside it.
 * WHY:   The nesting is easy to get wrong by one level, and getting it wrong
 *        means the failure handler reads `undefined` and silently leaves the
 *        asset spinning. A schema makes the shape explicit and the mistake
 *        loud.
 * WHERE: The onFailure handler below.
 */
const failureEventSchema = z.object({
  data: z.object({
    event: z.object({ data: assetUploadedEventSchema }),
  }),
});

/**
 * SOURCE OF TRUTH KEYWORDS: probedFactsSchema, STEP_RESULTS_ARE_JSON
 *
 * WHAT:  The probe facts carried between steps.
 * WHY:   STEP_RESULTS_ARE_JSON. A step's return value is serialised, stored and
 *        replayed on retry, so what comes back on a resumed run is JSON and not
 *        the object the step returned — a `Date` arrives as a string and a
 *        `class` arrives as a plain object. Re-parsing at the boundary is what
 *        makes the replayed value and the fresh value the same thing.
 * WHERE: Passed from the probe step into the variant steps.
 */
const probedFactsSchema = z.object({
  family: z.enum(["video", "image", "audio"]),
  kind: assetKindSchema,
  storageKey: z.string(),
  organizationId: z.string(),
  durationSec: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});

export const assetIngestFunction = inngestClient.createFunction(
  {
    id: "asset-ingest",
    name: "Ingest an uploaded asset",
    triggers: [{ event: "asset/uploaded" }],
    /* Two retries, not the default. Each attempt may be minutes of CPU, and the
     * failures worth retrying here (a download blip, a transient disk) clear
     * fast or not at all — four attempts would mostly buy a longer wait before
     * the same answer. */
    retries: 2,
    /* One ingest at a time per WORKSPACE. A customer dropping thirty files must
     * not be able to saturate the worker pool and stall every other tenant's
     * uploads behind their own; the queue drains in order instead. */
    concurrency: { key: "event.data.organizationId", limit: 1 },
    /**
     * A run that exhausts its retries still has to leave the row honest —
     * otherwise the asset sits on `processing` forever and the customer has a
     * tile with a spinner and no explanation. This is the net under every
     * transient failure; permanent ones have already written their own message
     * by the time they are raised.
     */
    onFailure: async ({ event }) => {
      /* The failure event WRAPS the original one, so the payload is nested
       * under `data.event.data`. Parsed rather than indexed, for the same
       * reason as EVENT_PAYLOAD_PARSED: this handler runs on the path where
       * something has already gone wrong, and a crash here would replace a
       * readable failure with no failure at all. */
      const parsed = failureEventSchema.safeParse(event);
      if (!parsed.success) {
        console.error(
          "[asset.ingest] Failure handler could not read the original event.",
        );
        return;
      }
      await markAssetFailed(
        prisma,
        parsed.data.data.event.data.assetId,
        "Processing this file did not finish. Please try uploading it again.",
      );
    },
  },
  async ({ event, step }) => {
    const input = assetUploadedEventSchema.safeParse(event.data);
    if (!input.success) {
      /* A malformed event cannot be fixed by retrying it, and there is no id to
       * mark failed — so the only useful thing is to stop loudly. */
      throw new NonRetriableError(
        `[asset.ingest] Event payload is not valid: ${input.error.message}`,
      );
    }
    const { assetId } = input.data;

    // ───────────────────────────────────────────────────────────────────────
    // [1] PROBE — read what the file actually is, and refuse it here if the
    //     pipeline cannot process it. Everything downstream may assume the
    //     file is real, supported, and has dimensions.
    // ───────────────────────────────────────────────────────────────────────
    const facts = await step.run("probe", async () => {
      const asset = await findAssetById(prisma, assetId);
      if (asset === null) {
        /* The row was deleted while the event was in flight — a customer
         * cancelling an upload. Not an error worth retrying or alerting on. */
        throw new NonRetriableError(
          `[asset.ingest] Asset ${assetId} no longer exists.`,
        );
      }

      const family = mediaFamilyOf(asset.contentType);
      if (family === null) {
        await markAssetFailed(
          prisma,
          assetId,
          `We do not support ${asset.contentType} files.`,
        );
        throw new NonRetriableError(
          `[asset.ingest] Unsupported content type ${asset.contentType}.`,
        );
      }

      const kind = assetKindSchema.safeParse(asset.kind);
      if (!kind.success) {
        await markAssetFailed(
          prisma,
          assetId,
          "This asset has an unrecognised type.",
        );
        throw new NonRetriableError(
          `[asset.ingest] Unknown asset kind "${asset.kind}".`,
        );
      }

      return withStagingDir(async (dir) => {
        const localPath = dir.file("original");
        await downloadToFile(asset.storageKey, localPath);

        const media = await getMediaAdapter();

        let probe;
        try {
          probe = await media.probe(localPath);
          assertSupportedMedia(probe);
        } catch (error) {
          /* PERMANENT_VS_TRANSIENT_FAILURE — a refusal and a tool failure are
           * both permanent for THIS file: a corrupt upload does not become
           * valid on a second read. Both write the customer-facing sentence
           * and stop the run; anything else (a download failure, a full disk)
           * falls through to Inngest's retry. */
          if (error instanceof UnsupportedMediaError) {
            await markAssetFailed(prisma, assetId, error.message);
            throw new NonRetriableError(error.message);
          }
          if (error instanceof MediaProcessingError) {
            await markAssetFailed(prisma, assetId, error.message);
            console.error(
              `[asset.ingest] ${assetId} probe failed:`,
              error.detail,
            );
            throw new NonRetriableError(error.message);
          }
          throw error;
        }

        return {
          family,
          kind: kind.data,
          storageKey: asset.storageKey,
          organizationId: asset.organizationId ?? input.data.organizationId,
          durationSec: probe.durationSec,
          width: probe.video?.width ?? null,
          height: probe.video?.height ?? null,
        };
      });
    });

    const probed = probedFactsSchema.parse(facts);

    // ───────────────────────────────────────────────────────────────────────
    // [2] VARIANTS — one step each, in plan order, because a later variant may
    //     be derived from an earlier one (the proxy comes from the master, not
    //     from the original: that pairing is what makes the editor preview and
    //     the final render match).
    // ───────────────────────────────────────────────────────────────────────
    const plans = planVariants({
      family: probed.family,
      kind: probed.kind,
      facts: {
        durationSec: probed.durationSec,
        source:
          probed.width !== null && probed.height !== null
            ? { width: probed.width, height: probed.height }
            : null,
      },
    });

    for (const plan of plans) {
      /* The step id is the variant name, so a resumed run matches its completed
       * steps by name — renaming a variant would re-run its step, which is
       * correct and is why the ids are not indices. */
      await step.run(`variant-${plan.variant}`, () =>
        buildVariant({
          assetId,
          organizationId: probed.organizationId,
          originalKey: probed.storageKey,
          plan,
          plans,
          durationSec: probed.durationSec,
        }),
      );
    }

    // ───────────────────────────────────────────────────────────────────────
    // [3] MODERATE — stubbed. See MODERATION_STUB in the file header.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("moderate", async () => {
      await setModerationStatus(prisma, assetId, "skipped");
      return { moderationStatus: "skipped" };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [4] READY — the only transition that lets a renderer touch this asset.
    //     The probed facts are written now rather than in step 1 so that an
    //     asset is never simultaneously `processing` and claiming a duration
    //     that nothing has produced a variant for.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("mark-ready", async () => {
      await markAssetReady(prisma, assetId, {
        durationSec: probed.durationSec,
        width: probed.width,
        height: probed.height,
      });
      return { status: "ready" };
    });

    return {
      assetId,
      variants: plans.map((plan) => plan.variant),
      durationSec: probed.durationSec,
    };
  },
);

/**
 * SOURCE OF TRUTH KEYWORDS: buildVariant, STAGE_PER_STEP, RESUMABLE_INGEST
 *
 * WHAT:  Produces one variant: stage its input, run the one media operation it
 *        names, store the result, record the row.
 * WHY:   Extracted from the loop so the step body is readable and so the
 *        staging directory's lifetime is exactly one variant — see
 *        TEMP_DIR_ALWAYS_CLEANED. The input is resolved from `plan.source`
 *        rather than passed in: a variant derived from the master downloads the
 *        MASTER's key, which is what lets this function be called on a retry
 *        with nothing on local disk.
 * WHERE: The variant loop above.
 */
async function buildVariant(args: {
  assetId: string;
  organizationId: string;
  originalKey: string;
  plan: VariantPlan;
  plans: readonly VariantPlan[];
  durationSec: number | null;
}): Promise<{ variant: string; bytes: number }> {
  const { assetId, organizationId, originalKey, plan, plans } = args;

  const sourceKey =
    plan.source === "original"
      ? originalKey
      : keyForVariant(organizationId, assetId, plans, plan.source);

  const outputKey = uploadKey(organizationId, assetId, plan.filename);

  return withStagingDir(async (dir) => {
    const inputPath = dir.file("input");
    const outputPath = dir.file(plan.filename);
    await downloadToFile(sourceKey, inputPath);

    const media = await getMediaAdapter();

    try {
      if (plan.operation === "transcode") {
        /* Present by construction for a transcode plan; checked rather than
         * asserted, because the plan is data and a future entry could omit it. */
        if (plan.transcode === undefined) {
          throw new UnsupportedMediaError("This file could not be converted.");
        }
        await media.transcode({
          inputPath,
          outputPath,
          width: plan.width,
          height: plan.height,
          fit: plan.transcode.fit,
          crf: plan.transcode.crf,
          encode: plan.transcode.encode,
          /* MUTE_BACKGROUNDS_NOT_UPLOADS — decided per asset kind in the plan,
           * not here. See src/lib/media/ingest-plan.ts. */
          muted: plan.transcode.muted,
          ...(plan.transcode.fps !== undefined
            ? { fps: plan.transcode.fps }
            : {}),
        });
      } else if (plan.operation === "frame") {
        await media.extractFrame({
          inputPath,
          outputPath,
          atSec: plan.atSec ?? 0,
          width: plan.width,
        });
      } else {
        await media.renderWaveform({
          inputPath,
          outputPath,
          width: plan.width,
          height: plan.height,
        });
      }
    } catch (error) {
      if (error instanceof MediaProcessingError) {
        await markAssetFailed(prisma, assetId, error.message);
        console.error(
          `[asset.ingest] ${assetId} ${plan.variant} failed:`,
          error.detail,
        );
        throw new NonRetriableError(error.message);
      }
      if (error instanceof UnsupportedMediaError) {
        await markAssetFailed(prisma, assetId, error.message);
        throw new NonRetriableError(error.message);
      }
      throw error;
    }

    const bytes = await uploadFile({
      localPath: outputPath,
      storageKey: outputKey,
      contentType: plan.contentType,
    });

    await upsertAssetVariant(prisma, {
      assetId,
      variant: plan.variant,
      storageKey: outputKey,
      bytes,
      width: plan.width,
      height: plan.height,
    });

    return { variant: plan.variant, bytes };
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: keyForVariant
 *
 * WHAT:  The storage key an already-built variant was written to.
 * WHY:   Rebuilt from the plan rather than read back from the database. The
 *        plan is deterministic — the same asset produces the same filenames —
 *        so a read would be a round-trip to learn something already known, and
 *        it would make a derived step depend on a row the previous step wrote,
 *        which is a second way for a replay to diverge.
 * WHERE: buildVariant, for any plan whose `source` is not `original`.
 */
function keyForVariant(
  organizationId: string,
  assetId: string,
  plans: readonly VariantPlan[],
  source: Exclude<VariantPlan["source"], "original">,
): string {
  const sourcePlan = plans.find((candidate) => candidate.variant === source);
  if (sourcePlan === undefined) {
    throw new NonRetriableError(
      `[asset.ingest] Variant plan refers to "${source}", which this plan does not build.`,
    );
  }
  return uploadKey(organizationId, assetId, sourcePlan.filename);
}
