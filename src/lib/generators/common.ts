/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: layNarration, buildBackgroundTrack,
 *   buildMusicTrack, buildSpeakers, readGeneratorSettings, narrationHandle,
 *   SHARED_BY_EVERY_FORMAT, NARRATION_IS_SEQUENTIAL,
 *   FOOTAGE_OR_BACKDROP_NEVER_BOTH, LOOP_TO_THE_NARRATION, MUSIC_IS_OPTIONAL,
 *   SAFE_ZONE_BY_ASPECT
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
import type { AssetRef, AudioItem, TimelineDoc, Track } from "@/lib/timeline";
import { captionSettingsSchema } from "@/lib/types/caption";
import { generateSettingsSchema } from "@/lib/types/pipeline";
import type { AspectRatio } from "@/lib/types/project";
import { jsonObjectSchema } from "@/lib/types/json";
import type { GeneratorContext, ResolvedBackgroundInput } from "./types";

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
 *        would mean reading the document it just built.
 * WHERE: Both generators, first thing.
 */
export function layNarration(ctx: GeneratorContext): {
  track: Track | null;
  assets: Record<string, AssetRef>;
  totalSec: number;
  spans: { speakerTag: string; start: number; duration: number }[];
} {
  const items: AudioItem[] = [];
  const assets: Record<string, AssetRef> = {};
  const spans: { speakerTag: string; start: number; duration: number }[] = [];
  let offsetSec = 0;

  for (const line of ctx.lines) {
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
    });
    offsetSec += line.durationSec;
  }

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
  };
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
