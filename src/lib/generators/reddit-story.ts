/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: redditStoryGenerator, buildRedditStoryDocument,
 *   CARD_THEN_STORY, CARD_IS_NOT_A_CAPTION, ONE_OVERLAY_PER_SPEAKER_RUN,
 *   AVATAR_Z_IS_STABLE, REDDIT_STORY_SKIPS, COMPOSED_FROM_COMMON,
 *   CAST_IS_A_FACT
 *
 * WHAT:  The first complete format: a thread's title card, then the story
 *        narrated by several voices with each speaker's avatar on screen, over
 *        a looping background, captioned.
 *
 * WHY:   COMPOSED_FROM_COMMON. The narration lane, the background, the music
 *        bed, the cast record and the settings read are ./common.ts — identical
 *        to a voiceover, and each decision documented where its code is. What
 *        makes this format itself is two things, and only two: a TITLE CARD at
 *        the front and AVATAR OVERLAYS over the whole thing.
 *
 *        CARD_THEN_STORY. The card occupies the first few seconds and the
 *        narration starts UNDER it rather than after it — the narrator is
 *        already reading the title while it is on screen, which is how these
 *        videos actually work and is why the card is a scene item with its own
 *        span rather than a separate beat the narration waits for. A card that
 *        delayed the audio would put a silent hold at the front of every video,
 *        which is the one place a viewer leaves.
 *
 *        CARD_IS_NOT_A_CAPTION, and the distinction decides which lane it goes
 *        in. A caption is addressed by WORD RANGE and carries no text
 *        (WORD_RANGE_NOT_TEXT); the card shows the thread's title, which is not
 *        a word anybody narrated and which has to be legible whether or not
 *        the alignment produced anything. So it is a SCENE item with the title
 *        in its elements, drawn by the `redditCard` family — which is the
 *        schema working as designed: `render` picks the component family and
 *        `scene` is that family's input.
 *
 *        ONE_OVERLAY_PER_SPEAKER_RUN. The avatars are not one item per line:
 *        `buildAvatarWindows` merges consecutive runs and absorbs the gaps that
 *        would read as flicker, and each surviving window becomes one overlay.
 *        A sixty-line thread would otherwise carry sixty overlay items, every
 *        one needing a distinct `z` while on screen — which the schema refuses.
 *
 *        AVATAR_Z_IS_STABLE: every avatar overlay shares one depth, which is
 *        safe precisely BECAUSE the windows do not overlap — that is what
 *        `buildAvatarWindows` guarantees. Assigning an incrementing `z` per
 *        window would make the depth depend on how many speakers happened to
 *        talk, which is a document that re-renders differently after an edit
 *        that changed nothing visual. The card needs no depth at all: it is a
 *        SCENE item, and scene items stack by their track's position in the
 *        array (LAYER_ORDER), which is why it is pushed last.
 *
 *        CAST_IS_A_FACT. Which avatar belongs to which speaker arrives on the
 *        context, resolved before the build — the same decision, for the same
 *        reason, as the background (RESOLVED_BEFORE_THE_GENERATOR): choosing it
 *        means reading `Speaker.avatarId`, the `Avatar` row and its three
 *        artwork ids, and a generator that could do that would be a generator
 *        that reads a plan.
 *
 *        A speaker with NO avatar is normal and produces no overlay — a
 *        narrator who is never on screen is a deliberate choice, not a missing
 *        one. So is a thread with one voice: this generator produces a correct
 *        single-speaker video with one avatar or none.
 * WHERE: Registered for `reddit-story` in ./registry.ts. Called by the
 *        `timeline` stage of src/inngest/functions/project-generate.ts.
 */

import { buildCaptionTrack } from "@/lib/captions";
import type { AssetRef, OverlayItem, TimelineDoc, Track } from "@/lib/timeline";
import { TIMELINE_DOC_VERSION } from "@/lib/timeline";
import { CANVAS_BY_ASPECT } from "@/lib/types/project";
import { AVATAR_STATES } from "@/lib/types/avatar";
import { buildAvatarWindows } from "./avatar-windows";
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

/* Document-local ids and handles — see ASSET_HANDLE_INDIRECTION. */
const CARD_TRACK_ID = "reddit-card";
const CARD_ITEM_ID = "title-card";
const AVATAR_TRACK_ID = "avatars";

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_CARD_ELEMENT_KIND, CARD_ELEMENT_IS_MATCHED_BY_KIND
 *
 * WHAT:  The scene element the card component reads its content from.
 * WHY:   CARD_ELEMENT_IS_MATCHED_BY_KIND, exactly as the backdrop's palette is
 *        (BACKDROP_ELEMENT_KIND): the component finds its element by `kind`
 *        rather than by position, so an editor that prepends an element to the
 *        scene cannot silently change which one supplies the title. Exported so
 *        the component that reads it and this generator that writes it cannot
 *        drift.
 * WHERE: src/remotion/components/reddit-card.tsx.
 */
export const REDDIT_CARD_ELEMENT_KIND = "redditPost";

