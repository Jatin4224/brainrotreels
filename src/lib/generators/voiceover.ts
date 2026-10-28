/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: voiceoverGenerator, buildVoiceoverDocument,
 *   NARRATION_IS_SEQUENTIAL, MUSIC_IS_OPTIONAL, DUCK_IS_A_REQUEST,
 *   BACKDROP_SPANS_THE_NARRATION, FOOTAGE_OR_BACKDROP_NEVER_BOTH,
 *   LOOP_TO_THE_NARRATION, EMPTY_WORDS_STILL_BUILDS,
 *   GENERATED_DOC_IS_ANCHORED, VOICEOVER_SKIPS, COMPOSED_FROM_COMMON
 *
 * WHAT:  The first generator: narration over a background, with captions and
 *        an optional ducked music bed.
 *
 * WHY:   COMPOSED_FROM_COMMON, which is the shape Phase 12 gave this file.
 *        Everything a voiceover and a Reddit story share — the narration lane,
 *        the background (footage or backdrop), the music bed, the cast record,
 *        the settings read — lives in ./common.ts, and each of those decisions
 *        is documented where its code is. What is left HERE is what makes a
 *        voiceover a voiceover: narration, a background, captions, and nothing
 *        else on screen.
 *
 *        That is not a refactor for tidiness. Two copies of "a background
 *        shorter than the narration loops, and a background with no measured
 *        duration does not" is two places for it to stop being true, and the
 *        second copy is always the one that is wrong.
 *
 *        EMPTY_WORDS_STILL_BUILDS. With no aligned words — STT disabled, or an
 *        alignment that heard nothing — this produces a document with audio, a
 *        background and NO caption track, rather than failing. That is the
 *        phase's "with STT disabled the video still completes with degraded
 *        captions and a visible warning": the warning is the alignment's own
 *        `degraded` flag, which the captions screen already surfaces, and the
 *        video is still a video.
 *
 *        GENERATED_DOC_IS_ANCHORED. `timing: "anchored"` is written even though
 *        every time in the document happens to be a number, because the CAPTION
 *        items are addressed by word range and carry no `start` — a document
 *        claiming `resolved` with unresolved captions is one `validate()`
 *        refuses. `resolveWordAnchors` flips it, at preview and pre-flight.
 * WHERE: Registered for `voiceover` in ./registry.ts. Called by the `timeline`
 *        stage of src/inngest/functions/project-generate.ts.
 */

import { buildCaptionTrack } from "@/lib/captions";
import type { AssetRef, TimelineDoc, Track } from "@/lib/timeline";
import { TIMELINE_DOC_VERSION } from "@/lib/timeline";
import { CANVAS_BY_ASPECT } from "@/lib/types/project";
import {
  SAFE_ZONE_BY_ASPECT,
  buildBackgroundTrack,
  buildMusicTrack,
  buildSpeakers,
  layNarration,
  paletteIdFor,
  readGeneratorSettings,
} from "./common";
import type { Generator, GeneratorContext } from "./types";

/**
 * SOURCE OF TRUTH KEYWORDS: buildVoiceoverDocument, EXPORTED_FOR_TESTS
 *
 * WHAT:  The document, from the context.
 * WHY:   Exported separately from the `Generator` object so a test can call it
 *        without constructing a registry entry, and SYNCHRONOUS because nothing
 *        in it does I/O. The contract is async, so the wrapper below is what
 *        adapts one to the other — rather than making this function async and
 *        claiming an await that never happens.
 * WHERE: ./registry.ts, and generators.test.ts.
 */
export function buildVoiceoverDocument(ctx: GeneratorContext): TimelineDoc {
  const canvas = CANVAS_BY_ASPECT[ctx.aspect];
  const settings = readGeneratorSettings(ctx.settings);
  const paletteId = paletteIdFor(settings);

  /* NARRATION_IS_SEQUENTIAL — one pass, accumulating measured durations. */
  const narration = layNarration(ctx);
  const totalSec = narration.totalSec;

  /* FOOTAGE_OR_BACKDROP_NEVER_BOTH — one call, one track. */
  const background = buildBackgroundTrack({
    background: ctx.background,
    totalSec,
    paletteId,
  });

  /* MUSIC_IS_OPTIONAL — absent unless the project names a bed. */
  const music = buildMusicTrack({
    musicAssetId: settings.generate.musicAssetId,
    totalSec,
  });

  const assets: Record<string, AssetRef> = {
    ...narration.assets,
    ...background.assets,
    ...music.assets,
  };

  /* Bottom-most first: the renderer walks tracks in array order (LAYER_ORDER),
   * so the background has to be laid before anything that sits over it. */
  const tracks: Track[] = [];
  if (background.track !== null) tracks.push(background.track);
  if (narration.track !== null) tracks.push(narration.track);
  if (music.track !== null) tracks.push(music.track);

  /* EMPTY_WORDS_STILL_BUILDS — no words means no caption track, not a failure. */
  if (ctx.words.length > 0 && settings.captions.enabled) {
    tracks.push(
      buildCaptionTrack(ctx.words, settings.captions.styleId, {
        maxWords: settings.captions.wordsPerChunk,
        position: settings.captions.position,
      }),
    );
  }

  return {
    version: TIMELINE_DOC_VERSION,
    kind: "voiceover",
    /* GENERATED_DOC_IS_ANCHORED — see the file header. */
    timing: "anchored",
    canvas,
    style: {
      paletteId,
      captionStyleId: settings.captions.styleId,
      safeZone: SAFE_ZONE_BY_ASPECT[ctx.aspect],
    },
    words: [...ctx.words],
    tracks,
    speakers: buildSpeakers(ctx),
    assets,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: voiceoverGenerator, VOICEOVER_SKIPS
 *
 * WHAT:  The registry entry for `voiceover`.
 * WHY:   VOICEOVER_SKIPS names the four stages this kind does not run, and each
 *        is a deferral rather than an omission:
 *          `visuals`    — still skipped, and now deliberately rather than
 *                         pending. Phase 11 built the footage library, and
 *                         choosing from it is ONE read and one decision taken
 *                         before the build (RESOLVED_BEFORE_THE_GENERATOR in
 *                         ./types.ts), not a stage's worth of work. A stage
 *                         that goes from pending to complete in the same
 *                         instant is noise on a progress list somebody is
 *                         watching, and a `skipped` row with a reason is the
 *                         honest one. The stage fills in for a format that
 *                         genuinely chooses visuals per BLOCK — Phase 14's
 *                         stock search.
 *          `storyboard` — there is nothing to sequence: one background, one
 *                         narration. A storyboard is what a multi-shot format
 *                         needs (Phases 13 and 14).
 *          `design`     — the caption style is already chosen on the captions
 *                         screen, and there are no other on-screen elements to
 *                         lay out.
 *          `render`     — rendering is a SEPARATE PAID ACTION the customer
 *                         takes from the preview screen (`renders.create`,
 *                         Phase 04), with its own hold, its own cap and its own
 *                         resolution choice. Rendering inside the pipeline
 *                         would charge for an output nobody has asked for yet,
 *                         and the phase's goal is a PREVIEWABLE video.
 * WHERE: GENERATORS in ./registry.ts.
 */
export const voiceoverGenerator: Generator = {
  kind: "voiceover",
  skips: ["visuals", "storyboard", "design", "render"],
  build: (ctx) => Promise.resolve(buildVoiceoverDocument(ctx)),
};
