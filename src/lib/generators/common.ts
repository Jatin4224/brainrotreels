/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: layNarration, buildBackgroundTrack,
 *   buildMusicTrack, buildSpeakers, readGeneratorSettings, narrationHandle,
 *   SHARED_BY_EVERY_FORMAT, NARRATION_IS_SEQUENTIAL,
 *   FOOTAGE_OR_BACKDROP_NEVER_BOTH, LOOP_TO_THE_NARRATION, MUSIC_IS_OPTIONAL,
 *   SAFE_ZONE_BY_ASPECT, LayNarrationOptions, NarrationSpan,
 *   BEATS_SHIFT_THE_WORDS, COUNTDOWN_IS_A_LEAD_GAP
 *
 * WHAT:  The parts of a timeline document that are the same whatever format is
 *        being generated: the narration lane, the background (footage or
 *        backdrop), the music bed, the cast record and the settings read.
 *
 * WHY:   SHARED_BY_EVERY_FORMAT, and this module exists because Phase 12 was
 *        the moment it stopped being hypothetical. A Reddit story and a
 *        voiceover differ in exactly two ways — a title card and avatar
 *        overlays — and are identical in the five things below. Copying them
 *        would mean two places where "a background shorter than the narration
 *        loops" is implemented, and the second one would be the one that
 *        stopped being true.
 *
 *        The functions are small and take only what they need, which is what
 *        makes them testable without constructing a whole context — and what
 *        keeps the formats readable: a generator becomes a list of the tracks
 *        it wants rather than four hundred lines of item construction.
 *
 *        Every WHY that was already written against these behaviours is kept
 *        with the code it explains rather than summarised here, because the
 *        reasoning is the part that is expensive to rediscover.
 *
 *        PURE, like everything under src/lib/generators/: no Prisma, no
 *        `server-only`, no React, no Remotion. See GENERATORS_STAY_PURE.
 * WHERE: src/lib/generators/voiceover.ts and
 *        src/lib/generators/reddit-story.ts.
 */

import { DEFAULT_CAPTION_STYLE_ID } from "@/lib/captions";
import { BACKDROP_ELEMENT_KIND, DEFAULT_PALETTE_ID } from "@/lib/palettes";
import type {
  AssetRef,
  AudioItem,
  TimelineDoc,
  Track,
  VideoItem,
  WordToken,
} from "@/lib/timeline";
import { TIME_EPSILON, roundSeconds } from "@/lib/timeline";
import { captionSettingsSchema } from "@/lib/types/caption";
import { generateSettingsSchema } from "@/lib/types/pipeline";
import type { AspectRatio } from "@/lib/types/project";
import { jsonObjectSchema } from "@/lib/types/json";
import type {
  GeneratorContext,
  NarrationLineInput,
  ResolvedBackgroundInput,
  ResolvedBlockVisual,
} from "./types";

/* Document-local handles, not database ids — see ASSET_HANDLE_INDIRECTION. */
export const BACKDROP_ITEM_ID = "backdrop";
export const BACKGROUND_ITEM_ID = "background-clip";
export const BACKGROUND_HANDLE = "background";
export const BACKGROUND_TRACK_ID = "background";
export const FOOTAGE_TRACK_ID = "footage";
export const NARRATION_TRACK_ID = "narration";
export const MUSIC_TRACK_ID = "music";
export const MUSIC_ITEM_ID = "music-bed";
export const MUSIC_HANDLE = "music_bed";

/**
 * SOURCE OF TRUTH KEYWORDS: MUSIC_GAIN, DUCK_IS_A_REQUEST
 *
 * The bed's gain BEFORE ducking. The renderer multiplies this by the duck
 * curve, so it is the level under the quiet parts rather than under the
 * narration — which is why it is this high. Picked to sit under speech at the
 * duck level src/lib/render/ducking.ts applies.
 */
export const MUSIC_GAIN = 0.45;

/**
 * SOURCE OF TRUTH KEYWORDS: SAFE_ZONE_BY_ASPECT
 *
 * Which platform's chrome to stay clear of, from the output shape. A vertical
 * video is going to Reels, TikTok or Shorts and their insets are close enough
 * that one choice serves; a square or landscape export is not going to a
 * vertical feed at all, so clamping captions away from controls that are not
 * there would waste a sixth of the frame.
 */
export const SAFE_ZONE_BY_ASPECT: Readonly<
  Record<AspectRatio, TimelineDoc["style"]["safeZone"]>
> = {
  "9:16": "reels",
  "1:1": "none",
  "16:9": "none",
};