/**
 * SOURCE OF TRUTH KEYWORDS: CARD_SECONDS, CARD_THEN_STORY
 *
 * How long the title card stays up. Long enough to read a Reddit title aloud
 * — which is what the narrator is doing underneath it — and short enough that
 * the story starts before a viewer scrolls. It is CAPPED by the video's own
 * length below, so a very short video does not consist entirely of its card.
 */
const CARD_SECONDS = 4;

/**
 * SOURCE OF TRUTH KEYWORDS: AVATAR_BOX, AVATAR_Z
 *
 * WHAT:  Where an avatar sits and how the two overlay depths stack.
 * WHY:   A normalized box, because the schema's `box` is fractions of the
 *        canvas and the renderer converts — which is what keeps one document
 *        correct at 1080p and at 480p (the preview's proxy). The avatar sits
 *        lower-left, clear of the caption band (`CAPTION_BAND_Y` puts the
 *        default band at 0.78) and clear of the platform chrome the safe zone
 *        accounts for.
 *
 *        ONE depth, shared by every avatar — see AVATAR_Z_IS_STABLE for why
 *        that is safe and why an incrementing one would not be.
 */
const AVATAR_BOX = { x: 0.04, y: 0.42, w: 0.34, h: 0.3 };
const AVATAR_Z = 10;

/**
 * SOURCE OF TRUTH KEYWORDS: buildRedditStoryDocument, EXPORTED_FOR_TESTS
 *
 * WHAT:  The document, from the context.
 * WHY:   Exported separately from the `Generator` object so a test can call it
 *        without constructing a registry entry, and SYNCHRONOUS because nothing
 *        in it does I/O — the thread snapshot and the cast are already facts on
 *        the context.
 * WHERE: ./registry.ts, and generators.test.ts.
 */
