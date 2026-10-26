/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: voiceoverGenerator, buildVoiceoverDocument,
 *   NARRATION_IS_SEQUENTIAL, MUSIC_IS_OPTIONAL, DUCK_IS_A_REQUEST,
 *   BACKDROP_SPANS_THE_NARRATION, FOOTAGE_OR_BACKDROP_NEVER_BOTH,
 *   LOOP_TO_THE_NARRATION, EMPTY_WORDS_STILL_BUILDS,
 *   GENERATED_DOC_IS_ANCHORED, MUSIC_GAIN, VOICEOVER_SKIPS
 *
 * WHAT:  The first generator: narration over a styled background, with captions
 *        and an optional ducked music bed.
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
 *        DUCK_IS_A_REQUEST, which is why the music item carries `duck: true`
 *        and no gain curve. The phase asks for "music with ducking driven by
 *        word timings" and that is exactly what happens — but the curve is
 *        computed at DRAW time by src/lib/render/ducking.ts against the
 *        narration windows the renderer collects, not baked here. Baking it
 *        would freeze the mix against word timings that re-aligning is allowed
 *        to move, and the document would then be wrong in a way nothing
 *        validates.
 *
 *        MUSIC_IS_OPTIONAL and normally absent. There is no music library until
 *        Phase 11, so the track exists only when the project's settings name an
 *        asset. Emitting a music item pointing at a handle with no asset behind
 *        it would be worse than omitting it: `MISSING_ASSET_DRAWS_NOTHING`
 *        means the renderer would silently skip it, so the document would claim
 *        a music bed the video does not have.
 *
 *        BACKDROP_SPANS_THE_NARRATION rather than being looped or repeated. It
 *        is a gradient — one item for the whole duration is both cheaper and
 *        the only version with no seam. From Phase 11 a `voiceover` document
 *        carries real footage on the video track instead, and the generator
 *        emits ONE or the other, never both: a backdrop on the scene track
 *        composites ABOVE a video item (LAYER_ORDER in src/lib/render), so
 *        keeping both would hide the footage the customer chose.
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

import { buildCaptionTrack, DEFAULT_CAPTION_STYLE_ID } from "@/lib/captions";
import { BACKDROP_ELEMENT_KIND, DEFAULT_PALETTE_ID } from "@/lib/palettes";
import type {
  AssetRef,
  AudioItem,
  TimelineDoc,
  Track,
} from "@/lib/timeline";
import { TIMELINE_DOC_VERSION } from "@/lib/timeline";
import { captionSettingsSchema } from "@/lib/types/caption";
import { generateSettingsSchema } from "@/lib/types/pipeline";
import { CANVAS_BY_ASPECT, type AspectRatio } from "@/lib/types/project";
import { jsonObjectSchema } from "@/lib/types/json";
import type { Generator, GeneratorContext } from "./types";

/* Document-local handles, not database ids — see ASSET_HANDLE_INDIRECTION. */
const BACKDROP_ITEM_ID = "backdrop";
const BACKGROUND_ITEM_ID = "background-clip";
const BACKGROUND_HANDLE = "background";
const NARRATION_TRACK_ID = "narration";
const MUSIC_TRACK_ID = "music";
const MUSIC_ITEM_ID = "music-bed";
const MUSIC_HANDLE = "music_bed";

/**
 * SOURCE OF TRUTH KEYWORDS: MUSIC_GAIN, DUCK_IS_A_REQUEST
 *
 * The bed's gain BEFORE ducking. The renderer multiplies this by the duck
 * curve, so it is the level under the quiet parts rather than under the
 * narration — which is why it is this high. Picked to sit under speech at the
 * duck level src/lib/render/ducking.ts applies.
 */
const MUSIC_GAIN = 0.45;

/**
 * SOURCE OF TRUTH KEYWORDS: SAFE_ZONE_BY_ASPECT
 *
 * Which platform's chrome to stay clear of, from the output shape. A vertical
 * video is going to Reels, TikTok or Shorts and their insets are close enough
 * that one choice serves; a square or landscape export is not going to a
 * vertical feed at all, so clamping captions away from controls that are not
 * there would waste a sixth of the frame.
 */
