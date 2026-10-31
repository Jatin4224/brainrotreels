/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: timelineDocSchema, TimelineDoc, TIMELINE_DOC_VERSION,
 *   WordToken, Track, TrackItem, VideoItem, SceneItem, AudioItem, CaptionItem,
 *   OverlayItem, TimeValue, WordAnchor, RENDER_KINDS, RenderKind, TRACK_TYPES,
 *   TrackType, CanvasSpec, StyleSpec, Speaker, AssetRef, NormalizedBox,
 *   TimingMode, ASSET_HANDLE_INDIRECTION, TWO_FORMED_TIMING
 *
 * WHAT:  The v4 timeline document — one JSON object that is the entire contract
 *        between generators, the editor, the player and the renderer. Zod
 *        schemas here; the inferred types are the app's only description of a
 *        timeline.
 * WHY:   TWO_FORMED_TIMING is the part that surprises everyone. A generator does
 *        not say "caption at 2.4s", it says "words 0 through 3", because
 *        re-recording a line must move its captions automatically. So every
 *        time field accepts either a number of seconds or a word anchor, and
 *        `timing` on the root says which form the document is CURRENTLY in.
 *        resolveWordAnchors() flips it to 'resolved'; validate() refuses a
 *        'resolved' document that still holds an anchor, because that document
 *        would render items at time zero rather than failing loudly.
 *
 *        ASSET_HANDLE_INDIRECTION is the second surprise, and it is deliberate:
 *        an item's `assetId` is a KEY INTO `doc.assets`, not a database id. The
 *        entry it finds there carries the real `assetId` of the Asset row. Two
 *        levels, because the same background appears on fifteen items and a
 *        swap must be one edit — and because a document must never hold a URL,
 *        which is signed per request and expires.
 *
 *        Types are inferred, never hand-written: the schema is the source of
 *        truth, and a hand-written mirror of it would drift the first time a
 *        format needs a new field.
 * WHERE: Imported by every other file in src/lib/timeline/, by the generators
 *        (Phase 06), the Remotion compositions (Phase 03) and the editor
 *        (Phase 15). Reuses projectKindSchema from src/lib/types/project.
 */

import { z } from "zod";

import { jsonValueSchema } from "@/lib/types/json";
import { projectKindSchema } from "@/lib/types/project";

/**
 * SOURCE OF TRUTH KEYWORDS: TIMELINE_DOC_VERSION
 *
 * WHAT:  The document version this module writes and validates.
 * WHY:   Bumping it without adding a step to MIGRATIONS in migrate.ts makes
 *        every stored document unreadable, which is why that file asserts the
 *        chain reaches exactly this number.
 * WHERE: migrate.ts, the generators, Timeline.docVersion in Prisma.
 */
export const TIMELINE_DOC_VERSION = 4;

/* Identifiers inside the document. Short and opaque — these are handles a
 * generator mints, not user-visible text. */
const idSchema = z.string().trim().min(1).max(120);

/* Seconds, as a float. Negative is meaningless for a start and a duration of
 * zero is an item that cannot be seen, so both are refused in validate() with a
 * field-level error rather than here, where the message would be a raw zod
 * issue the editor cannot attach to a clip. */
const secondsSchema = z.number().finite();

/**
 * SOURCE OF TRUTH KEYWORDS: WordAnchor, wordAnchorSchema, TimeValue,
 *   timeValueSchema, TWO_FORMED_TIMING
 *
 * WHAT:  A point in time expressed against the spoken script instead of the
 *        clock: either the index of a word or the word itself.
 * WHY:   `{ word }` exists for the LLM's benefit — a model writing a document
 *        by hand gets indices wrong constantly but quotes text reliably. It is
 *        resolved to the FIRST matching token, so it is only safe for a unique
 *        word; generators prefer `{ wordIndex }`.
 * WHERE: Accepted anywhere a time appears. Eliminated by resolveWordAnchors().
 */
export const wordAnchorSchema = z.union([
  z.object({ wordIndex: z.number().int().min(0) }).strict(),
  z.object({ word: z.string().min(1) }).strict(),
]);

export type WordAnchor = z.infer<typeof wordAnchorSchema>;

export const timeValueSchema = z.union([secondsSchema, wordAnchorSchema]);

export type TimeValue = z.infer<typeof timeValueSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: TimingMode, timingModeSchema
 *
 * WHAT:  Whether this document still holds word anchors or has been resolved to
 *        absolute seconds.
 * WHY:   Carried ON the document so validate(doc) can enforce the rule with no
 *        second argument and no caller convention to forget. A player handed an
 *        'anchored' document knows to resolve it first.
 * WHERE: Written by generators ('anchored') and by resolveWordAnchors()
 *        ('resolved'); read by validate() and by the renderer.
 */
