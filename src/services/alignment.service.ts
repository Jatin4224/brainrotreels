/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: findAlignment, saveAlignment, readAlignmentWords,
 *   listAlignableLines, applyCaptionsToTimeline, alignmentPlan,
 *   TENANT_SCOPED_QUERY, WORDS_ARE_VALIDATED_ON_READ, CACHE_BY_AUDIO,
 *   TIMELINE_IS_OPTIONAL_UNTIL_PHASE_09, DbClient
 *
 * WHAT:  The reads and writes of the `alignment` table, the narration rows an
 *        alignment is built from, and the write that puts captions into a
 *        timeline document.
 *
 * WHY:   WORDS_ARE_VALIDATED_ON_READ. `Alignment.words` is jsonb, so what
 *        comes back from the database is `unknown` — and it was written by a
 *        possibly older release. It is parsed with the document's OWN
 *        `wordTokenSchema` on the way out, which means a row written before a
 *        field existed fails loudly here rather than producing captions with
 *        `NaN` timings that simply never appear on screen.
 *
 *        CACHE_BY_AUDIO: `alignmentPlan` is the one place that decides
 *        whether a provider call is needed, so the workflow cannot get the
 *        cache check subtly different from the UI's "already aligned" badge.
 *        A DEGRADED row is deliberately NOT a cache hit — the audio is
 *        unchanged, so the hash matches forever, and without this exception a
 *        provider outage would freeze a project's captions at evenly
 *        distributed guesses for good.
 *
 *        TIMELINE_IS_OPTIONAL_UNTIL_PHASE_09. Nothing writes `Timeline.doc`
 *        yet — the generate pipeline is Phase 09 — so every write here is a
 *        no-op when a project has no document, and says so in its return
 *        value rather than throwing. Aligning a project with no timeline is a
 *        perfectly good thing to do: the words are stored, and the document
 *        picks them up when it is built. Writing a document from scratch here
 *        instead would mean this phase inventing a timeline shape that Phase
 *        09 would then have to agree with.
 *
 *        TENANT_SCOPED_QUERY throughout: `alignment` has no `organizationId`
 *        of its own — it hangs off the project, the same way `timeline` does
 *        — so every read and write goes through a `project` filter that names
 *        the workspace. A lookup by `projectId` alone would hand one
 *        workspace another's word timings to anybody who guessed an id.
 * WHERE: src/trpc/routers/captions.ts and
 *        src/inngest/functions/project-align.ts.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma";
import { alignmentAudioHash } from "@/lib/alignment";
import {
  buildCaptionTrack,
  CAPTION_TRACK_ID,
  DEFAULT_CAPTION_STYLE_ID,
  getCaptionStyle,
} from "@/lib/captions";
import { type DbClient } from "@/lib/config/prisma";
import {
  migrate,
  wordTokenSchema,
  type TimelineDoc,
  type WordToken,
} from "@/lib/timeline";
import { jsonObjectSchema } from "@/lib/types/json";
import {
  captionSettingsSchema,
  type CaptionPosition,
  type CaptionSettings,
} from "@/lib/types/caption";

/**
 * SOURCE OF TRUTH KEYWORDS: ALIGNMENT_SELECT, AlignmentRow
 *
 * The columns every consumer needs. `words` is included because an alignment
 * is only ever read in order to use it — there is no list screen of
 * alignments and no reason to pay for the row without the payload.
 */
export const ALIGNMENT_SELECT = {
  projectId: true,
  words: true,
  audioHash: true,
  engine: true,
  degraded: true,
  updatedAt: true,
} as const satisfies Prisma.AlignmentSelect;

export type AlignmentRow = Prisma.AlignmentGetPayload<{
  select: typeof ALIGNMENT_SELECT;
}>;

/**
 * SOURCE OF TRUTH KEYWORDS: findAlignment, TENANT_SCOPED_QUERY
 *
 * WHAT:  A project's alignment, if it has one and the workspace owns it.
 * WHERE: The captions panel, the align workflow, the apply mutation.
 */
