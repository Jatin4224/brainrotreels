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
  buildBlockVisualTracks,
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

  /**
   * SOURCE OF TRUTH KEYWORDS: VISUALS_PER_BLOCK_OR_ONE_BACKGROUND,
   *   FOOTAGE_OR_BACKDROP_NEVER_BOTH, NO_DOCUMENT_CHANGES_WITHOUT_VISUALS
   *
   * Phase 14. Two shapes of "what is behind the words", and which one applies
   * is decided by whether this project has ANY resolved block visual.
   *
   * NO_DOCUMENT_CHANGES_WITHOUT_VISUALS is why this is a branch rather than
   * one generalised call. With no block visuals — every project that existed
   * before this phase, and every deployment with neither provider configured —
   * `buildBackgroundTrack` runs exactly as it did, producing byte-identical
   * items and therefore the same `docHash`. A single unified builder would
   * have changed item ids for every existing project, which Phase 04 reads as
   * a different document and charges a second paid render for
   * (RENDER_REUSE). A phase that quietly re-bills every customer's next
   * export is not a phase that shipped.
   *
   * With block visuals, ONE function owns both the clips and the fallback over
   * the stretches they do not cover, because a backdrop composites ABOVE video
   * and emitting both for the same seconds would draw a gradient over the
   * pictures — see ONE_FUNCTION_OWNS_WHAT_IS_BEHIND_THE_WORDS in ./common.ts.
   */
  const hasBlockVisuals = Object.keys(ctx.visuals).length > 0;

  const behindTheWords = hasBlockVisuals
    ? buildBlockVisualTracks({
        lines: ctx.lines,
        spans: narration.spans,
        visuals: ctx.visuals,
        background: ctx.background,
        totalSec,
        paletteId,
      })
    : (() => {
        /* FOOTAGE_OR_BACKDROP_NEVER_BOTH — one call, one track. */
        const built = buildBackgroundTrack({
          background: ctx.background,
          totalSec,
          paletteId,
        });
        return {
          tracks: built.track === null ? [] : [built.track],
          assets: built.assets,
        };
      })();

  /* MUSIC_IS_OPTIONAL — absent unless the project names a bed. */
  const music = buildMusicTrack({
    musicAssetId: settings.generate.musicAssetId,
    totalSec,
  });

  const assets: Record<string, AssetRef> = {
    ...narration.assets,
    ...behindTheWords.assets,
    ...music.assets,
  };

  /* Bottom-most first: the renderer walks tracks in array order (LAYER_ORDER),
   * so the background has to be laid before anything that sits over it. */
  const tracks: Track[] = [...behindTheWords.tracks];
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
 * WHY:   VOICEOVER_SKIPS names the three stages this kind does not run, and each
 *        is a deferral rather than an omission:
 *          `storyboard` — there is nothing to sequence. A `voiceover` is a
 *                         narration with a picture per block, and the block
 *                         order IS the script's — so a storyboard stage would
 *                         be a progress row for an arithmetic step, and a stage
 *                         that goes from pending to complete in the same
 *                         instant is noise on a list somebody is watching. The
 *                         same argument Phase 13 made for the quiz.
 *          `design`     — the caption style is already chosen on the captions
 *                         screen, and there are no other on-screen elements to
 *                         lay out.
 *          `render`     — rendering is a SEPARATE PAID ACTION the customer
 *                         takes from the preview screen (`renders.create`,
 *                         Phase 04), with its own hold, its own cap and its own
 *                         resolution choice. Rendering inside the pipeline
 *                         would charge for an output nobody has asked for yet,
 *                         and the phase's goal is a PREVIEWABLE video.
 *
 *        `visuals` is NO LONGER SKIPPED, and that is the one line of this entry
 *        Phase 14 changed. It was skipped with a note predicting exactly this
 *        ("the stage fills in for a format that genuinely chooses visuals per
 *        BLOCK — Phase 14's stock search"), and it now runs for every voiceover
 *        — including on a deployment with neither provider configured, where it
 *        completes with a warning saying the footage is plain. That is better
 *        than skipping it conditionally: `skips` is STATIC (it is read before a
 *        run starts, by `seedStages`) and could not see a provider's
 *        configuration anyway, and a customer whose video came out plainer
 *        should be told which step decided that rather than watching a greyed
 *        row claim the feature does not exist.
 * WHERE: GENERATORS in ./registry.ts.
 */
export const voiceoverGenerator: Generator = {
  kind: "voiceover",
  skips: ["storyboard", "design", "render"],
  build: (ctx) => Promise.resolve(buildVoiceoverDocument(ctx)),
};