export const timingModeSchema = z.enum(["anchored", "resolved"]);

export type TimingMode = z.infer<typeof timingModeSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: WordToken, wordTokenSchema
 *
 * WHAT:  One spoken word with its start and end in seconds, as the aligner
 *        produced it.
 * WHY:   `i` duplicates the array index on purpose: the array is what anchors
 *        resolve against, and a document whose `i` has drifted from its
 *        position is corrupt in a way that silently mis-times every caption.
 *        validate() checks the two agree, which turns a subtle sync bug into a
 *        field-level error.
 * WHERE: doc.words. Produced in Phase 08, consumed by caption items.
 */
export const wordTokenSchema = z
  .object({
    i: z.number().int().min(0),
    w: z.string().min(1),
    s: secondsSchema,
    e: secondsSchema,
    speaker: idSchema.optional(),
  })
  .strict();

export type WordToken = z.infer<typeof wordTokenSchema>;

export const canvasSpecSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive().max(120),
  })
  .strict();

export type CanvasSpec = z.infer<typeof canvasSpecSchema>;

export const styleSpecSchema = z
  .object({
    paletteId: idSchema,
    captionStyleId: idSchema,
    /* Which platform's UI chrome to stay clear of. Phase 08 turns this into
     * actual inset pixels; here it is only the choice. */
    safeZone: z.enum(["tiktok", "reels", "shorts", "none"]),
    /**
     * SOURCE OF TRUTH KEYWORDS: motionStyleId, STYLE_BELONGS_IN_THE_DOCUMENT,
     *   APPLYING_A_STYLE_WRITES_THE_PALETTE
     *
     * Which motion style a `motion` document was designed with — Phase 16c.
     *
     * WHY IT IS HERE and not only in `Project.settings`: Phase 04 decides a
     * paid render can be REUSED by hashing the document (`hashDoc`). A style
     * that lived outside the document would mean switching from `Boardroom`
     * to `Launch` produced an identical hash, the cache served the old video,
     * and the customer's restyle silently did nothing. Anything that changes
     * the picture has to be inside the thing that gets hashed.
     *
     * APPLYING_A_STYLE_WRITES_THE_PALETTE: a motion style also NAMES a
     * palette, and applying one copies that into `paletteId` above rather than
     * leaving two sources of colour. So `paletteId` stays the single answer to
     * "what colour is this video" for every format, and this field answers the
     * narrower "which motion style was chosen" — which the renderer needs for
     * radius, stroke, fonts and motion personality.
     *
     * Optional, and an unknown id falls back (UNKNOWN_STYLE_FALLS_BACK), so
     * every document stored before this phase is still valid and there is
     * nothing for a migration step to change — the same argument
     * ADDING_A_KIND_IS_NOT_A_MIGRATION makes about `backdrop`.
     */
    motionStyleId: idSchema.optional(),
  })
  .strict();

export type StyleSpec = z.infer<typeof styleSpecSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: NormalizedBox, normalizedBoxSchema, CANVAS_BOUNDS
 *
 * WHAT:  A rectangle in canvas-relative units, where 1 is the full width or
 *        height.
 * WHY:   Normalized, not pixels, so the same document renders at 1080x1920 and
 *        at a 270-wide editor preview without a second layout pass. The 0..1
 *        range is enforced in validate() (as "inside canvas bounds") rather
 *        than here, so the error can name the item.
 * WHERE: Overlay items and scene elements.
 */
export const normalizedBoxSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite(),
    h: z.number().finite().optional(),
  })
  .strict();

export type NormalizedBox = z.infer<typeof normalizedBoxSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_KINDS, RenderKind, renderKindSchema
 *
 * WHAT:  Which component family draws an item.
 * WHY:   This is the single extension point for a new format: Phase 12 adds a
 *        Reddit card by adding a value here and a component that answers to it,
 *        not by teaching the renderer about Reddit. An unknown value draws
 *        nothing and logs — a bad item must never crash a paid render.
 * WHERE: Scene, video and overlay items. The renderer's switch (Phase 03).
 */
