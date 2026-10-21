/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: listNarrationLines, replaceNarrationLines,
 *   findCachedAudio, markLineSynthesizing, markLineReady, markLineFailed,
 *   findNarrationLine, narrationTotals, CACHE_BY_CONTENT,
 *   REUSE_WITHIN_THE_WORKSPACE, TENANT_SCOPED_QUERY, DbClient
 *
 * WHAT:  The reads and writes of the `narration_line` table, and the cache
 *        lookup that decides whether a line has to be paid for again.
 *
 * WHY:   CACHE_BY_CONTENT is the phase's step 4 and the reason this file
 *        matters more than its size suggests. Before synthesising anything,
 *        a ready line with the same `textHash` is looked up and its
 *        `audioAssetId` reused. That is what makes "re-running generation with
 *        unchanged text makes zero provider calls" true — one of the phase's
 *        own checks — and what makes editing one line re-synthesise only that
 *        line.
 *
 *        The hash covers the VOICE as well as the text
 *        (TEXT_HASH_COVERS_THE_VOICE in src/lib/narration/hash.ts), so a
 *        recast misses the cache correctly rather than returning the previous
 *        speaker's audio.
 *
 *        REUSE_WITHIN_THE_WORKSPACE, and the boundary is deliberate. The
 *        lookup is scoped to one `organizationId`: two workspaces that happen
 *        to write the same sentence in the same voice each pay once. Sharing
 *        across tenants would be cheaper and is not worth it — the audio is a
 *        tenant's asset, under their storage prefix, deletable by them, and a
 *        cross-tenant reuse would hand one workspace a file that another one
 *        can delete out from under it.
 *
 *        TENANT_SCOPED_QUERY throughout: every function takes an
 *        `organizationId` and puts it in the WHERE clause even when it also
 *        has a primary key.
 * WHERE: src/inngest/functions/project-tts.ts and line-resynth.ts.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma";
import { type DbClient } from "@/lib/config/prisma";
import type { NarrationStatus } from "@/lib/types/voice";

/**
 * SOURCE OF TRUTH KEYWORDS: NARRATION_LINE_SELECT, NarrationLineRow
 *
 * WHAT:  The columns the narration panel and the timeline builder need.
 * WHY:   `textHash` is included although nothing renders it — Phase 08's
 *        aligner and Phase 09's timeline builder both need to know which
 *        recording a line refers to, and re-deriving the hash client-side
 *        would be a second implementation of the cache key.
 * WHERE: listNarrationLines.
 */
export const NARRATION_LINE_SELECT = {
  id: true,
  projectId: true,
  position: true,
  speakerTag: true,
  voiceId: true,
  text: true,
  textHash: true,
  audioAssetId: true,
  durationSec: true,
  status: true,
  error: true,
} as const satisfies Prisma.NarrationLineSelect;

export type NarrationLineRow = Prisma.NarrationLineGetPayload<{
  select: typeof NARRATION_LINE_SELECT;
}>;

