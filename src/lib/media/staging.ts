/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: withStagingDir, downloadToFile, uploadFile,
 *   StagingDir, STAGE_PER_STEP, TEMP_DIR_ALWAYS_CLEANED, MEDIA_STAGING_PREFIX
 *
 * WHAT:  Moves objects between the bucket and local files, inside a temporary
 *        directory that is always removed.
 * WHY:   ffmpeg needs real files it can seek in, and the bucket holds objects.
 *        This is the whole of that translation, in one place, so the workflow
 *        reads as steps rather than as plumbing.
 *
 *        STAGE_PER_STEP. Every workflow step stages its OWN input and throws
 *        the directory away before returning. That looks wasteful — the proxy
 *        step re-downloads the master the previous step just uploaded — and it
 *        is the only correct design: Inngest steps are independently retried
 *        and may run on different machines, so a file left on disk by step two
 *        may simply not exist when step three runs. A pipeline that assumed
 *        otherwise would work in development, where everything is one process,
 *        and fail in production on exactly the retries it exists to survive.
 *
 *        TEMP_DIR_ALWAYS_CLEANED: the `finally` is not politeness. A worker
 *        container's disk is small and long-lived, and a few hundred leaked
 *        half-gigabyte transcodes fills it — at which point every ingest fails
 *        at once, for a reason that looks nothing like the cause.
 *
 *        Downloads go through a SIGNED URL rather than a new adapter method,
 *        because `signedGetUrl` is already on the StorageAdapter contract and
 *        adding `getObject` would mean every future provider implementing a
 *        streaming read that only this file uses.
 * WHERE: src/inngest/functions/asset-ingest.ts. Server-only — it writes to the
 *        filesystem and holds bucket credentials by transitive import.
 */

import "server-only";

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getStorageAdapter } from "@/lib/adapters/storage";

/** Named so a stray directory in a worker's /tmp is identifiable. */
export const MEDIA_STAGING_PREFIX = "brainrot-ingest-";

/** The signed URL only has to live long enough for one download inside one
 *  step; anything longer is a credential sitting in a workflow's memory. */
const STAGING_GET_TTL_SECONDS = 600;

export interface StagingDir {
  /** Absolute path to the temporary directory. */
  path: string;
  /** Builds a path inside it. Never takes a path separator — see uploadFile. */
  file(name: string): string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: withStagingDir, TEMP_DIR_ALWAYS_CLEANED
 *
 * WHAT:  Runs `work` with a fresh temporary directory and removes it after,
 *        whether `work` succeeded or threw.
 * WHY:   A callback rather than create/destroy functions, because the cleanup
 *        has to be unskippable — a `try/finally` at every call site is a rule
 *        someone eventually forgets, and the symptom (see
 *        TEMP_DIR_ALWAYS_CLEANED) appears days later on a different upload.
 * WHERE: Wraps the body of every media step in the ingest workflow.
 */
export async function withStagingDir<T>(
  work: (dir: StagingDir) => Promise<T>,
): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), MEDIA_STAGING_PREFIX));

  try {
    return await work({
      path,
      file: (name: string) => join(path, name),
    });
  } finally {
    /* `force` so a step that already cleaned up, or never wrote anything,
     * does not turn a successful ingest into a failure at the last line. */
    await rm(path, { recursive: true, force: true });
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: downloadToFile
 *
 * WHAT:  Fetches one stored object to a local path and returns its byte count.
 * WHY:   Buffers the whole body rather than streaming it to disk. That is a
 *        deliberate bound, not an oversight: the per-plan upload cap
 *        (UPLOAD_BYTES_PER_PLAN in src/lib/types/asset.ts) is what makes it
 *        safe, and it keeps this function free of stream plumbing that Node's
 *        fetch and fs APIs make surprisingly easy to get wrong. If that cap
 *        ever rises past a worker's memory, this is the line to change.
 * WHERE: Every media step's first act.
 */
export async function downloadToFile(
  storageKey: string,
  destinationPath: string,
): Promise<number> {
  const storage = await getStorageAdapter();
  const url = await storage.signedGetUrl(storageKey, STAGING_GET_TTL_SECONDS);

  return downloadUrlToFile(url, destinationPath, `object "${storageKey}"`);
}

/**
 * SOURCE OF TRUTH KEYWORDS: downloadUrlToFile, FOREIGN_BYTES, OUTPUT_IS_COPIED_NOT_SERVED
 *
 * WHAT:  Fetches an arbitrary URL to a local path and returns its byte count.
 * WHY:   OUTPUT_IS_COPIED_NOT_SERVED. A cloud render leaves its MP4 in the
 *        RENDER PROVIDER's bucket, not ours, so the finalize step has to pull
 *        bytes from a URL that no storage adapter knows about — which
 *        `downloadToFile` cannot do, because it starts by signing a key.
 *        Factored out rather than duplicated so both callers share the one
 *        buffering decision and the one error shape.
 *
 *        FOREIGN_BYTES: the URL is the provider's, so `label` exists to keep
 *        the failure readable. "Could not download object orgs/x/y" and "could
 *        not download the rendered video" send an operator to completely
 *        different places, and a raw provider URL in the message is a long
 *        signed string that tells them neither.
 *
 *        Buffers the whole body, with the same bound and the same caveat as
 *        `downloadToFile`: a vertical render of a short-form video is tens of
 *        megabytes, which is well inside a worker's memory. If renders ever
 *        get long enough for that to stop being true, this is the line to
 *        change — and it will be the same change in one place for both.
 * WHERE: The finalize step of src/inngest/functions/project-render.ts.
 */
export async function downloadUrlToFile(
  url: string,
  destinationPath: string,
  label = "the requested file",
): Promise<number> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `[media/staging] Could not download ${label}: ${response.status} ${response.statusText}`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(destinationPath, bytes);
  return bytes.byteLength;
}

/**
 * SOURCE OF TRUTH KEYWORDS: uploadFile
 *
 * WHAT:  Writes a local file to a storage key and returns its byte count.
 * WHY:   Returns the size because the caller records it on the AssetVariant
 *        row, and reading it from the file we just wrote is the only number
 *        that is certainly true — a size computed before the encode finished
 *        would be wrong for every variant.
 *        Uses `putObject` rather than a signed PUT: this is server-side, so
 *        there is no browser to hand a URL to, and signing one would be a
 *        round-trip for nothing.
 * WHERE: Every media step's last act.
 */
export async function uploadFile(args: {
  localPath: string;
  storageKey: string;
  contentType: string;
}): Promise<number> {
  const storage = await getStorageAdapter();
  const body = await readFile(args.localPath);

  await storage.putObject({
    key: args.storageKey,
    body,
    contentType: args.contentType,
  });

  return body.byteLength;
}
