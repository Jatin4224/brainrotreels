/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: saveMotionDesign, readMotionBeatContext,
 *   replaceMotionBeat, saveMotionReviews, SERVICES_OWN_THE_DATABASE,
 *   DESIGN_IS_STORED_WHOLE, COUNTED_WHEN_THE_DESIGN_SUCCEEDS,
 *   SETTINGS_ARE_MERGED_NOT_REPLACED, ONE_BEAT_IS_REPLACED_IN_PLACE,
 *   FOUR_FUNCTIONS_FOUR_CALLERS
 *
 * WHAT:  Persisting a motion project's storyboard and designed scenes into
 *        `Project.settings`, reading them back, and metering the video.
 *
 * WHY:   SERVICES_OWN_THE_DATABASE — this is the only layer allowed to touch
 *        Prisma, which is why the storyboard, the designer and the generator
 *        are all pure and testable with no database at all. `import
 *        'server-only'` is what keeps a customer from invoking these directly.
 *
 *        DESIGN_IS_STORED_WHOLE. The beats and their scenes are written in ONE
 *        update, inside the caller's transaction. A per-beat write would let a
 *        run be interrupted with half a storyboard stored, and the generator
 *        would then build a video covering half the narration — which is worse
 *        than no video, because it looks finished. The design stage either
 *        produces a complete storyboard or leaves the previous one alone.
 *
 *        SETTINGS_ARE_MERGED_NOT_REPLACED, the same read-modify-write the
 *        script workflow does for its own patch: `Project.settings` carries
 *        every feature's configuration — captions, generate, script — and
 *        replacing the object would silently drop a customer's caption choice
 *        the first time a motion video was designed.
 *
 *        FOUR_FUNCTIONS_FOUR_CALLERS. This file held two more — a raw
 *        `readMotionDesign` and a `findMotionProject` — written in 16c for
 *        callers that turned out not to need them: the atomic writes below do
 *        their own raw read, because a read in one function and a write in
 *        another is the race they exist to avoid, and the design stage gets
 *        its project from `generatorContextFor`. They were deleted rather than
 *        left exported. An unused function in a service is not neutral: it is
 *        the obvious door for the next person to walk through, and this one
 *        led to a read-then-write that loses a concurrent redesign.
 *
 *        COUNTED_WHEN_THE_DESIGN_SUCCEEDS. `motionVideos` is incremented after
 *        the beats are stored, in the same transaction, so a run that failed
 *        before designing anything has nothing counted against it. Counting on
 *        REQUEST would charge a customer for our outage; counting outside the
 *        transaction would let a crash between the two leave a video designed
 *        and unmetered.
 * WHERE: The design stage of src/inngest/functions/project-generate.ts, and
 *        `motionStudio.redesignBeat`.
 */

import "server-only";

import type { DbClient } from "@/lib/config/prisma";
import { prisma } from "@/lib/config/prisma";
import { wordTokenSchema, type WordToken } from "@/lib/timeline";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "@/lib/types/json";
import {
  sceneDesignSourceSchema,
  sceneReviewSchema,
  sceneSchema,
  type Scene,
  type SceneDesignSource,
  type SceneReview,
} from "@/lib/types/scene";

import { incrementUsage } from "./usage.service";

/**
 * SOURCE OF TRUTH KEYWORDS: StoredMotionBeat
 *
 * One beat as `Project.settings` holds it. The scene is optional because a
 * beat whose design failed every attempt is stored WITHOUT one rather than
 * omitted — the generator then draws a measured fallback, and the beat strip
 * can show that it needs attention. Dropping it would leave a gap in the
 * narration with nothing on screen.
 */
export interface StoredMotionBeat {
  index: number;
  startWord: number;
  endWord: number;
  intent: string;
  scene?: Scene;
  source?: SceneDesignSource;
  /**
   * What the vision pass thought, if it looked at this beat. Absent is the
   * normal case: only a sample is ever reviewed (SAMPLED_NOT_EXHAUSTIVE).
   */
  review?: SceneReview;
}

/**
 * SOURCE OF TRUTH KEYWORDS: saveMotionDesign, DESIGN_IS_STORED_WHOLE,
 *   COUNTED_WHEN_THE_DESIGN_SUCCEEDS
 *
 * WHAT:  Writes the whole storyboard and meters the video, atomically.
 * WHY:   Takes a `DbClient` so the caller can pass a transaction — the counter
 *        and the beats have to commit together. `countVideo` is a parameter
 *        rather than always true because `redesignBeat` re-saves one beat and
 *        must not meter a second video for it.
 * WHERE: The design stage; redesignBeat.
 */