export async function listNarrationLines(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<NarrationLineRow[]> {
  return db.narrationLine.findMany({
    where: { organizationId, projectId },
    select: NARRATION_LINE_SELECT,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

export async function findNarrationLine(
  db: DbClient,
  organizationId: string,
  id: string,
): Promise<NarrationLineRow | null> {
  return db.narrationLine.findFirst({
    where: { id, organizationId },
    select: NARRATION_LINE_SELECT,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: replaceNarrationLines, REPLACE_IS_ATOMIC,
 *   CACHE_SURVIVES_REPLACEMENT
 *
 * WHAT:  Rewrites a project's narration lines from a freshly split script.
 *
 * WHY:   REPLACE_IS_ATOMIC — the delete and the inserts are one transaction,
 *        because the halfway state is a project with no narration at all.
 *
 *        CACHE_SURVIVES_REPLACEMENT is the subtle part and it is what makes
 *        re-running cheap. The ROWS are replaced, but the AUDIO is not
 *        deleted: each new row carries its `textHash`, and the caller looks
 *        each hash up against lines that already have audio before deciding to
 *        synthesise. So a script edited in one place produces a full set of
 *        new rows of which all but one are immediately satisfied from
 *        existing assets.
 *
 *        Deleting the audio assets here instead — the obvious "clean up after
 *        yourself" — would make every regeneration cost a full re-synthesis,
 *        which is precisely the bill this design exists to avoid. The assets
 *        belong to the workspace and are cleaned up with the project.
 *
 *        Positions come from the SPLITTER (POSITION_IS_STABLE), never from a
 *        model and never renumbered here.
 * WHERE: The TTS workflow's first step.
 */
export async function replaceNarrationLines(
  db: DbClient,
  args: {
    organizationId: string;
    projectId: string;
    lines: readonly {
      position: number;
      speakerTag: string;
      voiceId: string | null;
      text: string;
      textHash: string;
    }[];
  },
): Promise<number> {
  await db.narrationLine.deleteMany({
    where: { organizationId: args.organizationId, projectId: args.projectId },
  });

  if (args.lines.length === 0) return 0;

  const result = await db.narrationLine.createMany({
    data: args.lines.map((line) => ({
      organizationId: args.organizationId,
      projectId: args.projectId,
      position: line.position,
      speakerTag: line.speakerTag,
      voiceId: line.voiceId,
      text: line.text,
      textHash: line.textHash,
    })),
  });

  return result.count;
}

/**
 * SOURCE OF TRUTH KEYWORDS: findCachedAudio, CACHE_BY_CONTENT,
 *   REUSE_WITHIN_THE_WORKSPACE
 *
 * WHAT:  Audio that already exists for this exact text in this exact voice.
 *
 * WHY:   The whole point of `textHash`. Three filters and each is doing work:
 *
 *          - `organizationId` — REUSE_WITHIN_THE_WORKSPACE, see the header.
 *          - `textHash` — the content key, which already covers the voice.
 *          - `status: 'ready'` and a non-null asset — a pending, synthesizing
 *            or failed line has no file behind it, and reusing one would set
 *            a new line to `ready` pointing at nothing.
 *
 *        `voiceId` is matched as well as the hash, which is belt and braces:
 *        the hash already encodes it, so this can only differ if two voices
 *        collided in a 64-bit space. It costs nothing and turns an
 *        astronomically unlikely collision into a cache miss rather than a
 *        video in the wrong voice.
 *
 *        Returns the newest match, because an older one is likelier to have
 *        been superseded by a re-synthesis.
 * WHERE: Before every synthesis, in the TTS fan-out and in `line.resynth`.
 */
export async function findCachedAudio(
  db: DbClient,
  args: {
    organizationId: string;
    textHash: string;
    voiceId: string;
  },
): Promise<{ audioAssetId: string; durationSec: number } | null> {
  const hit = await db.narrationLine.findFirst({
    where: {
      organizationId: args.organizationId,
      textHash: args.textHash,
      voiceId: args.voiceId,
      status: "ready",
      audioAssetId: { not: null },
      durationSec: { not: null },
    },
    select: { audioAssetId: true, durationSec: true },
    orderBy: { updatedAt: "desc" },
  });

  if (hit?.audioAssetId == null || hit.durationSec == null) return null;

  return { audioAssetId: hit.audioAssetId, durationSec: hit.durationSec };
}

/**
 * SOURCE OF TRUTH KEYWORDS: markLineSynthesizing, TERMINAL_IS_FINAL
 *
 * WHAT:  Claims a line for synthesis.
 * WHY:   `updateMany` filtered on `pending`, so two concurrent runs cannot
 *        both start the same line — the second matches no row and the caller
 *        sees a count of zero. The fan-out is per-line and Inngest retries
 *        steps, so this race is ordinary rather than theoretical.
 * WHERE: The start of each fan-out step.
 */
export async function markLineSynthesizing(
  db: DbClient,
  organizationId: string,
  id: string,
): Promise<number> {
  const result = await db.narrationLine.updateMany({
    where: { id, organizationId, status: { in: ["pending", "failed"] } },
    data: { status: "synthesizing", error: null },
  });
  return result.count;
}

/**
 * SOURCE OF TRUTH KEYWORDS: markLineReady, AUDIO_AND_DURATION_TOGETHER
 *
 * WHAT:  Records a line's audio and its MEASURED duration.
 * WHY:   AUDIO_AND_DURATION_TOGETHER — one write, because a line that is
 *        `ready` with a null duration is one the timeline cannot place, and
 *        the timeline is the only consumer. The duration is the measured one
 *        from ffmpeg, never the provider's estimate
 *        (DURATION_IS_MEASURED_NOT_CLAIMED).
 * WHERE: After synthesis, and on a cache hit.
 */
export async function markLineReady(
  db: DbClient,
  organizationId: string,
  id: string,
  audio: { audioAssetId: string; durationSec: number },
): Promise<number> {
  const result = await db.narrationLine.updateMany({
    where: { id, organizationId },
    data: {
      status: "ready",
      error: null,
      audioAssetId: audio.audioAssetId,
      durationSec: audio.durationSec,
    },
  });
  return result.count;
}

/**
 * SOURCE OF TRUTH KEYWORDS: markLineFailed, PER_LINE_FAILURE
 *
 * WHAT:  Records why one line has no audio.
 * WHY:   PER_LINE_FAILURE. A failure is recorded against the LINE, not the
 *        project, because one line failing is recoverable — the whole caching
 *        design exists so a re-run synthesises only what is missing. A
 *        project-level failure flag would throw away every successful line's
 *        work on the next attempt.
 * WHERE: The fan-out's error path.
 */
export async function markLineFailed(
  db: DbClient,
  organizationId: string,
  id: string,
  error: string,
): Promise<number> {
  const result = await db.narrationLine.updateMany({
    where: { id, organizationId },
    /* Truncated: the column is unbounded text but the UI renders this inline,
     * and a provider stack trace in a list row is not a readable error. Same
     * cap and same reason as markAssetFailed. */
    data: { status: "failed", error: error.slice(0, 500) },
  });
  return result.count;
}

/**
 * SOURCE OF TRUTH KEYWORDS: updateLineText, LINE_EDIT_INVALIDATES_ONE_LINE
 *
 * WHAT:  Changes one line's words and resets it for re-synthesis.
 *
 * WHY:   LINE_EDIT_INVALIDATES_ONE_LINE, the phase's own check. The new text
 *        gets a new hash, the audio is detached, and the status goes back to
 *        `pending` — so the next run synthesises this line and finds every
 *        other line in the cache.
 *
 *        The old `audioAssetId` is CLEARED rather than deleted. The asset may
 *        still be the cache entry for an identical line elsewhere in the
 *        project, and deleting it would break that line's playback while
 *        leaving its row saying `ready`. Orphaned audio is swept with the
 *        project; a dangling reference is not recoverable.
 * WHERE: `line.resynth`, and Phase 15's editor.
 */
export async function updateLineText(
  db: DbClient,
  organizationId: string,
  id: string,
  text: string,
  textHash: string,
): Promise<number> {
  const result = await db.narrationLine.updateMany({
    where: { id, organizationId },
    data: {
      text,
      textHash,
      audioAssetId: null,
      durationSec: null,
      status: "pending",
      error: null,
    },
  });
  return result.count;
}

/**
 * SOURCE OF TRUTH KEYWORDS: narrationTotals, NARRATION_PROGRESS
 *
 * WHAT:  How much of a project's narration exists, and how long it runs.
 * WHY:   Computed by the DATABASE rather than by loading every line, because
 *        this drives a progress display that polls while a fan-out runs — and
 *        a script is dozens of lines whose text is the largest thing on the
 *        row.
 *
 *        The total duration only counts `ready` lines, which is the honest
 *        number while synthesis is in flight: it grows as lines land, rather
 *        than claiming a length the audio does not yet have.
 * WHERE: The narration panel's progress, and the TTS workflow's return value.
 */
export async function narrationTotals(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<{
  total: number;
  ready: number;
  failed: number;
  pending: number;
  durationSec: number;
}> {
  const [grouped, durations] = await Promise.all([
    db.narrationLine.groupBy({
      by: ["status"],
      where: { organizationId, projectId },
      _count: { _all: true },
    }),
    db.narrationLine.aggregate({
      where: { organizationId, projectId, status: "ready" },
      _sum: { durationSec: true },
    }),
  ]);

  const countFor = (status: NarrationStatus): number =>
    grouped.find((row) => row.status === status)?._count._all ?? 0;

  const ready = countFor("ready");
  const failed = countFor("failed");
  const pending = countFor("pending") + countFor("synthesizing");

  return {
    total: ready + failed + pending,
    ready,
    failed,
    pending,
    durationSec: Math.round((durations._sum.durationSec ?? 0) * 100) / 100,
  };
}