export function buildRedditStoryDocument(ctx: GeneratorContext): TimelineDoc {
  const canvas = CANVAS_BY_ASPECT[ctx.aspect];
  const settings = readGeneratorSettings(ctx.settings);
  const paletteId = paletteIdFor(settings);

  /* NARRATION_IS_SEQUENTIAL — one pass, accumulating measured durations. The
   * spans come back with it, because the avatars are built from when each
   * speaker was actually talking. */
  const narration = layNarration(ctx);
  const totalSec = narration.totalSec;

  const background = buildBackgroundTrack({
    background: ctx.background,
    totalSec,
    paletteId,
  });

  const music = buildMusicTrack({
    musicAssetId: settings.generate.musicAssetId,
    totalSec,
  });

  const assets: Record<string, AssetRef> = {
    ...narration.assets,
    ...background.assets,
    ...music.assets,
  };

  /* Bottom-most first — the renderer walks tracks in array order (LAYER_ORDER). */
  const tracks: Track[] = [];
  if (background.track !== null) tracks.push(background.track);
  if (narration.track !== null) tracks.push(narration.track);
  if (music.track !== null) tracks.push(music.track);

  /**
   * ONE_OVERLAY_PER_SPEAKER_RUN. Each window becomes one item, and its
   * artwork handles are declared once per AVATAR rather than once per window —
   * the same character talking four times is one set of three assets, which is
   * what `doc.assets` being a map of handles is for.
   */
  const windows = buildAvatarWindows(narration.spans);
  const avatarItems: OverlayItem[] = [];
  const declared = new Set<string>();

  for (const [index, window] of windows.entries()) {
    const cast = ctx.cast[window.speakerTag];
    /* No avatar for this speaker is normal — a narrator who is never on
     * screen. No overlay, no handle, no gap: the frame simply shows the
     * background and the captions. */
    if (cast === undefined) continue;

    if (!declared.has(cast.avatarId)) {
      declared.add(cast.avatarId);
      for (const state of AVATAR_STATES) {
        assets[avatarHandle(cast.avatarId, state)] = {
          assetId: cast.states[state],
          kind: "image",
          /* Original commissioned artwork the operator holds the rights to —
           * see LIKENESS_IS_ATTESTED. `licensed` understates ownership and
           * never overstates permission, which is the safe direction for a
           * field whose job is refusing a render. */
          license: "licensed",
        };
      }
    }

    avatarItems.push({
      id: `avatar-${index}`,
      start: window.start,
      duration: window.duration,
      render: "characterOverlay",
      /* AVATAR_Z_IS_STABLE — one depth for every avatar, which is safe because
       * the windows provably do not overlap. */
      z: AVATAR_Z,
      box: AVATAR_BOX,
      /* The RESTING frame is the item's own asset, so an overlay still draws
       * something if the props below are ever unreadable
       * (NEUTRAL_IS_THE_FALLBACK). */
      assetId: avatarHandle(cast.avatarId, "neutral"),
      props: {
        avatarId: cast.avatarId,
        speaker: window.speakerTag,
        /* The handle for each state, and the already-settled timeline that
         * says which one is on screen when — WINDOWS_ARE_COMPUTED_NOT_DRAWN.
         * The times are RELATIVE to this item, because that is what
         * `useCurrentFrame()` gives the component
         * (FRAMES_ARE_RELATIVE_INSIDE). */
        handles: {
          neutral: avatarHandle(cast.avatarId, "neutral"),
          talking: avatarHandle(cast.avatarId, "talking"),
          reaction: avatarHandle(cast.avatarId, "reaction"),
        },
        states: window.states.map((span) => ({
          state: span.state,
          start: span.start,
          duration: span.duration,
        })),
      },
      label: `${window.speakerTag} on screen`,
    });
  }

  if (avatarItems.length > 0) {
    tracks.push({
      id: AVATAR_TRACK_ID,
      type: "overlay",
      label: "Characters",
      items: avatarItems,
    });
  }

  /**
   * EMPTY_WORDS_STILL_BUILDS — no words means no caption track, not a failure.
   * Captions go ABOVE the avatars and BELOW the card: a caption obscured by a
   * character is unreadable, and a card covering its own title is absurd.
   */
  if (ctx.words.length > 0 && settings.captions.enabled) {
    const captions = buildCaptionTrack(ctx.words, settings.captions.styleId, {
      maxWords: settings.captions.wordsPerChunk,
      position: settings.captions.position,
    });
    tracks.push(
      /**
       * COLOUR_IS_NEVER_THE_ONLY_SIGNAL. The customer's per-project preference
       * becomes the LANE's setting, which is where the renderer reads it. It is
       * set here rather than inside `buildCaptionTrack` because that function
       * is shared with the single-voice format, where the setting would never
       * do anything — and a parameter nobody passes is a parameter that rots.
       *
       * Spread rather than mutated so the track `buildCaptionTrack` returned is
       * not written through; it is the shared builder's value, not ours.
       */
      settings.captions.speakerColors
        ? { ...captions, speakerColors: true }
        : captions,
    );
  }

  /**
   * CARD_THEN_STORY — last in the array, so it composites on top, and capped
   * by the video's own length so a 3-second video is not entirely its card.
   * Emitted only when there is a video at all: a zero-length item is one
   * `validate()` refuses.
   */
  const thread = ctx.thread;
  if (totalSec > 0 && thread !== null) {
    tracks.push({
      id: CARD_TRACK_ID,
      type: "scene",
      label: "Title card",
      items: [
        {
          id: CARD_ITEM_ID,
          start: 0,
          duration: Math.min(CARD_SECONDS, totalSec),
          render: "redditCard",
          scene: {
            layout: "card",
            elements: [
              {
                id: "post",
                kind: REDDIT_CARD_ELEMENT_KIND,
                /* The title is TEXT on the element rather than a word range,
                 * because it is not a word anybody narrated —
                 * CARD_IS_NOT_A_CAPTION. */
                text: thread.title,
                props: {
                  subreddit: thread.subreddit,
                  author: thread.author,
                  /* PALETTE_IS_BAKED_ONTO_THE_ITEM — the component cannot read
                   * the document's style block. */
                  paletteId,
                },
              },
            ],
          },
        },
      ],
    });
  }

  return {
    version: TIMELINE_DOC_VERSION,
    kind: "reddit-story",
    /* GENERATED_DOC_IS_ANCHORED — the caption items carry word ranges. */
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
 * SOURCE OF TRUTH KEYWORDS: avatarHandle, ASSET_HANDLE_INDIRECTION
 *
 * The document-local handle for one state of one character. Derived from the
 * AVATAR id and the state, not from the asset id, so the same character used by
 * two speakers declares one set of handles — and so re-syncing the catalogue
 * with new artwork keeps every document's references pointing at the same
 * character.
 */
function avatarHandle(avatarId: string, state: string): string {
  return `avatar_${avatarId}_${state}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: redditStoryGenerator, REDDIT_STORY_SKIPS
 *
 * WHAT:  The registry entry for `reddit-story`.
 * WHY:   REDDIT_STORY_SKIPS names the four stages this kind does not run, and
 *        they are the same four a voiceover skips — for mostly the same
 *        reasons, with one worth stating:
 *
 *          `visuals`    — the background is resolved before the build, as it is
 *                         for a voiceover (RESOLVED_BEFORE_THE_GENERATOR).
 *          `storyboard` — and this is the one that looks like it should run. A
 *                         Reddit story IS multi-shot in a sense: a card, then
 *                         several speakers. But the sequence is entirely
 *                         DETERMINED by the script's own speaker order — there
 *                         is nothing to decide, so a storyboard stage would be
 *                         a progress row for an arithmetic step. Phase 14,
 *                         which picks different imagery per block, is where it
 *                         becomes a real decision.
 *          `design`     — the caption style is chosen on the captions screen
 *                         and the card's layout is the component's.
 *          `render`     — a separate paid action from the preview screen, with
 *                         its own hold and its own resolution choice.
 * WHERE: GENERATORS in ./registry.ts.
 */
export const redditStoryGenerator: Generator = {
  kind: "reddit-story",
  skips: ["visuals", "storyboard", "design", "render"],
  build: (ctx) => Promise.resolve(buildRedditStoryDocument(ctx)),
};