export async function findAlignment(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<AlignmentRow | null> {
  return db.alignment.findFirst({
    where: { projectId, project: { organizationId } },
    select: ALIGNMENT_SELECT,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: readAlignmentWords, WORDS_ARE_VALIDATED_ON_READ
 *
 * WHAT:  The stored words, parsed.
 * WHY:   Returns an EMPTY array rather than throwing when the payload does
 *        not parse, and logs. A corrupt alignment is a project with no
 *        captions, which is recoverable by re-aligning; a throw here would
 *        take down the captions screen, which is the one place a customer
 *        could press that button from.
 * WHERE: Every consumer of an alignment.
 */
export function readAlignmentWords(row: AlignmentRow): WordToken[] {
  const parsed = wordTokenSchema.array().safeParse(row.words);
  if (parsed.success) return parsed.data;

  console.error(
    `[alignment.service] ${row.projectId}: stored words did not parse; treating the project as unaligned.`,
    parsed.error.issues.slice(0, 3),
  );
  return [];
}

/**
 * SOURCE OF TRUTH KEYWORDS: saveAlignment, UPSERT_BY_PROJECT
 *
 * WHAT:  Writes (or replaces) a project's word timings.
 * WHY:   An UPSERT keyed on `projectId`, because an alignment is a property
 *        of the project rather than an event in its history — the second run
 *        replaces the first. Keeping old alignments would need a "which one
 *        is current" column that every reader would have to respect, to
 *        preserve timings nobody can use once the audio has changed.
 * WHERE: The align workflow, on both the aligned and the degraded path.
 */
export async function saveAlignment(
  db: DbClient,
  args: {
    projectId: string;
    words: readonly WordToken[];
    audioHash: string;
    engine: string;
    degraded: boolean;
  },
): Promise<void> {
  /* Through the json schema rather than a cast — a `WordToken` is already
   * json by construction, and parsing says so to the type system without a
   * TypeScript bypass. */
  const words = args.words.map((word) => jsonObjectSchema.parse(word));

  await db.alignment.upsert({
    where: { projectId: args.projectId },
    create: {
      projectId: args.projectId,
      words,
      audioHash: args.audioHash,
      engine: args.engine,
      degraded: args.degraded,
    },
    update: {
      words,
      audioHash: args.audioHash,
      engine: args.engine,
      degraded: args.degraded,
    },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: AlignableLine, listAlignableLines,
 *   READY_LINES_ONLY
 *
 * WHAT:  The recorded narration, in order, with everything an alignment
 *        needs.
 * WHY:   READY_LINES_ONLY — a line that failed or is still synthesising has
 *        no audio to align and no duration to distribute across. Including
 *        it would put a run of zero-length words into the document at the
 *        position where the missing line should be, which silently shifts
 *        nothing and silently captions nothing. The count of skipped lines is
 *        surfaced instead, so the UI can say the narration is incomplete.
 * WHERE: alignmentPlan and the align workflow.
 */
export interface AlignableLine {
  id: string;
  position: number;
  speakerTag: string;
  text: string;
  textHash: string;
  audioAssetId: string;
  durationSec: number;
}

export async function listAlignableLines(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<{ lines: AlignableLine[]; skipped: number }> {
  const rows = await db.narrationLine.findMany({
    where: { organizationId, projectId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      position: true,
      speakerTag: true,
      text: true,
      textHash: true,
      audioAssetId: true,
      durationSec: true,
      status: true,
    },
  });

  const lines: AlignableLine[] = [];
  let skipped = 0;

  for (const row of rows) {
    if (
      row.status !== "ready" ||
      row.audioAssetId === null ||
      row.durationSec === null
    ) {
      skipped += 1;
      continue;
    }
    lines.push({
      id: row.id,
      position: row.position,
      speakerTag: row.speakerTag,
      text: row.text,
      textHash: row.textHash,
      audioAssetId: row.audioAssetId,
      durationSec: row.durationSec,
    });
  }

  return { lines, skipped };
}

/**
 * SOURCE OF TRUTH KEYWORDS: AlignmentPlan, alignmentPlan, CACHE_BY_AUDIO,
 *   DEGRADED_IS_NOT_A_CACHE_HIT
 *
 * WHAT:  Whether this project needs a provider call, and what it would align.
 *
 * WHY:   ONE place decides, so the workflow's behaviour and the panel's
 *        "Captions are up to date" badge cannot disagree. The phase's check
 *        — "re-aligning unchanged audio makes zero provider calls" — is this
 *        function returning `cached: true`.
 *
 *        DEGRADED_IS_NOT_A_CACHE_HIT: see the file header. A degraded row's
 *        hash matches its audio perfectly, which is exactly why it must not
 *        be treated as done.
 * WHERE: `captions.get`, `captions.align`, and the workflow.
 */
export interface AlignmentPlan {
  lines: AlignableLine[];
  skipped: number;
  audioHash: string;
  totalDurationSec: number;
  existing: AlignmentRow | null;
  cached: boolean;
}

export async function alignmentPlan(
  db: DbClient,
  organizationId: string,
  projectId: string,
  options: { force?: boolean } = {},
): Promise<AlignmentPlan> {
  const [{ lines, skipped }, existing] = await Promise.all([
    listAlignableLines(db, organizationId, projectId),
    findAlignment(db, organizationId, projectId),
  ]);

  const audioHash = alignmentAudioHash(lines);
  const totalDurationSec = lines.reduce(
    (total, line) => total + line.durationSec,
    0,
  );

  const cached =
    options.force !== true &&
    existing !== null &&
    existing.audioHash === audioHash &&
    !existing.degraded &&
    lines.length > 0;

  return { lines, skipped, audioHash, totalDurationSec, existing, cached };
}

/**
 * SOURCE OF TRUTH KEYWORDS: applyCaptionsToTimeline, CaptionApplyResult,
 *   TIMELINE_IS_OPTIONAL_UNTIL_PHASE_09, RESTYLING_IS_FREE,
 *   TIMING_GOES_BACK_TO_ANCHORED
 *
 * WHAT:  Puts the aligned words and a caption track into a project's timeline
 *        document, in the chosen style.
 *
 * WHY:   It writes THREE things and they belong together: `doc.words` (the
 *        timings every caption and anchor resolves against),
 *        `doc.style.captionStyleId` (what the renderer draws them in), and
 *        the caption track itself. Splitting them across two calls is how a
 *        document ends up with a caption track pointing at word indexes that
 *        no longer exist.
 *
 *        TIMING_GOES_BACK_TO_ANCHORED whenever the WORDS change. A resolved
 *        document carries `start`/`duration` caches computed from the old
 *        words, and `validate()` refuses a resolved document whose caches
 *        disagree with its ranges — so re-aligning without resetting the mode
 *        produces a document that cannot be opened. A pure restyle leaves the
 *        mode alone, because it does not touch a single time
 *        (RESTYLING_IS_FREE).
 *
 *        `enabled: false` REMOVES the caption track rather than emptying it.
 *        A lane with no items still shows in the editor as a thing the
 *        customer has to understand, and the renderer would draw an empty
 *        layer every frame for nothing.
 * WHERE: `captions.apply`, and the align workflow after it stores words.
 */
export interface CaptionApplyResult {
  /** False when the project has no timeline document yet — see the header. */
  written: boolean;
  captions: number;
}

export async function applyCaptionsToTimeline(
  db: DbClient,
  args: {
    organizationId: string;
    projectId: string;
    styleId: string;
    position?: CaptionPosition | undefined;
    wordsPerChunk?: number | undefined;
    enabled: boolean;
    /** Supplied when the words themselves changed — an alignment just ran. */
    words?: readonly WordToken[] | undefined;
  },
): Promise<CaptionApplyResult> {
  const row = await db.timeline.findFirst({
    where: { projectId: args.projectId, project: { organizationId: args.organizationId } },
    select: { projectId: true, doc: true, revision: true },
  });
  if (row === null) return { written: false, captions: 0 };

  /* MIGRATE_ON_EVERY_READ — never read a stored document without it. */
  const doc: TimelineDoc = migrate(row.doc);

  const words = args.words ?? doc.words;
  const style = getCaptionStyle(args.styleId);

  const tracks = doc.tracks.filter(
    (track) => !(track.type === "caption" && track.id === CAPTION_TRACK_ID),
  );

  let captions = 0;
  if (args.enabled && words.length > 0) {
    const track = buildCaptionTrack(words, style.id, {
      ...(args.wordsPerChunk !== undefined
        ? { maxWords: args.wordsPerChunk }
        : {}),
      ...(args.position !== undefined ? { position: args.position } : {}),
    });
    tracks.push(track);
    captions = track.items.length;
  }

  const next: TimelineDoc = {
    ...doc,
    /* TIMING_GOES_BACK_TO_ANCHORED — only when the words moved. */
    timing: args.words !== undefined ? "anchored" : doc.timing,
    words: [...words],
    style: { ...doc.style, captionStyleId: style.id },
    tracks,
  };

  await db.timeline.update({
    where: { projectId: args.projectId },
    data: {
      doc: jsonObjectSchema.parse(next),
      docVersion: next.version,
      /* The editor's optimistic-concurrency counter (Phase 15). Bumped
       * because this IS an edit — a client holding the old revision must be
       * told its view is stale rather than silently overwriting captions. */
      revision: { increment: 1 },
    },
  });

  return { written: true, captions };
}

/**
 * SOURCE OF TRUTH KEYWORDS: readCaptionSettings, writeCaptionSettings,
 *   CAPTION_SETTINGS_LIVE_ON_THE_PROJECT, SETTINGS_ARE_MERGED
 *
 * WHAT:  A project's caption choice, read from and written to
 *        `Project.settings.captions`.
 *
 * WHY:   See CAPTION_SETTINGS_LIVE_ON_THE_PROJECT on `captionSettingsSchema`:
 *        the document is the render's input and does not exist until Phase
 *        09, so the customer's CHOICE has to live somewhere that does.
 *
 *        SETTINGS_ARE_MERGED. `settings` is one jsonb column shared by every
 *        phase that needs a project-level preference, so the write reads the
 *        existing object and replaces only the `captions` key. Writing the
 *        whole column is how a caption change silently deletes whatever the
 *        script or the render settings had put there — a data loss with no
 *        error and no obvious cause.
 * WHERE: `captions.get` and `captions.apply`.
 */
export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  styleId: DEFAULT_CAPTION_STYLE_ID,
  position: "bottom",
  wordsPerChunk: 3,
  enabled: true,
};

export async function readCaptionSettings(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<CaptionSettings | null> {
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { settings: true },
  });
  if (project === null) return null;

  const settings = jsonObjectSchema.safeParse(project.settings);
  if (!settings.success) return { ...DEFAULT_CAPTION_SETTINGS };

  const captions = captionSettingsSchema.safeParse(settings.data["captions"]);
  return captions.success ? captions.data : { ...DEFAULT_CAPTION_SETTINGS };
}

export async function writeCaptionSettings(
  db: DbClient,
  organizationId: string,
  projectId: string,
  captions: CaptionSettings,
): Promise<boolean> {
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { settings: true },
  });
  if (project === null) return false;

  const existing = jsonObjectSchema.safeParse(project.settings);
  /* SETTINGS_ARE_MERGED — see the WHY above. */
  const next = { ...(existing.success ? existing.data : {}), captions };

  await db.project.update({
    where: { id: projectId },
    data: { settings: jsonObjectSchema.parse(next) },
  });
  return true;
}
