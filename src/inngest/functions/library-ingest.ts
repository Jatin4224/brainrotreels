/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: libraryIngestFunction, library/requested,
 *   FETCH_ONCE_THEN_HAND_OVER, MANIFEST_IS_RE_READ_NOT_REPLAYED,
 *   OBJECT_EXISTS_IS_A_SKIP, LIBRARY_IS_APPROVED_BY_REVIEW, NonRetriableError
 *
 * WHAT:  Brings one curated library row's bytes into our bucket, then hands the
 *        asset to the ordinary ingest pipeline.
 *
 * WHY:   FETCH_ONCE_THEN_HAND_OVER. This workflow does exactly one thing the
 *        upload path does not — pull a third party's URL into `library/…` — and
 *        then sends `asset/uploaded` so the PROBE, the variants and the
 *        readiness transition all happen in `asset-ingest`, which owns them.
 *        The alternative, a second ingest pipeline for library rows, is how
 *        "library rows get the same variants as uploads" stops being true six
 *        months later: one of the two pipelines gets a fix and the other does
 *        not. Two producers, one pipeline.
 *
 *        The fetch cannot happen in the `sync` mutation, for the usual reason —
 *        a mutation runs inside a 10-second Prisma transaction and a sync of
 *        forty loops is forty multi-megabyte downloads.
 *
 *        MANIFEST_IS_RE_READ_NOT_REPLAYED. The event carries the manifest KEY,
 *        never the entry. The manifest is code, so putting its row in an event
 *        payload would mean a run that resumes after a correction re-applies
 *        the licence string the operator just fixed — and SMALL_STEP_PAYLOADS
 *        says the same thing for a different reason. The key is resolved here,
 *        on the far side of the queue.
 *
 *        OBJECT_EXISTS_IS_A_SKIP. The object key is derived from the asset id,
 *        which is derived from the manifest key
 *        (MANIFEST_KEY_IS_THE_IDENTITY), so a re-sync lands on the same key —
 *        and a `head` that finds it there skips the download. That makes a
 *        re-sync after a licence correction free, which is the whole point of
 *        being able to re-sync at all. It also means a half-finished sync
 *        resumes rather than re-downloading everything it already had.
 *
 *        LIBRARY_IS_APPROVED_BY_REVIEW is enforced in `asset-ingest`, not
 *        here — see the note on its moderate step. In short: a customer's
 *        upload is held `pending` because nothing has looked at its pixels,
 *        and a library row is not, because adding it to the manifest IS a
 *        person looking at it, in a diff.
 * WHERE: Registered in src/inngest/functions/index.ts, served at /api/inngest.
 *        Triggered by `library/requested`, sent by `backgroundLibrary.sync`.
 */

import { NonRetriableError } from "inngest";
import { z } from "zod";

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import { enqueue } from "@/lib/adapters/jobs";
import { getStorageAdapter } from "@/lib/adapters/storage";
import { prisma } from "@/lib/config/prisma";
import { findManifestEntry } from "@/lib/library/backgrounds.manifest";
import { downloadUrlToFile, uploadFile, withStagingDir } from "@/lib/media";
import {
  findAssetById,
  markAssetFailed,
} from "@/services/assets.service";
import { recordLibraryBytes } from "@/services/backgrounds.service";

/**
 * SOURCE OF TRUTH KEYWORDS: libraryRequestedEventSchema, EVENT_PAYLOAD_PARSED
 *
 * WHAT:  The shape of a `library/requested` event's data.
 * WHY:   EVENT_PAYLOAD_PARSED, as everywhere: `JobEvent.data` crosses a queue
 *        as JSON with no types attached and may have been enqueued by an older
 *        deploy. `organizationId` is the PORTAL workspace that triggered the
 *        sync — it owns none of this and is carried only so the downstream
 *        ingest has a workspace to scope its moderation record to, and so its
 *        concurrency key has something to group by.
 * WHERE: The first step below.
 */
const libraryRequestedEventSchema = z.object({
  manifestKey: z.string().min(1),
  assetId: z.string().min(1),
  organizationId: z.string().min(1),
});

const failureEventSchema = z.object({
  data: z.object({
    event: z.object({ data: libraryRequestedEventSchema }),
  }),
});

