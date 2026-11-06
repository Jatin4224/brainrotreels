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

import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

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
 *        STREAMED_NOT_BUFFERED. This used to read the whole body into memory
 *        with `arrayBuffer()` — the line its own comment nominated as the one
 *        to change when renders outgrew it. It is changed now, ahead of that,
 *        because the failure mode was bad out of proportion to the saving: the
 *        download, the R2 upload, the poster extraction and the row
 *        transaction all sit inside ONE `step.run`, bounded by the serve
 *        route's `maxDuration = 300`. A body large or slow enough to push that
 *        step over the limit made Inngest retry the entire multi-hundred-
 *        megabyte copy, and after two attempts `onFailure` marked a perfectly
 *        good, fully paid render as failed.
 *
 *        Piping to disk removes the memory ceiling entirely and makes the step
 *        bounded by bandwidth rather than by heap. Both callers get it, which
 *        is why it was factored out here in the first place.
 *
 *        The size is read back with `stat` rather than counted while piping:
 *        the bytes ON DISK are what the caller records on the AssetVariant
 *        row, and that is the only number certainly true of the file the next
 *        step will read.
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

  const body = response.body;
  if (body === null) {
    throw new Error(
      `[media/staging] Could not download ${label}: the response had no body.`,
    );
  }

  /* `pipeline` rather than `.pipe()`: it propagates an error from either end
   * and destroys both, so a connection dropped mid-copy rejects here instead
   * of leaving a truncated file that looks like a complete one. */
  await pipeline(readChunks(body), createWriteStream(destinationPath));

  const { size } = await stat(destinationPath);
  return size;
}

/**
 * SOURCE OF TRUTH KEYWORDS: readChunks, STREAMED_NOT_BUFFERED
 *
 * WHAT:  A web `ReadableStream` as an async iterable of chunks.
 * WHY:   `node:stream`'s `Readable.fromWeb` wants Node's OWN web-stream type,
 *        and `fetch`'s body is typed as the DOM one — the two are structurally
 *        different in TypeScript's lib even though they are the same object at
 *        runtime, and bridging them with a cast is the kind of assertion that
 *        is right until a lib update makes it silently wrong. Reading through
 *        the standard reader interface needs no assertion at all, and
 *        `pipeline` takes an async iterable directly.
 *
 *        The lock is released in a `finally` so an error mid-copy does not
 *        leave the stream locked; `pipeline` destroys the destination itself.
 * WHERE: downloadUrlToFile.
 */
async function* readChunks(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value !== undefined) yield value;
    }
  } finally {
    reader.releaseLock();
  }
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