/**
 * SOURCE OF TRUTH KEYWORDS: narrationHandle, ASSET_HANDLE_INDIRECTION
 *
 * The document-local handle for one line's audio. Derived from the LINE id,
 * not the asset id, so re-recording a line keeps the same handle and the
 * editor's references to it survive — see ASSET_HANDLE_INDIRECTION in the
 * timeline schema for why the two are different things.
 */
export function narrationHandle(lineId: string): string {
  return `narration_${lineId}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: layNarration, NARRATION_IS_SEQUENTIAL,
 *   NARRATION_IS_A_SPEAKER
 *
 * WHAT:  The narration track, its asset refs, the total duration, and where
 *        each line landed.
 *
 * WHY:   NARRATION_IS_SEQUENTIAL. Lines are laid end to end by accumulating
 *        their MEASURED durations, in script order — there is no gap and no
 *        crossfade. A gap would desynchronise every word timing after it,
 *        because Phase 08 produced one narration-wide word array by offsetting
 *        each line by exactly the sum of the durations before it
 *        (`concatAlignedLines`). This function and that one have to agree about
 *        where line four starts, and the only way to guarantee that is to
 *        accumulate the same numbers in the same order.
 *
 *        NARRATION_IS_A_SPEAKER in the renderer: an audio item counts as
 *        narration — and therefore ducks the music — precisely because it names
 *        a speaker. Omitting the tag would leave the bed at full volume under
 *        the voice.
 *
 *        It returns the SPANS as well as the track, because a format that puts
 *        a character on screen needs to know when each speaker was talking
 *        (`buildAvatarWindows`) and re-deriving that from the finished items
 *        would mean reading the document it just built. Phase 13 added the
 *        first WORD INDEX to each span for the same reason, so a card can be
 *        anchored to the word that introduces it.
 *
 *        Phase 13 also made the "no gap" rule a DEFAULT rather than a law: a
 *        format may ask for a measured beat before a line
 *        (`LayNarrationOptions`), and the WORDS come back shifted by exactly
 *        what was inserted so the document stays internally consistent
 *        (BEATS_SHIFT_THE_WORDS). With no beats asked for — every format but
 *        the quiz — nothing about the output changes.
 * WHERE: All three generators, first thing.
 */
export function layNarration(
  ctx: GeneratorContext,
  options: LayNarrationOptions = {},
): {
  track: Track | null;
  assets: Record<string, AssetRef>;
  totalSec: number;
  spans: NarrationSpan[];
  /**
   * The aligned words, SHIFTED by whatever beats were inserted — see
   * BEATS_SHIFT_THE_WORDS. Identical to `ctx.words` when no beats were asked
   * for, which is every format but the quiz.
   */
  words: WordToken[];
} {
  const items: AudioItem[] = [];
  const assets: Record<string, AssetRef> = {};
  const spans: NarrationSpan[] = [];
  /* The gapless position of each line, which is the coordinate system the
   * ALIGNMENT used — words are placed against these, not against the shifted
   * ones. */
  const gaplessStarts: number[] = [];
  /* How much has been inserted before each line, cumulative. */
  const shiftByLine: number[] = [];

  let offsetSec = 0;
  let gaplessSec = 0;
  let insertedSec = 0;

  for (const [index, line] of ctx.lines.entries()) {
    /* BEAT_IS_BEFORE_THE_LINE — a beat belongs to the line it precedes, so
     * dropping the last line cannot leave a trailing silence behind. */
    const beat = Math.max(0, options.beatBeforeLine?.(index) ?? 0);
    offsetSec = roundSeconds(offsetSec + beat);
    insertedSec = roundSeconds(insertedSec + beat);

    gaplessStarts.push(gaplessSec);
    shiftByLine.push(insertedSec);

    const handle = narrationHandle(line.id);
    items.push({
      id: `line-${line.id}`,
      start: offsetSec,
      duration: line.durationSec,
      assetId: handle,
      speaker: line.speakerTag,
      gain: 1,
      duck: false,
      loop: false,
      label: `Line ${line.position + 1}`,
    });
    assets[handle] = {
      assetId: line.audioAssetId,
      kind: "audio",
      license: "generated",
      ...(line.durationSec > 0 ? { durationInSeconds: line.durationSec } : {}),
    };
    spans.push({
      speakerTag: line.speakerTag,
      start: offsetSec,
      duration: line.durationSec,
      lineIndex: index,
      firstWordIndex: null,
    });

    offsetSec = roundSeconds(offsetSec + line.durationSec);
    gaplessSec = roundSeconds(gaplessSec + line.durationSec);
  }

  const words = shiftWordsForBeats({
    words: ctx.words,
    gaplessStarts,
    shiftByLine,
    spans,
  });

  return {
    track:
      items.length === 0
        ? null
        : {
            id: NARRATION_TRACK_ID,
            type: "audio",
            label: "Narration",
            items,
          },
    assets,
    totalSec: offsetSec,
    spans,
    words,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: LayNarrationOptions, beatBeforeLine,
 *   COUNTDOWN_IS_A_LEAD_GAP, BEAT_IS_BEFORE_THE_LINE
 *
 * WHAT:  How a format asks for silence between two narration lines.
 *
 * WHY:   COUNTDOWN_IS_A_LEAD_GAP. Phase 13 needs a thinking beat between a
 *        question and its answer — "music or ticking and no speech" — and that
 *        means a hole in the narration lane, which NARRATION_IS_SEQUENTIAL
 *        otherwise forbids. The full argument for putting it HERE rather than
 *        in the TTS seam or in the narration and alignment stages is written
 *        out under COUNTDOWN_IS_A_LEAD_GAP in src/lib/quiz/narration.ts; the
 *        short version is that a beat is a LAYOUT decision about a document,
 *        and laying documents out is what a generator does.
 *
 *        A CALLBACK rather than an array, so a format expresses the rule it
 *        actually has ("a beat before every reveal") instead of building a
 *        parallel array whose length has to be kept equal to `ctx.lines` by
 *        hand. A format with no beats passes nothing and gets today's
 *        behaviour byte for byte.
 *
 *        Negative values are clamped to zero rather than refused: a beat is
 *        derived from a customer's setting, and a format that computed a
 *        negative one would otherwise overlap two audio items — which is a
 *        video with two voices talking over each other, a far worse outcome
 *        than a beat that did not happen.
 * WHERE: The second argument of `layNarration`. Passed only by
 *        src/lib/generators/quiz.ts.
 */
export interface LayNarrationOptions {
  /** Seconds of silence to leave before the line at this index. */
  beatBeforeLine?: ((lineIndex: number) => number) | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: NarrationSpan, SPAN_KNOWS_ITS_LINE,
 *   SPAN_KNOWS_ITS_FIRST_WORD
 *
 * WHAT:  Where one narration line landed, and how to address it.
 *
 * WHY:   SPAN_KNOWS_ITS_LINE. `buildAvatarWindows` needed only the speaker and
 *        the times, but Phase 13 has to put a CARD over a particular line's
 *        audio — so the span carries its own index and the index of its first
 *        aligned WORD.
 *
 *        SPAN_KNOWS_ITS_FIRST_WORD, and the word index is the load-bearing one:
 *        it is what lets a scene item be anchored with `{ wordIndex }` instead
 *        of a hard-coded offset, so re-recording the narration moves the card
 *        with the voice (TWO_FORMED_TIMING in the timeline schema). It is NULL
 *        when the alignment produced no words for this line, which is a real
 *        case — a line the aligner could not read, or a whole alignment that
 *        failed — and a caller must fall back to seconds rather than emitting
 *        an anchor that dangles (ANCHOR_ONLY_WHEN_THERE_ARE_WORDS).
 * WHERE: `layNarration`'s return; consumed by the avatar windows and by the
 *        quiz generator.
 */
export interface NarrationSpan {
  speakerTag: string;
  start: number;
  duration: number;
  /** Its position in `ctx.lines`. */
  lineIndex: number;
  /** The index into `doc.words` of this line's first word, or null. */
  firstWordIndex: number | null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: shiftWordsForBeats, BEATS_SHIFT_THE_WORDS,
 *   WORDS_ARE_ASSIGNED_BY_GAPLESS_TIME
 *
 * WHAT:  The aligned words moved to where they now actually fall, and each
 *        span told which word it starts on.
 *
 * WHY:   BEATS_SHIFT_THE_WORDS is the half of the beat decision that makes it
 *        safe. The alignment stage builds one narration-wide word array by
 *        offsetting each line by the SUM OF THE DURATIONS BEFORE IT
 *        (`concatAlignedLines`) — no beats, because it knows nothing about
 *        formats and should not. So the moment a generator inserts silence, the
 *        stored word times and the audio items disagree by the accumulated
 *        beat, and every caption and every anchor after the first beat would be
 *        early.
 *
 *        Shifting here keeps the DOCUMENT internally consistent, which is the
 *        only consistency that matters: the words, the audio items, the
 *        captions and the anchors all agree, and the alignment row stays
 *        correct for its own purpose and is not rewritten. A document is the
 *        output; an alignment is an input that several documents can be built
 *        from.
 *
 *        WORDS_ARE_ASSIGNED_BY_GAPLESS_TIME: a word is attributed to a line by
 *        comparing its start against the line's GAPLESS window, because that is
 *        the coordinate system the word was written in. Walking both lists once
 *        in order rather than searching per word, since both are already
 *        sorted — and the boundary comparison carries TIME_EPSILON, because a
 *        word that starts exactly on a line boundary is the first word of the
 *        new line and floating-point addition of durations does not land
 *        exactly.
 *
 *        Returns a NEW array and never mutates `ctx.words`: the context is
 *        shared with whatever else the workflow does with it, and a generator
 *        that wrote through it would be a generator with a side effect.
 * WHERE: `layNarration`, once.
 */
function shiftWordsForBeats(args: {
  words: readonly WordToken[];
  gaplessStarts: readonly number[];
  shiftByLine: readonly number[];
  spans: NarrationSpan[];
}): WordToken[] {
  const { words, gaplessStarts, shiftByLine, spans } = args;
  if (words.length === 0 || gaplessStarts.length === 0) return [...words];

  const shifted: WordToken[] = [];
  let lineIndex = 0;

  for (const word of words) {
    /* Advance to the line this word falls in. Never past the last one: a word
     * beyond the measured narration belongs to its final line, which is the
     * honest reading of an alignment slightly longer than the audio. */
    while (
      lineIndex + 1 < gaplessStarts.length &&
      word.s >= (gaplessStarts[lineIndex + 1] ?? Number.POSITIVE_INFINITY) -
        TIME_EPSILON
    ) {
      lineIndex += 1;
    }

    const shift = shiftByLine[lineIndex] ?? 0;
    const span = spans[lineIndex];
    if (span !== undefined && span.firstWordIndex === null) {
      span.firstWordIndex = word.i;
    }

    shifted.push({
      ...word,
      s: roundSeconds(word.s + shift),
      e: roundSeconds(word.e + shift),
    });
  }

  return shifted;
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildBackgroundTrack,
 *   FOOTAGE_OR_BACKDROP_NEVER_BOTH, LOOP_TO_THE_NARRATION
 *
 * WHAT:  What plays behind the words: the chosen footage, or the styled
 *        gradient when there is none.
 *
 * WHY:   FOOTAGE_OR_BACKDROP_NEVER_BOTH, and the exclusivity is the point: a
 *        backdrop on the SCENE track composites ABOVE a video item
 *        (LAYER_ORDER in src/lib/render), so emitting both would draw a
 *        gradient over the footage the customer chose and the bug would look
 *        like "my background did not apply". ONE function returning ONE track
 *        is how that is made structural rather than remembered.
 *
 *        LOOP_TO_THE_NARRATION. The item spans the whole narration and asks to
 *        be looped; the repetition itself is the renderer's, with Remotion's
 *        `<Loop>` rather than the element's own playhead
 *        (LOOP_VIA_REMOTION_LOOP), which is what keeps a frame a pure function
 *        of its number and therefore keeps Phase 04's render reuse correct.
 *        `durationInSeconds` on the asset ref is what the loop divides by,
 *        which is why a background with no measured duration is emitted with
 *        `loop: false` — a clip that holds on its last frame is honest, and a
 *        loop with no modulus is a division by zero.
 *
 *        `muted: true` because a gameplay loop carries a second soundtrack
 *        nobody asked for under the narration. The ingest already dropped the
 *        audio track for `background` and `ai_footage` kinds
 *        (MUTE_BACKGROUNDS_NOT_UPLOADS), so for a catalogue row this is belt
 *        and braces — but a customer's own UPLOAD keeps its audio, and that is
 *        exactly the row this flag is load-bearing for.
 *
 *        `fit: "cover"` and no geometry anywhere: the ingest produced a 9:16
 *        master, so there is nothing to crop at render time
 *        (CROP_AT_TRANSCODE).
 *
 *        Returns null for a zero-length video, which `validate()` refuses — so
 *        an empty run emits no background rather than an invisible one.
 * WHERE: Both generators.
 */
export function buildBackgroundTrack(args: {
  background: ResolvedBackgroundInput | null;
  totalSec: number;
  paletteId: string;
}): { track: Track | null; assets: Record<string, AssetRef> } {
  if (args.totalSec <= 0) return { track: null, assets: {} };

  const background = args.background;

  if (background !== null) {
    const loopable =
      background.durationSec !== null && background.durationSec > 0;

    return {
      track: {
        id: FOOTAGE_TRACK_ID,
        type: "video",
        label: "Background",
        items: [
          {
            id: BACKGROUND_ITEM_ID,
            start: 0,
            duration: args.totalSec,
            assetId: BACKGROUND_HANDLE,
            fit: "cover",
            loop: loopable,
            muted: true,
            render: "media",
          },
        ],
      },
      assets: {
        [BACKGROUND_HANDLE]: {
          assetId: background.assetId,
          kind: "video",
          /* The licence travels WITH the document so a render can be refused
           * months later without re-reading a provider's terms. */
          license: background.license,
          ...(loopable && background.durationSec !== null
            ? { durationInSeconds: background.durationSec }
            : {}),
          ...(background.width !== null ? { width: background.width } : {}),
          ...(background.height !== null ? { height: background.height } : {}),
        },
      },
    };
  }

  return {
    track: {
      id: BACKGROUND_TRACK_ID,
      type: "scene",
      label: "Background",
      items: [
        {
          id: BACKDROP_ITEM_ID,
          start: 0,
          duration: args.totalSec,
          render: "backdrop",
          scene: {
            layout: "fill",
            elements: [
              {
                id: "fill",
                kind: BACKDROP_ELEMENT_KIND,
                /* PALETTE_IS_BAKED_ONTO_THE_ITEM — the component cannot read
                 * the document's style block. */
                props: { paletteId: args.paletteId },
              },
            ],
          },
        },
      ],
    },
    assets: {},
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildBlockVisualTracks, BLOCK_SPANS_ARE_CONTIGUOUS,
 *   ONE_FUNCTION_OWNS_WHAT_IS_BEHIND_THE_WORDS, STILLS_GET_KEN_BURNS,
 *   GAPS_FALL_BACK_IN_TIME, KEN_BURNS_SCALE
 *
 * WHAT:  Everything behind the words for a format that chooses a picture PER
 *        BLOCK: one clip or still per block that has one, and the project's
 *        background or the styled backdrop over every second that no block
 *        visual covers.
 *
 * WHY:   ONE_FUNCTION_OWNS_WHAT_IS_BEHIND_THE_WORDS, and it is the same
 *        exclusivity argument FOOTAGE_OR_BACKDROP_NEVER_BOTH makes, extended
 *        from "the whole video" to "a stretch of it". A backdrop sits on the
 *        SCENE track, which composites ABOVE video (LAYER_ORDER in
 *        src/lib/render/frame-plan.ts), so a document carrying both a full-
 *        length backdrop and per-block clips would draw a gradient over every
 *        picture — and the bug would look like "my visuals did not apply". The
 *        only way to make that structurally impossible is for ONE function to
 *        decide both, which is why this returns a LIST of tracks rather than
 *        being composed from two calls at the callsite.
 *
 *        GAPS_FALL_BACK_IN_TIME. A block with no usable visual is the normal
 *        case — both providers may be unconfigured, a search may match nothing,
 *        a prompt may be refused — so the fallback is applied per STRETCH, not
 *        per video. Each uncovered run of seconds gets the project's chosen
 *        background if it has one, or a backdrop if it does not. That is what
 *        makes "with both providers disabled, the video still completes on the
 *        styled background" and "five blocks produce five matching visuals" the
 *        same code path with different inputs, rather than two.
 *
 *        BLOCK_SPANS_ARE_CONTIGUOUS. A block becomes one or more narration
 *        lines (`splitBlockIntoLines`), and because `layNarration` lays lines
 *        in script order those lines are adjacent — so a block's span is its
 *        first line's start to its last line's end, and a run is detected by
 *        walking the spans once. It is computed from the SPANS rather than from
 *        a sum of durations so that a beat inserted between lines
 *        (BEATS_SHIFT_THE_WORDS) is inside the block that follows it, exactly
 *        as the audio is.
 *
 *        STILLS_GET_KEN_BURNS and clips do not. A generated image held for six
 *        seconds reads as a frozen frame, which the phase names as the reason
 *        for the drift; the same drift applied to moving footage reads as a
 *        camera wobble. `isStill` arrives as a FACT on the resolved visual
 *        because a generator cannot read an asset row.
 *
 *        The drift goes in the item's `props` bag, which is where `MediaClip`
 *        has read it since Phase 03 (KEN_BURNS) — not a new field on the
 *        schema, and not a new render kind.
 * WHERE: src/lib/generators/voiceover.ts, when the project has any resolved
 *        block visual. With none, that generator calls `buildBackgroundTrack`
 *        exactly as before, so an existing project's document — and therefore
 *        its render cache entry — is unchanged by this phase.
 */
export const VISUAL_TRACK_ID = "visuals";

/**
 * SOURCE OF TRUTH KEYWORDS: KEN_BURNS_SCALE, DRIFT_IS_SMALL_ON_PURPOSE
 *
 * How much a still drifts over its own span. The component's own default is the
 * same figure; it is named here as well because this is the layer that DECIDES
 * to ask for it, and a generator silently relying on a component's default
 * would make the amount of motion in a video a fact about a React file.
 *
 * Eight percent is enough to read as motion on a phone and small enough that a
 * two-second block does not feel like a zoom.
 */
export const KEN_BURNS_SCALE = 1.08;

export function buildBlockVisualTracks(args: {
  lines: readonly NarrationLineInput[];
  spans: readonly NarrationSpan[];
  visuals: Readonly<Record<string, ResolvedBlockVisual | undefined>>;
  background: ResolvedBackgroundInput | null;
  totalSec: number;
  paletteId: string;
}): { tracks: Track[]; assets: Record<string, AssetRef>; covered: number } {
  if (args.totalSec <= 0) return { tracks: [], assets: {}, covered: 0 };

  const runs = blockRuns(args.lines, args.spans);

  const visualItems: VideoItem[] = [];
  const assets: Record<string, AssetRef> = {};
  /* The stretches no block visual covers, in order. */
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;

  for (const run of runs) {
    const visual = args.visuals[run.blockId];
    if (visual === undefined) continue;

    /* A run that starts after the cursor leaves a hole; the backdrop or the
     * project background fills it (GAPS_FALL_BACK_IN_TIME). */
    if (run.start > cursor + TIME_EPSILON) {
      gaps.push({ start: cursor, end: run.start });
    }

    const duration = roundSeconds(run.end - run.start);
    if (duration <= 0) continue;

    const handle = visualHandle(run.blockId);
    const loopable =
      !visual.isStill && visual.durationSec !== null && visual.durationSec > 0;

    visualItems.push({
      id: `visual-${run.blockId}`,
      start: run.start,
      duration,
      assetId: handle,
      fit: "cover",
      loop: loopable,
      /* A stock clip carries its own soundtrack, and nobody asked for it under
       * the narration — the same reasoning as the background's `muted`. */
      muted: true,
      render: "media",
      /* STILLS_GET_KEN_BURNS — see the file header. */
      ...(visual.isStill
        ? { props: { kenBurns: true, kenBurnsScale: KEN_BURNS_SCALE } }
        : {}),
    });

    assets[handle] = {
      assetId: visual.assetId,
      kind: visual.isStill ? "image" : "video",
      /* The licence travels WITH the document, so a render can be refused
       * months later without re-reading a provider's terms. */
      license: visual.license,
      ...(loopable && visual.durationSec !== null
        ? { durationInSeconds: visual.durationSec }
        : {}),
      ...(visual.width !== null ? { width: visual.width } : {}),
      ...(visual.height !== null ? { height: visual.height } : {}),
    };

    cursor = roundSeconds(run.end);
  }

  if (cursor < args.totalSec - TIME_EPSILON) {
    gaps.push({ start: cursor, end: args.totalSec });
  }

  const tracks: Track[] = [];

  /* Bottom-most first within the video lane, and the fallback is laid BEFORE
   * the block visuals so that a rounding overlap of a frame shows the picture
   * rather than the gradient. */
  const fallback = buildFallbackTrack({
    gaps,
    background: args.background,
    paletteId: args.paletteId,
  });
  if (fallback.track !== null) tracks.push(fallback.track);
  Object.assign(assets, fallback.assets);

  if (visualItems.length > 0) {
    tracks.push({
      id: VISUAL_TRACK_ID,
      type: "video",
      label: "Visuals",
      items: visualItems,
    });
  }

  return { tracks, assets, covered: visualItems.length };
}

/**
 * SOURCE OF TRUTH KEYWORDS: visualHandle, ASSET_HANDLE_INDIRECTION
 *
 * The document-local handle for one block's visual. Derived from the BLOCK id,
 * not the asset id, so swapping a block's picture keeps the same handle and the
 * editor's references to it survive — exactly as `narrationHandle` is derived
 * from the line id and for the same reason.
 */
export function visualHandle(blockId: string): string {
  return `visual_${blockId}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: blockRuns, BLOCK_SPANS_ARE_CONTIGUOUS
 *
 * WHAT:  Each block's span: first line's start to last line's end, in order.
 * WHY:   See BLOCK_SPANS_ARE_CONTIGUOUS in `buildBlockVisualTracks`. Walked
 *        once rather than grouped into a map, because the ORDER is the script's
 *        and a map would lose it — and because a block id appearing twice
 *        non-adjacently would mean the narration was reordered, in which case
 *        two separate runs is the honest reading rather than one span with a
 *        hole in it.
 * WHERE: `buildBlockVisualTracks`.
 */
function blockRuns(
  lines: readonly NarrationLineInput[],
  spans: readonly NarrationSpan[],
): { blockId: string; start: number; end: number }[] {
  const runs: { blockId: string; start: number; end: number }[] = [];

  for (const span of spans) {
    const line = lines[span.lineIndex];
    /* A line with no block — pre-Phase-14 audio, or a planned narration like a
     * quiz's — cannot carry a per-block visual, so it extends nothing and
     * breaks the current run. */
    const blockId = line?.blockId ?? null;
    const end = roundSeconds(span.start + span.duration);

    if (blockId === null) continue;

    const previous = runs[runs.length - 1];
    if (previous !== undefined && previous.blockId === blockId) {
      previous.end = end;
      continue;
    }
    runs.push({ blockId, start: span.start, end });
  }

  return runs;
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildFallbackTrack, GAPS_FALL_BACK_IN_TIME
 *
 * WHAT:  The project's background, or the styled backdrop, over exactly the
 *        stretches no block visual covers.
 *
 * WHY:   The per-stretch version of `buildBackgroundTrack`'s decision, and it
 *        keeps that function's two rules intact rather than reimplementing
 *        them: footage is `muted`, `cover` and looped only when a source length
 *        is known (LOOP_TO_THE_NARRATION), and with no footage the fill is a
 *        backdrop element with the palette baked on
 *        (PALETTE_IS_BAKED_ONTO_THE_ITEM).
 *
 *        One track, many items, rather than one track per gap: a lane is a
 *        lane, and a document with six background tracks would be unreadable in
 *        Phase 15's editor for no gain.
 * WHERE: `buildBlockVisualTracks` only.
 */
function buildFallbackTrack(args: {
  gaps: readonly { start: number; end: number }[];
  background: ResolvedBackgroundInput | null;
  paletteId: string;
}): { track: Track | null; assets: Record<string, AssetRef> } {
  if (args.gaps.length === 0) return { track: null, assets: {} };

  const background = args.background;

  if (background !== null) {
    const loopable =
      background.durationSec !== null && background.durationSec > 0;

    return {
      track: {
        id: FOOTAGE_TRACK_ID,
        type: "video",
        label: "Background",
        items: args.gaps.map((gap, index) => ({
          id: `${BACKGROUND_ITEM_ID}-${index}`,
          start: gap.start,
          duration: roundSeconds(gap.end - gap.start),
          assetId: BACKGROUND_HANDLE,
          fit: "cover" as const,
          loop: loopable,
          muted: true,
          render: "media" as const,
        })),
      },
      assets: {
        [BACKGROUND_HANDLE]: {
          assetId: background.assetId,
          kind: "video",
          license: background.license,
          ...(loopable && background.durationSec !== null
            ? { durationInSeconds: background.durationSec }
            : {}),
          ...(background.width !== null ? { width: background.width } : {}),
          ...(background.height !== null ? { height: background.height } : {}),
        },
      },
    };
  }

  return {
    track: {
      id: BACKGROUND_TRACK_ID,
      type: "scene",
      label: "Background",
      items: args.gaps.map((gap, index) => ({
        id: `${BACKDROP_ITEM_ID}-${index}`,
        start: gap.start,
        duration: roundSeconds(gap.end - gap.start),
        render: "backdrop" as const,
        scene: {
          layout: "fill",
          elements: [
            {
              id: "fill",
              kind: BACKDROP_ELEMENT_KIND,
              props: { paletteId: args.paletteId },
            },
          ],
        },
      })),
    },
    assets: {},
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildMusicTrack, MUSIC_IS_OPTIONAL,
 *   DUCK_IS_A_REQUEST
 *
 * WHAT:  The optional ducked music bed.
 *
 * WHY:   MUSIC_IS_OPTIONAL and normally absent. The track exists only when the
 *        project's settings name an asset. Emitting a music item pointing at a
 *        handle with no asset behind it would be worse than omitting it:
 *        `MISSING_ASSET_DRAWS_NOTHING` means the renderer would silently skip
 *        it, so the document would claim a music bed the video does not have.
 *
 *        DUCK_IS_A_REQUEST, which is why the item carries `duck: true` and no
 *        gain curve. The curve is computed at DRAW time by
 *        src/lib/render/ducking.ts against the narration windows the renderer
 *        collects, not baked here. Baking it would freeze the mix against word
 *        timings that re-aligning is allowed to move, and the document would
 *        then be wrong in a way nothing validates.
 * WHERE: Both generators.
 */
export function buildMusicTrack(args: {
  musicAssetId: string | undefined;
  totalSec: number;
}): { track: Track | null; assets: Record<string, AssetRef> } {
  if (args.musicAssetId === undefined || args.totalSec <= 0) {
    return { track: null, assets: {} };
  }

  return {
    track: {
      id: MUSIC_TRACK_ID,
      type: "audio",
      label: "Music",
      items: [
        {
          id: MUSIC_ITEM_ID,
          start: 0,
          duration: args.totalSec,
          assetId: MUSIC_HANDLE,
          gain: MUSIC_GAIN,
          duck: true,
          /* A bed is almost always shorter than the narration, and the
           * renderer loops with <Loop> rather than the element's own playhead
           * (LOOP_VIA_REMOTION_LOOP). */
          loop: true,
        },
      ],
    },
    assets: {
      [MUSIC_HANDLE]: {
        assetId: args.musicAssetId,
        kind: "audio",
        /**
         * SOURCE OF TRUTH KEYWORDS: MUSIC_LICENCE_IS_NOT_RESOLVED_YET
         *
         * The customer's own upload, which is what it is today: Phase 11 built
         * the library's audio half but wired no music PICKER, so the only way a
         * bed gets here is a setting naming an asset the workspace uploaded.
         *
         * It is NOT resolved from the asset's `source` the way the background's
         * licence is, and that is a known gap rather than an oversight — doing
         * it properly means resolving the bed in `generatorContextFor` and
         * handing it over as a fact, exactly as the background is
         * (RESOLVED_BEFORE_THE_GENERATOR), because a pure generator cannot read
         * an asset row. Whoever builds the music picker owns that, and this
         * comment is the note they need: a licensed catalogue bed labelled
         * `owned` would be a claim nobody checked.
         */
        license: "owned",
      },
    },
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildSpeakers, SPEAKERS_COME_FROM_THE_CAST
 *
 * The document's speaker record. Built from the cast the context carries rather
 * than from the lines, so a speaker with no line yet still appears — which is
 * what makes a re-generation after an edit keep the same cast.
 */
export function buildSpeakers(ctx: GeneratorContext): TimelineDoc["speakers"] {
  const speakers: TimelineDoc["speakers"] = {};
  for (const [tag, voiceId] of Object.entries(ctx.speakers)) {
    speakers[tag] = voiceId === null ? {} : { voiceId };
  }
  /* A line whose tag is missing from the cast would leave an audio item
   * pointing at a speaker the document does not declare. */
  for (const line of ctx.lines) {
    speakers[line.speakerTag] ??= {};
  }
  return speakers;
}

/**
 * SOURCE OF TRUTH KEYWORDS: readGeneratorSettings,
 *   SETTINGS_ARE_PARSED_NOT_TRUSTED
 *
 * WHAT:  The settings blocks a generator reads, with defaults.
 * WHY:   `Project.settings` is one shared jsonb column written by several
 *        phases, so what is in it is `unknown` and may have been written by an
 *        older release. Parsed with each owner's OWN schema and defaulted on
 *        failure, because a malformed caption preference must produce default
 *        captions rather than a failed generation.
 * WHERE: Both generators.
 */
export function readGeneratorSettings(
  settings: Readonly<Record<string, unknown>>,
): {
  generate: {
    paletteId?: string | undefined;
    musicAssetId?: string | undefined;
  };
  captions: {
    styleId: string;
    enabled: boolean;
    wordsPerChunk: number;
    position: "top" | "middle" | "bottom";
    speakerColors: boolean;
  };
} {
  const object = jsonObjectSchema.safeParse(settings);
  const bag = object.success ? object.data : {};

  const generate = generateSettingsSchema.safeParse(bag["generate"]);
  const captions = captionSettingsSchema.safeParse(bag["captions"]);

  return {
    generate: generate.success
      ? {
          ...(generate.data.paletteId !== undefined
            ? { paletteId: generate.data.paletteId }
            : {}),
          ...(generate.data.musicAssetId !== undefined
            ? { musicAssetId: generate.data.musicAssetId }
            : {}),
        }
      : {},
    captions: captions.success
      ? {
          styleId: captions.data.styleId,
          enabled: captions.data.enabled,
          wordsPerChunk: captions.data.wordsPerChunk,
          position: captions.data.position,
          /* Absent on every settings object written before Phase 12. */
          speakerColors: captions.data.speakerColors ?? false,
        }
      : {
          styleId: DEFAULT_CAPTION_STYLE_ID,
          enabled: true,
          wordsPerChunk: 3,
          position: "bottom",
          speakerColors: false,
        },
  };
}

/** The palette an item bakes in, from the settings or the default. */
export function paletteIdFor(settings: {
  generate: { paletteId?: string | undefined };
}): string {
  return settings.generate.paletteId ?? DEFAULT_PALETTE_ID;
}