const SAFE_ZONE_BY_ASPECT: Readonly<Record<AspectRatio, TimelineDoc["style"]["safeZone"]>> = {
  "9:16": "reels",
  "1:1": "none",
  "16:9": "none",
};

/**
 * SOURCE OF TRUTH KEYWORDS: buildVoiceoverDocument, EXPORTED_FOR_TESTS
 *
 * WHAT:  The document, from the context.
 * WHY:   Exported separately from the `Generator` object so a test can call it
 *        without constructing a registry entry, and SYNCHRONOUS because nothing
 *        in it does I/O. The contract is async (Phase 11's generator reads the
 *        media library), so the wrapper below is what adapts one to the other —
 *        rather than making this function async and claiming an await that
 *        never happens.
 * WHERE: ./registry.ts, and generators.test.ts.
 */
export function buildVoiceoverDocument(ctx: GeneratorContext): TimelineDoc {
  const canvas = CANVAS_BY_ASPECT[ctx.aspect];
  const settings = readSettings(ctx.settings);

  /* NARRATION_IS_SEQUENTIAL — one pass, accumulating measured durations. */
  const narrationItems: AudioItem[] = [];
  const assets: Record<string, AssetRef> = {};
  let offsetSec = 0;

  for (const line of ctx.lines) {
    const handle = narrationHandle(line.id);
    narrationItems.push({
      id: `line-${line.id}`,
      start: offsetSec,
      duration: line.durationSec,
      assetId: handle,
      /* NARRATION_IS_A_SPEAKER in the renderer: an audio item counts as
       * narration — and therefore ducks the music — precisely because it names
       * a speaker. Omitting the tag here would leave the bed at full volume
       * under the voice. */
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
    offsetSec += line.durationSec;
  }

  const totalSec = offsetSec;
  const tracks: Track[] = [];

  /**
   * SOURCE OF TRUTH KEYWORDS: FOOTAGE_OR_BACKDROP_NEVER_BOTH,
   *   BACKDROP_SPANS_THE_NARRATION, LOOP_TO_THE_NARRATION
   *
   * Phase 11's half of BACKDROP_SPANS_THE_NARRATION, and the exclusivity is
   * the point: a backdrop on the SCENE track composites ABOVE a video item
   * (LAYER_ORDER in src/lib/render), so emitting both would draw a gradient
   * over the footage the customer chose and the bug would look like "my
   * background did not apply".
   *
   * LOOP_TO_THE_NARRATION. The item spans the whole narration and asks to be
   * looped; the repetition itself is the renderer's, with Remotion's `<Loop>`
   * rather than the element's own playhead (LOOP_VIA_REMOTION_LOOP), which is
   * what keeps a frame a pure function of its number and therefore keeps
   * Phase 04's render reuse correct. `durationInSeconds` on the asset ref is
   * what the loop divides by, which is why a background with no measured
   * duration is emitted with `loop: false` — a clip that holds on its last
   * frame is honest, and a loop with no modulus is a division by zero.
   *
   * `muted: true` because a gameplay loop carries a second soundtrack nobody
   * asked for under the narration. The ingest already dropped the audio track
   * for `background` and `ai_footage` kinds (MUTE_BACKGROUNDS_NOT_UPLOADS), so
   * for a catalogue row this is belt and braces — but a customer's own UPLOAD
   * keeps its audio, and that is exactly the row this flag is load-bearing
   * for.
   *
   * `fit: "cover"` and no geometry anywhere: the ingest produced a 9:16
   * master, so there is nothing to crop at render time (CROP_AT_TRANSCODE).
   *
   * Zero-length when there is no narration at all, which `validate()` refuses
   * — so an empty run emits no background rather than an invisible one.
   */
  const background = ctx.background;

  if (totalSec > 0 && background !== null) {
    const loopable =
      background.durationSec !== null && background.durationSec > 0;

    tracks.push({
      id: "footage",
      type: "video",
      label: "Background",
      items: [
        {
          id: BACKGROUND_ITEM_ID,
          start: 0,
          duration: totalSec,
          assetId: BACKGROUND_HANDLE,
          fit: "cover",
          loop: loopable,
          muted: true,
          render: "media",
        },
      ],
    });

    assets[BACKGROUND_HANDLE] = {
      assetId: background.assetId,
      kind: "video",
      /* The licence travels WITH the document so a render can be refused
       * months later without re-reading a provider's terms — see AssetRef. */
      license: background.license,
      ...(loopable && background.durationSec !== null
        ? { durationInSeconds: background.durationSec }
        : {}),
      ...(background.width !== null ? { width: background.width } : {}),
      ...(background.height !== null ? { height: background.height } : {}),
    };
  } else if (totalSec > 0) {
    tracks.push({
      id: "background",
      type: "scene",
      label: "Background",
      items: [
        {
          id: BACKDROP_ITEM_ID,
          start: 0,
          duration: totalSec,
          render: "backdrop",
          scene: {
            layout: "fill",
            elements: [
              {
                id: "fill",
                kind: BACKDROP_ELEMENT_KIND,
                /* PALETTE_IS_BAKED_ONTO_THE_ITEM — the component cannot read
                 * the document's style block. */
                props: { paletteId: settings.generate.paletteId ?? DEFAULT_PALETTE_ID },
              },
            ],
          },
        },
      ],
    });
  }

  if (narrationItems.length > 0) {
    tracks.push({
      id: NARRATION_TRACK_ID,
      type: "audio",
      label: "Narration",
      items: narrationItems,
    });
  }

  /* MUSIC_IS_OPTIONAL — see the file header. */
  const musicAssetId = settings.generate.musicAssetId;
  if (musicAssetId !== undefined && totalSec > 0) {
    tracks.push({
      id: MUSIC_TRACK_ID,
      type: "audio",
      label: "Music",
      items: [
        {
          id: MUSIC_ITEM_ID,
          start: 0,
          duration: totalSec,
          assetId: MUSIC_HANDLE,
          gain: MUSIC_GAIN,
          /* DUCK_IS_A_REQUEST. The curve is the renderer's. */
          duck: true,
          /* A bed is almost always shorter than the narration, and the
           * renderer loops with <Loop> rather than the element's own playhead
           * (LOOP_VIA_REMOTION_LOOP). */
          loop: true,
        },
      ],
    });
    assets[MUSIC_HANDLE] = {
      assetId: musicAssetId,
      kind: "audio",
      /* The customer's own upload until Phase 11 brings a licensed library. */
      license: "owned",
    };
  }

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
      paletteId: settings.generate.paletteId ?? DEFAULT_PALETTE_ID,
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
 *                         needs (Phases 12 to 14).
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

/**
 * SOURCE OF TRUTH KEYWORDS: narrationHandle, ASSET_HANDLE_INDIRECTION
 *
 * The document-local handle for one line's audio. Derived from the LINE id, not
 * the asset id, so re-recording a line keeps the same handle and the editor's
 * references to it survive — see ASSET_HANDLE_INDIRECTION in the timeline
 * schema for why the two are different things.
 */
function narrationHandle(lineId: string): string {
  return `narration_${lineId}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildSpeakers, SPEAKERS_COME_FROM_THE_CAST
 *
 * The document's speaker record. Built from the cast the context carries rather
 * than from the lines, so a speaker with no line yet still appears — which is
 * what makes a re-generation after an edit keep the same cast.
 */
function buildSpeakers(ctx: GeneratorContext): TimelineDoc["speakers"] {
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
 * SOURCE OF TRUTH KEYWORDS: readSettings, SETTINGS_ARE_PARSED_NOT_TRUSTED
 *
 * WHAT:  The two settings blocks this generator reads, with defaults.
 * WHY:   `Project.settings` is one shared jsonb column written by several
 *        phases, so what is in it is `unknown` and may have been written by an
 *        older release. Parsed with each owner's OWN schema and defaulted on
 *        failure, because a malformed caption preference must produce default
 *        captions rather than a failed generation.
 * WHERE: buildVoiceoverDocument.
 */
function readSettings(settings: Readonly<Record<string, unknown>>): {
  generate: { paletteId?: string | undefined; musicAssetId?: string | undefined };
  captions: {
    styleId: string;
    enabled: boolean;
    wordsPerChunk: number;
    position: "top" | "middle" | "bottom";
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
        }
      : {
          styleId: DEFAULT_CAPTION_STYLE_ID,
          enabled: true,
          wordsPerChunk: 3,
          position: "bottom",
        },
  };
}
