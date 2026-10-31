/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: saveMotionDesign, readMotionDesign, countMotionVideo,
 *   SERVICES_OWN_THE_DATABASE, DESIGN_IS_STORED_WHOLE,
 *   COUNTED_WHEN_THE_DESIGN_SUCCEEDS, SETTINGS_ARE_MERGED_NOT_REPLACED
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
import { jsonObjectSchema, type JsonObject } from "@/lib/types/json";
import type { Scene } from "@/lib/types/scene";

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
  source?: "designed" | "repaired" | "fallback";
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
 * SOURCE OF TRUTH KEYWORDS: readMotionDesign
 *
 * WHAT:  The stored storyboard, or null when none has been written.
 * WHY:   Returns the RAW settings blob rather than parsed beats, because the
 *        two callers want different things: `redesignBeat` needs to replace
 *        one entry and write the rest back untouched, and the generator parses
 *        it with its own schema. Parsing here would mean a beat this build
 *        cannot read is silently dropped on a round trip that was only meant
 *        to change one of its siblings.
 * WHERE: redesignBeat.
 */
export async function readMotionDesign(args: {
  organizationId: string;
  projectId: string;
  db?: DbClient;
}): Promise<JsonObject | null> {
  const { organizationId, projectId, db = prisma } = args;

  const project = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { settings: true },
  });

  const settings = jsonObjectSchema.safeParse(project?.settings);
  if (!settings.success) return null;

  const motion = settings.data["motion"];
  const parsed = jsonObjectSchema.safeParse(motion);
  return parsed.success ? parsed.data : null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: findMotionProject
 *
 * The project row the design stage needs: its aspect, its settings and its
 * words come from elsewhere, so this is only the existence check plus the
 * kind — a project whose kind changed under a queued run must not be designed
 * as a motion video.
 */
export async function findMotionProject(args: {
  organizationId: string;
  projectId: string;
  db?: DbClient;
}): Promise<{ id: string; kind: string; aspect: string } | null> {
  const { organizationId, projectId, db = prisma } = args;

  return db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, kind: true, aspect: true },
  });
}
