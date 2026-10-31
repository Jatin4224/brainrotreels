/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: motionGenerator, buildMotionDocument,
 *   readMotionSettings, MOTION_SCENES_ARE_ALREADY_DESIGNED, GENERATORS_STAY_PURE,
 *   SCENES_COVER_THE_NARRATION, A_MISSING_SCENE_IS_A_FALLBACK, MOTION_SKIPS
 *
 * WHAT:  Builds the timeline document for a `motion` project: one scene item
 *        per designed beat, over the narration, with captions and an optional
 *        music bed.
 *
 * WHY:   MOTION_SCENES_ARE_ALREADY_DESIGNED, and this is the constraint that
 *        decides the whole shape of 16d. A generator is PURE
 *        (GENERATORS_STAY_PURE) — it may not call a model — but a motion beat
 *        needs one. So the design happens in an EARLIER stage, which writes
 *        its results into `Project.settings`, and this reads them. Exactly the
 *        split Phase 13's quiz makes: the writer calls the model and records
 *        what it decided on the settings patch, the generator consumes the
 *        decision. It is also why "redesign one beat" is cheap — the stored
 *        scenes are the artifact, and rebuilding the document from them costs
 *        nothing.
 *
 *        A_MISSING_SCENE_IS_A_FALLBACK. A beat with no stored scene — a design
 *        stage that was interrupted, a document from before a beat existed —
 *        gets a measured fallback rather than a gap. THE_PIPELINE_ALWAYS_
 *        FINISHES applies here too: the generator is the last place that could
 *        turn a partial design into a video with holes in it, and it does not.
 *
 *        SCENES_COVER_THE_NARRATION. Each scene item runs from its beat's first
 *        word to its last, taken from the aligned words rather than from
 *        anything stored, so a re-alignment moves the scenes with the audio and
 *        nothing has to be rewritten. A silent motion piece (no narration at
 *        all) is still valid — the fixture has proved that since Phase 01 —
 *        and in that case there are no beats and no scene track.
 *
 *        The style is written into `doc.style.motionStyleId` AND its palette
 *        into `doc.style.paletteId`, which is APPLYING_A_STYLE_WRITES_THE_
 *        PALETTE: one answer to "what colour is this video", and a style change
 *        that correctly invalidates a cached render (STYLE_BELONGS_IN_THE_
 *        DOCUMENT).
 * WHERE: GENERATORS in ./registry.ts.
 */

import { getMotionStyle } from "@/lib/motion-styles";
import { buildCaptionTrack } from "@/lib/captions";
import { fallbackScene, toSceneSpec } from "@/lib/scene";
import {
  TIMELINE_DOC_VERSION,
  type AssetRef,
  type SceneItem,
  type TimelineDoc,
  type Track,
} from "@/lib/timeline";
import { CANVAS_BY_ASPECT } from "@/lib/types/project";
import { jsonObjectSchema } from "@/lib/types/json";
import { sceneSchema, type Beat, type Scene } from "@/lib/types/scene";
import { z } from "zod";

import {
  SAFE_ZONE_BY_ASPECT,
  buildMusicTrack,
  buildSpeakers,
  layNarration,
  readGeneratorSettings,
} from "./common";
import type { Generator, GeneratorContext } from "./types";

export const SCENE_TRACK_ID = "scenes";

/**
 * SOURCE OF TRUTH KEYWORDS: motionSettingsSchema, MOTION_SCENES_ARE_ALREADY_DESIGNED
 *
 * WHAT:  What the design stage writes under `settings.motion`.
 *
 * WHY:   The beats and their scenes are stored TOGETHER, because a scene
 *        without its word range cannot be placed and a beat without its scene
 *        cannot be drawn — splitting them would make a half-written settings
 *        object look valid. `styleId` sits beside them because the beats were
 *        designed FOR that style: re-reading them under a different one is
 *        legitimate (a restyle), but it has to be a deliberate act rather than
 *        a default.
 *
 *        `scene` is parsed with the strict `sceneSchema`, so a stored scene
 *        that does not parse is dropped to a fallback rather than reaching a
 *        component — the same gate `fromSceneSpec` is on the render side.
 * WHERE: Written by the design step; read by `readMotionSettings` below.
 */