export const RENDER_KINDS = [
  "media",
  "motion",
  "quizCard",
  "redditCard",
  "characterOverlay",
  "text",
  /* ADDING_A_KIND_IS_NOT_A_MIGRATION. Phase 09 added `backdrop` — a styled
   * gradient fill, which is what a `voiceover` project has behind the words
   * until Phase 11's footage library exists. No `docVersion` bump went with
   * it, deliberately: this is a NEW value in an open-ended enum, so every
   * stored document is still valid under the new schema and there is nothing
   * for a migration step to change. A bump with an empty migration would be a
   * claim that documents needed rewriting, which the next reader of
   * migrate.ts would have to disprove. */
  "backdrop",
] as const;

export const renderKindSchema = z.enum(RENDER_KINDS);

export type RenderKind = z.infer<typeof renderKindSchema>;

/* Editor-only label. Excluded from hashDoc() because renaming a track must not
 * invalidate a cached render — see CACHE_IRRELEVANT_FIELDS in hash.ts. */
const labelSchema = z.string().trim().max(200).optional();

/* Every item shares these three. `start` and `duration` are TimeValues, which
 * is what makes the document two-formed. */
const itemBaseShape = {
  id: idSchema,
  start: timeValueSchema,
  duration: timeValueSchema,
  label: labelSchema,
};