export const libraryIngestFunction = inngestClient.createFunction(
  {
    id: "library-ingest",
    name: "Fetch a curated library asset",
    triggers: [{ event: "library/requested" }],
    /* Two retries. The failure worth retrying here is a flaky third-party host,
     * which clears fast or not at all — the same reasoning as asset-ingest. */
    retries: 2,
    /* Two at a time, keyed on nothing in particular: a catalogue sync is an
     * operator action with no customer waiting, and the thing worth protecting
     * is the worker pool that tenants' uploads share. Deliberately LOWER than
     * the upload path's per-workspace limit of one, because every library run
     * is serialised against the same single key here. */
    concurrency: { key: "event.data.organizationId", limit: 2 },
    onFailure: async ({ event }) => {
      const parsed = failureEventSchema.safeParse(event);
      if (!parsed.success) {
        console.error(
          "[library.ingest] Failure handler could not read the original event.",
        );
        return;
      }
      /* The row is the operator's, so the message is for an operator: it names
       * the manifest key, which is the thing they can act on. */
      await markAssetFailed(
        prisma,
        parsed.data.data.event.data.assetId,
        `Could not fetch the source for manifest entry "${parsed.data.data.event.data.manifestKey}". Check the sourceUrl and re-sync.`,
      );
    },
  },
  async ({ event, step }) => {
    const input = libraryRequestedEventSchema.safeParse(event.data);
    if (!input.success) {
      throw new NonRetriableError(
        `[library.ingest] Event payload is not valid: ${input.error.message}`,
      );
    }
    const { assetId, manifestKey, organizationId } = input.data;

    // ───────────────────────────────────────────────────────────────────────
    // [1] FETCH — the one thing this workflow exists to do. Idempotent: an
    //     object already at the key is a skip (OBJECT_EXISTS_IS_A_SKIP).
    // ───────────────────────────────────────────────────────────────────────
    const fetched = await step.run("fetch-source", async () => {
      /* MANIFEST_IS_RE_READ_NOT_REPLAYED — resolved from the key, here. */
      const entry = findManifestEntry(manifestKey);
      if (entry === undefined) {
        await markAssetFailed(
          prisma,
          assetId,
          `Manifest entry "${manifestKey}" no longer exists. Remove the catalogue row or restore the entry.`,
        );
        throw new NonRetriableError(
          `[library.ingest] Manifest entry "${manifestKey}" is gone.`,
        );
      }

      const asset = await findAssetById(prisma, assetId);
      if (asset === null) {
        /* The sync's row was deleted while the event was in flight. Nothing to
         * mark and nothing to leak. */
        throw new NonRetriableError(
          `[library.ingest] Asset ${assetId} no longer exists.`,
        );
      }

      /* A row that is not a library row must never be written to a library
       * key — that is what makes `isLibraryKey` a safe public-serving signal
       * (LIBRARY_IS_SERVED_FROM_THE_CDN in src/services/assets.service.ts).
       * Only `sync` creates these rows, so this is a corruption check rather
       * than an input check, and it fails closed. */
      if (asset.organizationId !== null) {
        throw new NonRetriableError(
          `[library.ingest] Asset ${assetId} belongs to a workspace and is not a library row.`,
        );
      }

      const storage = await getStorageAdapter();
      const existing = await storage.head(asset.storageKey);
      if (existing !== null && existing.bytes > 0) {
        await recordLibraryBytes(prisma, assetId, existing.bytes);
        return { bytes: existing.bytes, skipped: true };
      }

      const bytes = await withStagingDir(async (dir) => {
        const localPath = dir.file("source");
        /* FOREIGN_BYTES — the label is what makes the failure readable, since
         * the URL is somebody else's and may be long and opaque. */
        await downloadUrlToFile(
          entry.sourceUrl,
          localPath,
          `the source for library entry "${manifestKey}"`,
        );
        return uploadFile({
          localPath,
          storageKey: asset.storageKey,
          contentType: asset.contentType,
        });
      });

      await recordLibraryBytes(prisma, assetId, bytes);
      return { bytes, skipped: false };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [2] HAND OVER — the ordinary ingest takes it from here: probe, variants,
    //     moderate, ready. FETCH_ONCE_THEN_HAND_OVER.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("request-ingest", async () => {
      await enqueue({
        name: "asset/uploaded",
        data: { assetId, organizationId },
        /* Keyed on the asset, as the upload path's is: a re-sync of an
         * unchanged row collapses to the run that already processed it, and a
         * row whose BYTES need replacing is a new manifest key and therefore a
         * new id (MANIFEST_KEY_IS_THE_IDENTITY). */
        id: `asset-ingest-${assetId}`,
      });
      return { queued: true };
    });

    return { assetId, manifestKey, bytes: fetched.bytes, skipped: fetched.skipped };
  },
);