const designedBeatSchema = z
  .object({
    index: z.number().int().min(0),
    startWord: z.number().int().min(0),
    endWord: z.number().int().min(0),
    intent: z.string().min(1),
    scene: sceneSchema.optional(),
  })
  .strict();

const motionSettingsSchema = z
  .object({
    styleId: z.string().trim().min(1).max(60).optional(),
    beats: z.array(designedBeatSchema).optional(),
  })
  .partial();

/**
 * SOURCE OF TRUTH KEYWORDS: readMotionSettings
 *
 * WHAT:  The design stage's output, or empty when it has not run.
 * WHY:   Total and forgiving, like `readGeneratorSettings`: a project whose
 *        design stage never ran still builds a document — a silent motion
 *        piece with no scenes — rather than throwing in the middle of the
 *        pipeline. The pipeline reports a FAILED DESIGN STAGE; the generator's
 *        job is to produce the best document it can from what exists.
 * WHERE: buildMotionDocument.
 */
export function readMotionSettings(
  settings: Readonly<Record<string, unknown>>,
): { styleId: string | undefined; beats: (Beat & { scene?: Scene })[] } {
  const object = jsonObjectSchema.safeParse(settings);
  const bag = object.success ? object.data : {};
  const parsed = motionSettingsSchema.safeParse(bag["motion"]);

  if (!parsed.success) return { styleId: undefined, beats: [] };

  const beats = (parsed.data.beats ?? []).map((beat) => ({
    index: beat.index,
    startWord: beat.startWord,
    endWord: beat.endWord,
    /* The intent is stored as a string and narrowed on read: a settings blob
     * written by a newer release could carry an intent this build has never
     * heard of, and that must not drop the beat — only its intent, which the
     * generator does not use. */
    intent: "emphasis" as const,
    ...(beat.scene !== undefined ? { scene: beat.scene } : {}),
  }));

  return { styleId: parsed.data.styleId, beats };
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildMotionDocument, SCENES_COVER_THE_NARRATION,
 *   A_MISSING_SCENE_IS_A_FALLBACK
 *
 * WHAT:  The whole document for a motion project.
 * WHERE: motionGenerator.build.
 */
export function buildMotionDocument(ctx: GeneratorContext): TimelineDoc {
  const canvas = CANVAS_BY_ASPECT[ctx.aspect];
  const settings = readGeneratorSettings(ctx.settings);
  const motion = readMotionSettings(ctx.settings);
  const style = getMotionStyle(motion.styleId);
  const safeZone = SAFE_ZONE_BY_ASPECT[ctx.aspect];

  /* NARRATION_IS_SEQUENTIAL — one pass, accumulating measured durations, and
   * the words it returns are the ones every scene anchors against. */
  const narration = layNarration(ctx);
  const words = narration.words;
  const totalSec = narration.totalSec;

  const tracks: Track[] = [];
  const assets: Record<string, AssetRef> = { ...narration.assets };

  /* The scene track is laid FIRST, so it sits behind the narration's captions
   * and any overlay — the renderer walks tracks in array order (LAYER_ORDER).
   * A motion video has no footage behind it: the scenes ARE the picture, drawn
   * over the composition's own background. */
  const items = motion.beats
    .map((beat) =>
      sceneItemFor({
        beat,
        words,
        canvas,
        safeZone,
        totalSec,
      }),
    )
    .filter((item): item is SceneItem => item !== null);

  if (items.length > 0) {
    tracks.push({
      id: SCENE_TRACK_ID,
      type: "scene",
      label: "Scenes",
      items,
    });
  }

  if (narration.track !== null) tracks.push(narration.track);

  /* MUSIC_IS_OPTIONAL. The style's `musicMood` is the durable half of the
   * choice and Phase 11's catalogue is still empty, so a bed only appears when
   * the project names an asset outright — the mood cannot resolve to a track
   * that does not exist (MUSIC_LICENCE_IS_NOT_RESOLVED_YET). */
  const music = buildMusicTrack({
    musicAssetId: settings.generate.musicAssetId,
    totalSec,
  });
  if (music.track !== null) tracks.push(music.track);
  Object.assign(assets, music.assets);

  /* EMPTY_WORDS_STILL_BUILDS — a silent motion piece has no caption track. */
  if (words.length > 0 && settings.captions.enabled) {
    tracks.push(
      buildCaptionTrack(words, style.captionTreatment, {
        maxWords: settings.captions.wordsPerChunk,
        position: settings.captions.position,
      }),
    );
  }

  return {
    version: TIMELINE_DOC_VERSION,
    kind: "motion",
    /* GENERATED_DOC_IS_ANCHORED, as every other generator produces. */
    timing: "anchored",
    canvas,
    style: {
      /* APPLYING_A_STYLE_WRITES_THE_PALETTE — the style's palette becomes the
       * document's, so there is one answer to what colour this video is. */
      paletteId: style.paletteId,
      /* The style's caption treatment likewise: a motion video's captions are
       * part of its style, not a separate choice made on another screen. */
      captionStyleId: style.captionTreatment,
      safeZone,
      motionStyleId: style.id,
    },
    words: [...words],
    tracks,
    speakers: buildSpeakers(ctx),
    assets,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: sceneItemFor, SCENES_COVER_THE_NARRATION,
 *   A_MISSING_SCENE_IS_A_FALLBACK
 *
 * WHAT:  One beat as a scene item, timed from the words it covers.
 * WHY:   Returns null only when the beat names words the transcript does not
 *        have, which is a storyboard that no longer matches a re-aligned
 *        narration. Dropping it is right: the alternative is an item with a
 *        negative duration, which `validate()` refuses and which would fail the
 *        whole document rather than one beat.
 * WHERE: buildMotionDocument.
 */
function sceneItemFor(args: {
  beat: Beat & { scene?: Scene };
  words: readonly { s: number; e: number; w: string; i: number }[];
  canvas: { width: number; height: number; fps: number };
  safeZone: TimelineDoc["style"]["safeZone"];
  totalSec: number;
}): SceneItem | null {
  const { beat, words, canvas, safeZone, totalSec } = args;

  const first = words[beat.startWord];
  const last = words[beat.endWord];
  if (first === undefined || last === undefined) return null;

  const start = first.s;
  /* Clamped to the narration's own length: an aligner can time a final word a
   * few milliseconds past the audio, and a scene running past the document is
   * an out-of-range item. */
  const end = Math.min(last.e, totalSec);
  const duration = end - start;
  if (!(duration > 0)) return null;

  const scene =
    beat.scene ??
    fallbackScene({
      words: words.slice(beat.startWord, beat.endWord + 1),
      beatIndex: beat.index,
      ctx: { canvas, safeZone },
      durationSeconds: duration,
    });

  return {
    id: `beat-${beat.index}`,
    start,
    duration,
    render: "motion",
    scene: toSceneSpec(scene),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: motionGenerator, MOTION_SKIPS
 *
 * WHAT:  The registry entry for `motion`.
 * WHY:   MOTION_SKIPS names the two stages this kind does not run:
 *
 *          `visuals` — a motion video has no stock footage and no generated
 *                      stills behind it. The scenes ARE the picture, which is
 *                      the whole premise of the format, so a visuals stage
 *                      would be a progress row for a step with nothing to do.
 *          `render`  — rendering stays a SEPARATE PAID ACTION from the preview
 *                      screen, exactly as it is for every other format. The
 *                      same argument VOICEOVER_SKIPS makes.
 *
 *        `storyboard` and `design` are the two stages this format uses that
 *        most others skip, and they are where the model work happens: the
 *        storyboard splits the narration into beats, and the design stage fans
 *        out one model request per beat. That is why the generator itself is
 *        pure — see MOTION_SCENES_ARE_ALREADY_DESIGNED.
 * WHERE: GENERATORS in ./registry.ts.
 */
export const motionGenerator: Generator = {
  kind: "motion",
  skips: ["visuals", "render"],
  build: (ctx) => Promise.resolve(buildMotionDocument(ctx)),
};