export const sceneElementSchema = z
  .object({
    id: idSchema,
    kind: z.string().trim().min(1).max(60),
    text: z.string().optional(),
    assetId: idSchema.optional(),
    box: normalizedBoxSchema.optional(),
    /* Open by design — a scene element's knobs belong to its component family,
     * and freezing them here would mean editing this file for every new
     * animation. Typed as JSON rather than `unknown`, which is banned. */
    props: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

export type SceneElement = z.infer<typeof sceneElementSchema>;

export const sceneSpecSchema = z
  .object({
    layout: z.string().trim().min(1).max(60),
    elements: z.array(sceneElementSchema),
  })
  .strict();

export type SceneSpec = z.infer<typeof sceneSpecSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: VideoItem, videoItemSchema
 *
 * WHAT:  A clip on a video track — the gameplay loop, a stock shot, a recorded
 *        take, a generated still.
 * WHY:   `muted` defaults true and `loop` defaults false. Backgrounds carry
 *        their own audio that nobody wants under a narration, and a loop that
 *        turned itself on would quietly hide a document whose background is
 *        shorter than its script.
 *
 *        PROPS_ARE_THE_COMPONENTS_OWN (Phase 14). `props` is the same open JSON
 *        bag `OverlayItem` and `SceneElement` carry, and it is here because
 *        `MediaClip` already reads one: KEN_BURNS has lived in that component
 *        since Phase 03 with a note saying "a generator can set it today", and
 *        it could not — a `.strict()` video item had nowhere to put it, so the
 *        only way to reach the drift was to draw a still as an OVERLAY, which
 *        would also have made it composite above the captions.
 *
 *        An optional field in an existing object, so every stored document is
 *        still valid under the new schema and there is nothing for a migration
 *        step to change — the same argument ADDING_A_KIND_IS_NOT_A_MIGRATION
 *        makes above about `backdrop`, and the reason no `docVersion` bump goes
 *        with this. It IS hashed, because it changes the picture: `hashDoc`
 *        walks the whole document and only `CACHE_IRRELEVANT_FIELDS` is
 *        dropped, so turning Ken Burns on correctly invalidates a cached
 *        render.
 * WHERE: tracks[type='video'].items.
 */
export const videoItemSchema = z
  .object({
    ...itemBaseShape,
    assetId: idSchema,
    fit: z.enum(["cover", "contain", "fill"]).default("cover"),
    loop: z.boolean().default(false),
    muted: z.boolean().default(true),
    gain: z.number().min(0).max(4).optional(),
    render: z.literal("media").default("media"),
    /* Presentation knobs belonging to the component family that draws this —
     * see PROPS_ARE_THE_COMPONENTS_OWN above. */
    props: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

export type VideoItem = z.infer<typeof videoItemSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: SceneItem, sceneItemSchema
 *
 * WHAT:  A drawn, non-media beat: a motion-graphics scene, a quiz card, a
 *        Reddit card.
 * WHY:   Holds no assetId of its own — its elements do. `render` selects the
 *        component family and `scene` is that family's input.
 * WHERE: tracks[type='scene'].items.
 */
export const sceneItemSchema = z
  .object({
    ...itemBaseShape,
    render: renderKindSchema,
    scene: sceneSpecSchema,
  })
  .strict();

export type SceneItem = z.infer<typeof sceneItemSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: AudioItem, audioItemSchema
 *
 * WHAT:  A narration line, a music bed or an effect.
 * WHY:   `duck` is a request, not a level: the renderer lowers this item while
 *        any narration plays. Encoding the resulting gain curve in the document
 *        would freeze it against a narration that has not been recorded yet.
 * WHERE: tracks[type='audio'].items.
 */
export const audioItemSchema = z
  .object({
    ...itemBaseShape,
    assetId: idSchema,
    speaker: idSchema.optional(),
    gain: z.number().min(0).max(4).default(1),
    duck: z.boolean().default(false),
    loop: z.boolean().default(false),
  })
  .strict();

export type AudioItem = z.infer<typeof audioItemSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: CaptionItem, captionItemSchema, WORD_RANGE_NOT_TEXT
 *
 * WHAT:  One on-screen caption group, addressed as a range of words.
 * WHY:   WORD_RANGE_NOT_TEXT — a caption never stores a copy of its text. The
 *        words live in doc.words with their timings, so restyling, re-grouping
 *        or re-recording cannot desynchronise a caption from the audio. The
 *        editor changes caption text by changing those words, which is what
 *        setCaptionText does in ops.ts.
 *        `start` and `duration` are optional and WRITTEN BY resolveWordAnchors
 *        from the word range — they are a cache of a derived value, which is
 *        why validate() refuses them when they disagree with the range.
 * WHERE: tracks[type='caption'].items.
 */
export const captionItemSchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    startWord: z.number().int().min(0),
    endWord: z.number().int().min(0),
    position: z
      .object({ x: z.number().finite().optional(), y: z.number().finite() })
      .strict()
      .optional(),
    start: timeValueSchema.optional(),
    duration: timeValueSchema.optional(),
  })
  .strict();

export type CaptionItem = z.infer<typeof captionItemSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: OverlayItem, overlayItemSchema
 *
 * WHAT:  Anything floating above the stack — a logo, a subscribe animation, a
 *        character cut-out, a text badge.
 * WHY:   `z` is required rather than defaulted because two overlays sharing a
 *        depth while they are both on screen is undefined output, and
 *        validate() rejects it. Defaulting would make every generated document
 *        collide at zero.
 * WHERE: tracks[type='overlay'].items.
 */
export const overlayItemSchema = z
  .object({
    ...itemBaseShape,
    render: renderKindSchema.default("media"),
    z: z.number().int(),
    box: normalizedBoxSchema,
    assetId: idSchema.optional(),
    text: z.string().optional(),
    props: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

export type OverlayItem = z.infer<typeof overlayItemSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: TRACK_TYPES, TrackType, Track, trackSchema
 *
 * WHAT:  The five lanes, each discriminated by `type` so its items are typed.
 * WHY:   A flat item list with a `type` field was the alternative and it loses
 *        the two things tracks exist for: stacking order between lanes, and a
 *        per-lane setting (`styleId` on captions) that would otherwise be
 *        repeated on every item.
 * WHERE: doc.tracks. Walked by the renderer in array order, bottom-most first.
 */
export const TRACK_TYPES = [
  "video",
  "scene",
  "audio",
  "caption",
  "overlay",
] as const;

export const trackTypeSchema = z.enum(TRACK_TYPES);

export type TrackType = z.infer<typeof trackTypeSchema>;

export const videoTrackSchema = z
  .object({
    id: idSchema,
    type: z.literal("video"),
    label: labelSchema,
    items: z.array(videoItemSchema),
  })
  .strict();

export const sceneTrackSchema = z
  .object({
    id: idSchema,
    type: z.literal("scene"),
    label: labelSchema,
    items: z.array(sceneItemSchema),
  })
  .strict();

export const audioTrackSchema = z
  .object({
    id: idSchema,
    type: z.literal("audio"),
    label: labelSchema,
    items: z.array(audioItemSchema),
  })
  .strict();

export const captionTrackSchema = z
  .object({
    id: idSchema,
    type: z.literal("caption"),
    label: labelSchema,
    /* Overrides doc.style.captionStyleId for this lane only — a second caption
     * track exists so a translation can be styled differently. */
    styleId: idSchema.optional(),
    /**
     * SOURCE OF TRUTH KEYWORDS: speakerColors, COLOUR_IS_NEVER_THE_ONLY_SIGNAL,
     *   ADDING_A_FIELD_IS_NOT_A_MIGRATION
     *
     * Phase 12. Tint each caption in its speaker's colour and show a name tag
     * with it. A PER-LANE setting, which is what this track exists to hold —
     * the schema's own note says a per-lane value is the alternative to
     * repeating it on every item, and sixty caption items carrying the same
     * boolean is exactly that.
     *
     * COLOUR_IS_NEVER_THE_ONLY_SIGNAL: switching this on turns on the NAME TAG
     * too, in the one component that draws both. The phase requires the pairing
     * and the reason is not decoration — roughly one man in twelve cannot
     * reliably tell two tinted captions apart, and colour alone would make the
     * speaker attribution invisible to them.
     *
     * ADDING_A_FIELD_IS_NOT_A_MIGRATION, the same reasoning as Phase 09's
     * `backdrop` render kind: an OPTIONAL field leaves every stored document
     * valid under the new schema, so there is nothing for a migration step to
     * change and no `docVersion` bump went with it. A bump with an empty
     * migration would be a claim that documents needed rewriting.
     *
     * Optional rather than defaulted, matching `styleId` above: a `.default()`
     * makes the field REQUIRED on the inferred output type, which would mean
     * every fixture and every caption-track builder growing a
     * `speakerColors: false` that says nothing. Absent means off, and the one
     * reader coalesces it.
     */
    speakerColors: z.boolean().optional(),
    items: z.array(captionItemSchema),
  })
  .strict();

export const overlayTrackSchema = z
  .object({
    id: idSchema,
    type: z.literal("overlay"),
    label: labelSchema,
    items: z.array(overlayItemSchema),
  })
  .strict();

export const trackSchema = z.discriminatedUnion("type", [
  videoTrackSchema,
  sceneTrackSchema,
  audioTrackSchema,
  captionTrackSchema,
  overlayTrackSchema,
]);

export type Track = z.infer<typeof trackSchema>;

export type VideoTrack = z.infer<typeof videoTrackSchema>;
export type SceneTrack = z.infer<typeof sceneTrackSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type CaptionTrack = z.infer<typeof captionTrackSchema>;
export type OverlayTrack = z.infer<typeof overlayTrackSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: TrackItem, AnyTimedItem
 *
 * WHAT:  The union of everything that can sit on a track.
 * WHY:   Ops address items by id across every lane, so they need one type to
 *        return. Narrowing back to a specific item type is done by the track's
 *        `type`, never by sniffing fields.
 * WHERE: ops.ts, validate.ts, anchors.ts.
 */
export type TrackItem =
  VideoItem | SceneItem | AudioItem | CaptionItem | OverlayItem;

export const speakerSchema = z
  .object({
    voiceId: idSchema.optional(),
    avatarId: idSchema.optional(),
    displayName: z.string().trim().max(120).optional(),
  })
  .strict();

export type Speaker = z.infer<typeof speakerSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: AssetRef, assetRefSchema, ASSET_HANDLE_INDIRECTION
 *
 * WHAT:  One entry in doc.assets — the real Asset row id behind a document's
 *        local handle, plus what it is and whether we may publish it.
 * WHY:   `license` travels WITH the document because a render must be refusable
 *        months later without re-reading a provider's terms, and because the
 *        gameplay-footage licensing question is the product's largest
 *        non-technical risk. `url` is absent on purpose and must stay absent:
 *        URLs are signed per request and a stored one is a leak with an expiry
 *        date.
 * WHERE: doc.assets, keyed by the handle items put in their `assetId`.
 */
export const assetRefSchema = z
  .object({
    assetId: idSchema,
    kind: z.enum(["video", "audio", "image", "font"]),
    license: z.enum(["owned", "licensed", "stock", "generated", "unknown"]),
    durationInSeconds: z.number().positive().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

export type AssetRef = z.infer<typeof assetRefSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: timelineDocSchema, TimelineDoc
 *
 * WHAT:  The whole document.
 * WHY:   `version` is pinned to the literal current version because every read
 *        goes through migrate() first — a parse that accepted v3 would let an
 *        un-migrated document through, and the v3 reader is this same file.
 *        `.strict()` throughout: an unknown field is almost always a generator
 *        writing a name the renderer does not read, and silently dropping it
 *        produces a video that is missing something nobody can explain.
 * WHERE: Parsed by validate(); produced by migrate(), the generators, and the
 *        editor through apply(). Stored in Timeline.doc.
 */
export const timelineDocSchema = z
  .object({
    version: z.literal(TIMELINE_DOC_VERSION),
    kind: projectKindSchema,
    timing: timingModeSchema.default("anchored"),
    canvas: canvasSpecSchema,
    style: styleSpecSchema,
    words: z.array(wordTokenSchema),
    tracks: z.array(trackSchema),
    speakers: z.record(z.string(), speakerSchema),
    assets: z.record(z.string(), assetRefSchema),
  })
  .strict();

export type TimelineDoc = z.infer<typeof timelineDocSchema>;