export async function saveMotionDesign(args: {
  organizationId: string;
  projectId: string;
  styleId: string;
  beats: readonly StoredMotionBeat[];
  countVideo: boolean;
  db?: DbClient;
}): Promise<void> {
  const {
    organizationId,
    projectId,
    styleId,
    beats,
    countVideo,
    db = prisma,
  } = args;

  const project = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { settings: true },
  });
  const existing = jsonObjectSchema.safeParse(project?.settings);

  /* Parsed rather than cast: the beats carry Scene objects built in memory,
   * and this is where they are PROVED to be JSON before a jsonb column is
   * asked to hold them. The same argument src/lib/scene/document.ts makes. */
  const motion = jsonObjectSchema.parse({
    styleId,
    beats: beats.map((beat) => ({
      index: beat.index,
      startWord: beat.startWord,
      endWord: beat.endWord,
      intent: beat.intent,
      ...(beat.scene !== undefined ? { scene: beat.scene } : {}),
      ...(beat.source !== undefined ? { source: beat.source } : {}),
      ...(beat.review !== undefined ? { review: beat.review } : {}),
    })),
  });

  const settings: JsonObject = {
    ...(existing.success ? existing.data : {}),
    motion,
  };

  await db.project.updateMany({
    where: { id: projectId, organizationId },
    data: { settings: jsonObjectSchema.parse(settings) },
  });

  if (countVideo) {
    await incrementUsage(organizationId, "motionVideos", 1, db);
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: MotionBeatContext, readMotionBeatContext,
 *   WORDS_ARE_VALIDATED_ON_READ, A_FOCUSED_READ_NOT_THE_WHOLE_CONTEXT
 *
 * WHAT:  Everything redesigning ONE beat needs: the frame, the style it was
 *        designed for, the stored beats, and the aligned words its range
 *        points into.
 *
 * WHY:   A_FOCUSED_READ_NOT_THE_WHOLE_CONTEXT. `generatorContextFor` would
 *        answer this too, and it is the wrong tool here: it also resolves the
 *        cast, the background, the recorded lines and the plan, which is four
 *        more queries and a plan lookup to redesign one graphic. This runs
 *        inside a tRPC mutation's transaction, where every query is on the
 *        clock (txTimeout), and none of what it leaves out can change a
 *        scene.
 *
 *        WORDS_ARE_VALIDATED_ON_READ, as in pipeline.service.ts: the payload
 *        is jsonb written by a possibly older release, so it is parsed with the
 *        document's own schema. An alignment that does not parse comes back
 *        EMPTY, and the router refuses the redesign — a beat whose word range
 *        points into nothing cannot be measured, and designing it against an
 *        empty transcript would produce a scene about nothing.
 * WHERE: `motionStudio.redesignBeat`.
 */
export interface MotionBeatContext {
  kind: string;
  aspect: string;
  styleId: string | undefined;
  beats: StoredMotionBeat[];
  words: WordToken[];
}

export async function readMotionBeatContext(args: {
  organizationId: string;
  projectId: string;
  db?: DbClient;
}): Promise<MotionBeatContext | null> {
  const { organizationId, projectId, db = prisma } = args;

  const project = await db.project.findFirst({
    /* RECHECK_OWNERSHIP — never by id alone, as everywhere else. */
    where: { id: projectId, organizationId },
    select: { kind: true, aspect: true, settings: true },
  });
  if (project === null) return null;

  const alignment = await db.alignment.findFirst({
    where: { projectId, project: { organizationId } },
    select: { words: true },
  });

  const words = wordTokenSchema.array().safeParse(alignment?.words ?? []);
  if (!words.success) {
    console.error(
      `[motion.service] ${projectId}: stored alignment words did not parse.`,
      words.error.issues.slice(0, 3),
    );
  }

  const settings = jsonObjectSchema.safeParse(project.settings);
  const motion = jsonObjectSchema.safeParse(
    settings.success ? settings.data["motion"] : undefined,
  );

  return {
    kind: project.kind,
    aspect: project.aspect,
    styleId: readStoredStyleId(motion.success ? motion.data : null),
    beats: readStoredBeats(motion.success ? motion.data : null),
    words: words.success ? words.data : [],
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: readStoredStyleId, readStoredBeats,
 *   A_PARSE_FAILURE_LOSES_ONE_BEAT
 *
 * The stored design as typed values, for the one caller that wants them parsed
 * rather than raw. A beat that does not parse is DROPPED rather than failing
 * the read: the customer should be able to redesign beat four of a storyboard
 * whose beat seven was written by a build that has since been rolled back.
 */
function readStoredStyleId(motion: JsonObject | null): string | undefined {
  const styleId = motion?.["styleId"];
  return typeof styleId === "string" && styleId.length > 0
    ? styleId
    : undefined;
}

function readStoredBeats(motion: JsonObject | null): StoredMotionBeat[] {
  const beats = motion?.["beats"];
  if (!Array.isArray(beats)) return [];

  const out: StoredMotionBeat[] = [];
  for (const entry of beats) {
    const row = jsonObjectSchema.safeParse(entry);
    if (!row.success) continue;

    const index = row.data["index"];
    const startWord = row.data["startWord"];
    const endWord = row.data["endWord"];
    const intent = row.data["intent"];
    if (
      typeof index !== "number" ||
      typeof startWord !== "number" ||
      typeof endWord !== "number" ||
      typeof intent !== "string"
    ) {
      continue;
    }

    const scene = sceneSchema.safeParse(row.data["scene"]);
    const source = sceneDesignSourceSchema.safeParse(row.data["source"]);
    const review = sceneReviewSchema.safeParse(row.data["review"]);

    out.push({
      index,
      startWord,
      endWord,
      intent,
      ...(scene.success ? { scene: scene.data } : {}),
      ...(source.success ? { source: source.data } : {}),
      ...(review.success ? { review: review.data } : {}),
    });
  }

  return out.sort((a, b) => a.index - b.index);
}

/**
 * SOURCE OF TRUTH KEYWORDS: replaceMotionBeat, ONE_BEAT_IS_REPLACED_IN_PLACE,
 *   THE_OTHERS_ARE_BYTE_IDENTICAL, NOT_METERED_A_SECOND_TIME
 *
 * WHAT:  Writes a new scene onto ONE stored beat and leaves every other byte
 *        of the design exactly as it was.
 *
 * WHY:   THE_OTHERS_ARE_BYTE_IDENTICAL is a phase requirement
 *        ("redesigning one beat leaves the others byte-identical") and it is
 *        the reason this does not go through `saveMotionDesign`. That function
 *        REBUILDS the beats array from typed values, which would rewrite every
 *        sibling — dropping any field this build does not know about, and
 *        changing the document hash so a cached render of an unchanged beat is
 *        invalidated. Here the stored array is read RAW
 *        (ONE_BEAT_IS_REPLACED_IN_PLACE), one entry's `scene` and `source`
 *        keys are overwritten, and the rest of the object — siblings, unknown
 *        keys, key order — is written back untouched.
 *
 *        NOT_METERED_A_SECOND_TIME. A redesign deliberately takes no
 *        `countVideo`: `motionVideos` counts VIDEOS, and a customer fixing
 *        one ugly beat has not made another one. The model request it spends
 *        is rationed by the rate limit on the procedure instead, which is the
 *        right instrument for "a human clicking a button" (A_QUOTA_AND_A_PRICE
 *        in reverse — this is a price without a quota).
 *
 *        Returns false when the beat is not there, which the router turns into
 *        a NOT_FOUND rather than silently writing a beat the storyboard does
 *        not have.
 * WHERE: `motionStudio.redesignBeat`.
 */
export async function replaceMotionBeat(args: {
  organizationId: string;
  projectId: string;
  beatIndex: number;
  scene: Scene;
  source: SceneDesignSource;
  db?: DbClient;
}): Promise<boolean> {
  const {
    organizationId,
    projectId,
    beatIndex,
    scene,
    source,
    db = prisma,
  } = args;

  const project = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { settings: true },
  });
  if (project === null) return false;

  const settings = jsonObjectSchema.safeParse(project.settings);
  if (!settings.success) return false;

  const motion = jsonObjectSchema.safeParse(settings.data["motion"]);
  if (!motion.success) return false;

  const beats = motion.data["beats"];
  if (!Array.isArray(beats)) return false;

  /* Proved to be JSON before a jsonb column is asked to hold it — the same
   * argument saveMotionDesign makes about its own payload. */
  const next = jsonValueSchema.parse(scene);

  let replaced = false;
  const updated: JsonValue[] = beats.map((entry) => {
    const row = jsonObjectSchema.safeParse(entry);
    if (!row.success || row.data["index"] !== beatIndex) return entry;

    replaced = true;

    /**
     * SOURCE OF TRUTH KEYWORDS: A_FINDING_DIES_WITH_ITS_SCENE
     *
     * The vision pass's note is dropped, and only it. A finding says something
     * about a PICTURE — "three numbers competing for the same corner" — and
     * this line replaces the picture, so keeping the note would badge a beat
     * for a problem that may well be gone. The review runs per generation, so
     * the honest state after a redesign is "not reviewed".
     */
    const kept = { ...row.data };
    delete kept["review"];

    /* Spread FIRST, then override the two keys that changed: a sibling field
     * this build has never heard of survives the round trip. */
    return { ...kept, scene: next, source };
  });

  if (!replaced) return false;

  await db.project.updateMany({
    where: { id: projectId, organizationId },
    data: {
      settings: jsonObjectSchema.parse({
        ...settings.data,
        motion: { ...motion.data, beats: updated },
      }),
    },
  });

  return true;
}

/**
 * SOURCE OF TRUTH KEYWORDS: saveMotionReviews, ONE_BEAT_IS_REPLACED_IN_PLACE,
 *   THE_OTHERS_ARE_BYTE_IDENTICAL, A_FINDING_IS_NOT_A_DESIGN
 *
 * WHAT:  Writes the vision pass's verdicts onto the beats they are about,
 *        touching nothing else.
 *
 * WHY:   A_FINDING_IS_NOT_A_DESIGN, which is why this is a separate write from
 *        `saveMotionDesign` rather than a field on it. The review runs AFTER
 *        the design is stored and metered, on a sample of two or three beats,
 *        and it may legitimately produce nothing at all. Folding it into the
 *        design write would mean either holding the whole storyboard in memory
 *        across a second stage — so a review failure could lose a design that
 *        succeeded — or re-writing forty beats to attach three notes.
 *
 *        So it edits IN PLACE, by index, like `replaceMotionBeat` and for the
 *        same reason: every sibling, every unknown key and every scene is
 *        written back exactly as it was found
 *        (THE_OTHERS_ARE_BYTE_IDENTICAL). A finding is an annotation on a
 *        design, and annotating it must not change what gets rendered.
 *
 *        Returns the number of beats annotated, which is what the stage's
 *        warning is built from. Zero is a normal answer.
 * WHERE: The `review-beats` step of project-generate.ts.
 */
export async function saveMotionReviews(args: {
  organizationId: string;
  projectId: string;
  reviews: Readonly<Record<number, SceneReview>>;
  db?: DbClient;
}): Promise<number> {
  const { organizationId, projectId, reviews, db = prisma } = args;

  const indices = Object.keys(reviews);
  if (indices.length === 0) return 0;

  const project = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { settings: true },
  });
  if (project === null) return 0;

  const settings = jsonObjectSchema.safeParse(project.settings);
  if (!settings.success) return 0;

  const motion = jsonObjectSchema.safeParse(settings.data["motion"]);
  if (!motion.success) return 0;

  const beats = motion.data["beats"];
  if (!Array.isArray(beats)) return 0;

  let annotated = 0;
  const updated: JsonValue[] = beats.map((entry) => {
    const row = jsonObjectSchema.safeParse(entry);
    if (!row.success) return entry;

    const index = row.data["index"];
    if (typeof index !== "number") return entry;

    const review = reviews[index];
    if (review === undefined) return entry;

    annotated += 1;
    /* Spread first, then the one key that changed — the scene this finding is
     * about is written back untouched. */
    return { ...row.data, review: jsonValueSchema.parse(review) };
  });

  if (annotated === 0) return 0;

  await db.project.updateMany({
    where: { id: projectId, organizationId },
    data: {
      settings: jsonObjectSchema.parse({
        ...settings.data,
        motion: { ...motion.data, beats: updated },
      }),
    },
  });

  return annotated;
}
