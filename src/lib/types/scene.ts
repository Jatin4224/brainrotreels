/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: sceneSchema, Scene, SCENE_LAYOUTS, SceneLayout,
 *   SCENE_PRIMITIVES, ScenePrimitive, sceneElementStrictSchema, StrictSceneElement,
 *   SCENE_ANIMATIONS, SCENE_TEXT_ROLES, LAYOUT_SLOTS, SCENE_ERROR_CODES,
 *   SceneError, SceneCheckResult, LayoutContext, Beat, BeatIntent,
 *   THE_MODEL_NEVER_EMITS_COORDINATES, NAMED_LAYOUTS_ONLY, SLOT_ORDER_IS_THE_LAYOUT,
 *   SCENE_LANGUAGE_IS_STRICT
 *
 * WHAT:  The scene language — what a motion-graphics beat is allowed to say
 *        about itself: one named layout, up to six typed elements, each timed
 *        by a word anchor or by scene-relative seconds, with an entrance and
 *        an exit. Plus the vocabulary the layout engine and the deterministic
 *        checks are written in.
 *
 * WHY:   NAMED_LAYOUTS_ONLY and THE_MODEL_NEVER_EMITS_COORDINATES are the
 *        same rule stated from both ends, and the whole phase rests on it. A
 *        model that returns `{x: 0.41, y: 0.77, w: 0.5}` produces the failure
 *        mode that makes most AI layout systems unusable: text crossing text,
 *        a number half off the frame, a diagram under the platform's own
 *        button rail. Every one of those is a geometry mistake, and a language
 *        model is not a layout engine. So the model PICKS A LAYOUT AND FILLS
 *        SLOTS, and `src/lib/scene/layouts.ts` — code, with tests — does the
 *        geometry. There is deliberately no field in this file that accepts a
 *        coordinate. `SceneElement` in the timeline document has an optional
 *        `box`, and a motion element may never set it; the check refuses one
 *        that does rather than trusting it.
 *
 *        SLOT_ORDER_IS_THE_LAYOUT. Elements have no slot NAME, only an array
 *        position, and the layout assigns slot i to element i. Named slots
 *        were the alternative and they are worse on the path that matters: a
 *        model that invents `slot: 'hero-left'` against a layout that has no
 *        such slot produces an element the engine must either drop silently or
 *        refuse, and both are a beat the customer paid for. An array index
 *        cannot be misspelled.
 *
 *        SCENE_LANGUAGE_IS_STRICT, and this is the second half of a pair. The
 *        timeline document's own `sceneSpecSchema` (src/lib/timeline/schema.ts)
 *        is deliberately LOOSE — `layout: string`, `kind: string`, open
 *        `props` — because it carries quiz cards and Reddit cards too, and
 *        freezing the knobs of every component family in the document schema
 *        would mean editing that file for every new animation. This file is
 *        the strict shape for ONE of those families, and the relationship is
 *        exactly the one `src/lib/types/quiz.ts` has with the quiz card: the
 *        document says "some scene", the family's own schema says what a valid
 *        one is. `src/lib/scene/document.ts` is the seam between them.
 *
 *        The sizes, the slot counts and the role table are DATA here for the
 *        same reason the caption styles are (STYLES_ARE_DATA in
 *        src/lib/types/caption.ts): a layout tweak should be a number in a
 *        table that a test measures, not a deploy of new component code.
 *
 * WHERE: `src/lib/scene/` (measure, layouts, check, document) is written
 *        entirely in this vocabulary; the `MotionScene` components in
 *        `src/remotion/components/` read the placed output rather than this;
 *        Phase 16d's designer prompt is generated from SCENE_PRIMITIVES and
 *        LAYOUT_SLOTS so the catalogue the model is shown cannot drift from
 *        the one the checks enforce.
 */

import { z } from "zod";

import type { Palette } from "@/lib/palettes";
import type { CanvasSpec, TimeValue } from "@/lib/timeline";
import type { MotionStyle } from "./motion-style";
import {
  CAPTION_WEIGHTS,
  type CaptionWeight,
  type SafeZone,
} from "./caption";
import type { AspectRatio } from "./project";

/* The document's own id rule, restated rather than imported: timeline/schema.ts
 * keeps `idSchema` private, and an element id has the same job — short, stable,
 * referenced by other elements (a graph edge names a node). */
const sceneIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Ids may use letters, digits, hyphen, underscore");

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_LAYOUTS, SceneLayout, sceneLayoutSchema,
 *   NAMED_LAYOUTS_ONLY
 *
 * WHAT:  Every arrangement a motion beat may use.
 * WHY:   Five, and the list is closed. Each one answers a shape of content a
 *        short explainer actually has — one statement, two things compared,
 *        three things enumerated, one figure with a line under it, one
 *        process. A sixth layout is a deliberate addition here plus a slot
 *        function in src/lib/scene/layouts.ts, which is the point: the set of
 *        possible geometries is reviewable because it is finite.
 * WHERE: Scene.layout; LAYOUT_SLOTS; the designer prompt's catalogue.
 */
export const SCENE_LAYOUTS = [
  "stack-center",
  "split-2",
  "grid-3",
  "hero-plus-caption",
  "flow-graph",
] as const;

export const sceneLayoutSchema = z.enum(SCENE_LAYOUTS);

export type SceneLayout = z.infer<typeof sceneLayoutSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_PRIMITIVES, ScenePrimitive
 *
 * WHAT:  The component families an element may be.
 * WHY:   architecture.md names the weak point of this whole phase: motion
 *        quality depends on the PRIMITIVE LIBRARY, not on the model. Ten
 *        primitives that each look right in every layout and every palette is
 *        a good product; a model picking freely from an unbounded set of
 *        half-finished ones is not. The list is closed so the gallery can
 *        exercise all of it.
 * WHERE: The `kind` discriminant below; src/remotion/components/motion-scene.
 */
export const SCENE_PRIMITIVES = [
  "title",
  "kineticText",
  "counter",
  "meter",
  "barChart",
  "compare",
  "list",
  "flowGraph",
  "icon",
  "callout",
] as const;

export const scenePrimitiveSchema = z.enum(SCENE_PRIMITIVES);

export type ScenePrimitive = z.infer<typeof scenePrimitiveSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_ANIMATIONS, SceneAnimation
 *
 * WHAT:  How an element arrives and how it leaves.
 * WHY:   A closed set rather than a duration-and-easing bag, because an
 *        animation is the one thing in a scene that cannot be checked by
 *        geometry: a check can prove text fits, it cannot prove a custom
 *        easing curve does not look broken. Naming the movements means every
 *        one of them is implemented once, reviewed once in the gallery, and
 *        reachable by the model without it being able to invent a new one.
 *
 *        `none` exists and is not a placeholder: an element that is already on
 *        screen when the beat starts — the background figure a counter sits
 *        on — should not re-enter, and the alternative to saying so is a
 *        zero-duration fade that reads as a flicker.
 * WHERE: StrictSceneElement.entrance / .exit.
 */
export const SCENE_ANIMATIONS = [
  "none",
  "fade",
  "rise",
  "fall",
  "slide-left",
  "slide-right",
  "pop",
  "wipe-up",
] as const;

export const sceneAnimationSchema = z.enum(SCENE_ANIMATIONS);

export type SceneAnimation = z.infer<typeof sceneAnimationSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_ICONS, SceneIcon, BUNDLED_GLYPH_ONLY
 *
 * WHAT:  The glyphs an `icon` element may ask for.
 * WHY:   BUNDLED_GLYPH_ONLY, the same argument BUNDLED_FONT_ONLY makes in
 *        src/remotion/fonts.ts: an icon name the renderer cannot resolve draws
 *        nothing, and a beat whose only element is a missing icon is an empty
 *        frame in a paid video. A closed semantic list — not a pass-through to
 *        an icon pack's thousands of names — is what makes that impossible,
 *        and it keeps the model choosing MEANING (`alert`) rather than
 *        inventory (`triangle-exclamation-solid-02`).
 * WHERE: The `icon` primitive; mapped to real paths in the Icon component.
 */
export const SCENE_ICONS = [
  "check",
  "cross",
  "alert",
  "arrow-up",
  "arrow-down",
  "clock",
  "user",
  "chart",
  "bulb",
  "lock",
  "spark",
  "globe",
] as const;

export const sceneIconSchema = z.enum(SCENE_ICONS);

export type SceneIcon = z.infer<typeof sceneIconSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_TONES, SceneTone
 *
 * A callout's meaning, not its colour. The palette decides what `negative`
 * looks like (src/lib/palettes), so the same scene restyles without the model
 * being asked to pick a hex — which it cannot be, since every colour in a
 * render has to pass the contrast check rather than a reviewer's eye.
 */
export const SCENE_TONES = [
  "neutral",
  "positive",
  "warning",
  "negative",
] as const;

export const sceneToneSchema = z.enum(SCENE_TONES);

export type SceneTone = z.infer<typeof sceneToneSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_TEXT_ROLES, SceneTextRole, SceneTextRoleSpec,
 *   SIZE_IS_A_FRACTION_OF_HEIGHT, AUTO_FIT_HAS_A_FLOOR
 *
 * WHAT:  How big each kind of text is, how small it may shrink, which bundled
 *        weight draws it, and how many lines it may wrap to.
 *
 * WHY:   SIZE_IS_A_FRACTION_OF_HEIGHT — `sizeVh` is a percentage of FRAME
 *        HEIGHT, exactly as `CaptionStyle.sizeVh` is, so one scene renders
 *        proportionally identically at 720p, 1080p and 4K. A pixel size here
 *        would make every beat half as large on the render the customer pays
 *        for as in the editor's proxy.
 *
 *        AUTO_FIT_HAS_A_FLOOR is the design decision this table encodes, and
 *        it is the difference between a layout engine and a shrink-to-fit
 *        hack. Long text is shrunk toward `minSizeVh` to make it fit its slot
 *        — that is what a designer would do — but never past it, because text
 *        at 1.5vh is unreadable on a phone and "it fits" is then a lie the
 *        check would have told. Below the floor the element is an OVERFLOW
 *        ERROR and goes back to the repair loop (Phase 16d), which is the
 *        outcome that produces a readable beat instead of a technically
 *        in-bounds one.
 *
 *        `maxLines` is part of the role rather than the element, so a model
 *        cannot ask for a seven-line headline. Wrapping past it is the same
 *        overflow error: three lines of display text is a title, seven is a
 *        paragraph somebody set in the title style.
 * WHERE: src/lib/scene/measure.ts reads it to size and wrap; layouts.ts
 *        reads it to reserve height; check.ts turns a miss into an error.
 */
export interface SceneTextRoleSpec {
  sizeVh: number;
  minSizeVh: number;
  weight: CaptionWeight;
  maxLines: number;
  /** Multiplied by the font size to get the baseline-to-baseline distance. */
  lineHeight: number;
  /**
   * SOURCE OF TRUTH KEYWORDS: fontSlot, TWO_FONTS_ONE_FAMILY
   *
   * Which of a motion style's two fonts draws this role.
   *
   * WHY: this is what makes "a style names two fonts" mean something. The
   * display slot takes the roles a viewer reads at a glance — a headline, a
   * figure, a callout — and the body slot takes the roles they read as text.
   * Deciding it per ROLE rather than per primitive is why a counter's label and
   * a list item are set in the same face without either component knowing the
   * other exists.
   *
   * Both slots resolve to one family today (see TWO_FONTS_ONE_FAMILY in
   * src/lib/types/motion-style.ts), so this currently changes nothing on
   * screen. It is wired now because retro-fitting it after a second face is
   * licensed would mean revisiting every primitive.
   */
  fontSlot: "display" | "body";
}

export const SCENE_TEXT_ROLES = [
  "display",
  "kinetic",
  "numeral",
  "body",
  "label",
  "callout",
] as const;

export const sceneTextRoleSchema = z.enum(SCENE_TEXT_ROLES);

export type SceneTextRole = z.infer<typeof sceneTextRoleSchema>;

export const SCENE_TEXT_ROLE_SPECS: Readonly<
  Record<SceneTextRole, SceneTextRoleSpec>
> = {
  display: {
    sizeVh: 9,
    minSizeVh: 5,
    weight: 700,
    maxLines: 3,
    lineHeight: 1.1,
    fontSlot: "display",
  },
  kinetic: {
    sizeVh: 8,
    minSizeVh: 5,
    weight: 700,
    maxLines: 2,
    lineHeight: 1.1,
    fontSlot: "display",
  },
  /* A counter is one token and must never wrap: "1,250,000" broken across two
   * lines reads as two numbers. One line, and a tighter floor than the rest,
   * because a long figure in a narrow slot has nowhere else to go. */
  numeral: {
    sizeVh: 14,
    minSizeVh: 6,
    weight: 700,
    maxLines: 1,
    lineHeight: 1,
    fontSlot: "display",
  },
  body: {
    sizeVh: 4.6,
    minSizeVh: 3,
    weight: 400,
    maxLines: 3,
    lineHeight: 1.25,
    fontSlot: "body",
  },
  label: {
    sizeVh: 3.4,
    minSizeVh: 2.4,
    weight: 400,
    maxLines: 2,
    lineHeight: 1.2,
    fontSlot: "body",
  },
  callout: {
    sizeVh: 5.4,
    minSizeVh: 3.6,
    weight: 700,
    maxLines: 3,
    lineHeight: 1.15,
    fontSlot: "display",
  },
};

/* Guards the table against a weight nobody bundled — the same failure
 * BUNDLED_FONT_ONLY exists to stop, reached from the type side. */
const BUNDLED_WEIGHTS: readonly number[] = CAPTION_WEIGHTS;

export function isBundledWeight(weight: number): weight is CaptionWeight {
  return BUNDLED_WEIGHTS.includes(weight);
}

/**
 * SOURCE OF TRUTH KEYWORDS: sceneElementStrictSchema, StrictSceneElement,
 *   TIMED_BY_ANCHOR_OR_SECONDS, SCENE_RELATIVE_SECONDS
 *
 * WHAT:  One element: which primitive, its typed knobs, when it is on screen,
 *        and how it arrives and leaves.
 *
 * WHY:   TIMED_BY_ANCHOR_OR_SECONDS. `in` and `out` are the document's own
 *        `TimeValue` — a number of seconds or a word anchor — reused rather
 *        than reinvented, so `resolveWordAnchors` is still the only code in
 *        the app that turns a word into a time. That matters for the phase's
 *        own requirement that "every number or diagram appears on the word
 *        that introduces it": a counter anchored to `{wordIndex: 41}` lands on
 *        that word after a re-alignment moves it, which a baked-in `2.4` does
 *        not.
 *
 *        SCENE_RELATIVE_SECONDS: a bare number is seconds FROM THE START OF
 *        THE BEAT, not from the start of the video, while a word anchor is
 *        absolute because a word index already is. A scene is designed once
 *        and may be moved along the timeline by the editor (Phase 15) or
 *        re-rendered as a single beat (Phase 16d's "redesign this beat"), and
 *        absolute seconds would make every element wrong the moment the beat
 *        shifted by a frame.
 *
 *        `out` is optional and means "until the beat ends". That is the common
 *        case by a wide margin and spelling it out on every element would be
 *        noise the model has to get right for no benefit.
 *
 *        There is NO coordinate field, by construction — see
 *        THE_MODEL_NEVER_EMITS_COORDINATES in the file header.
 * WHERE: Scene.elements; measured by measure.ts, placed by layouts.ts.
 */
/**
 * SOURCE OF TRUTH KEYWORDS: sceneTimeValueSchema, SceneTimeValue,
 *   ANCHORS_ARE_INDICES_HERE
 *
 * WHAT:  Seconds from the start of the beat, or the index of a word.
 *
 * WHY:   ANCHORS_ARE_INDICES_HERE — a deliberate NARROWING of the document's
 *        `TimeValue`, which also allows `{ word: 'revenue' }`. Two reasons,
 *        and the second is the one that decides it:
 *
 *          - A word STRING is ambiguous in any transcript where the word
 *            occurs twice, and a narration that says "revenue" three times is
 *            not unusual. Resolving to the first occurrence is a silent
 *            decision about which moment the diagram appears on.
 *          - It is not CHECKABLE from here. `checkScene` is pure and is given
 *            a word COUNT, not the transcript, so an index can be verified to
 *            exist and a string cannot. An anchor nothing can check is an
 *            anchor that fails at render time instead of at design time, which
 *            is the trade this whole phase is arranged to avoid.
 *
 *        Nothing is lost: the designer is handed `Beat.startWord` and
 *        `Beat.endWord` as indices in the first place, so indices are what it
 *        already has. The narrowing is structural, so a `SceneTimeValue` is
 *        still a `TimeValue` and `resolveWordAnchors` remains the only code in
 *        the app that turns a word into a time.
 * WHERE: StrictSceneElement.in / .out.
 */
export const sceneTimeValueSchema = z.union([
  z.number().finite().min(0),
  z.object({ wordIndex: z.number().int().min(0) }).strict(),
]);

export type SceneTimeValue = z.infer<typeof sceneTimeValueSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: sceneTimeIsATimeValue, ANCHORS_ARE_INDICES_HERE
 *
 * Proves the narrowing above is a NARROWING and not a divergence: the body is
 * a plain return, so it compiles only while every `SceneTimeValue` is still a
 * valid document `TimeValue`. If someone adds a form here that the document
 * cannot store, this is where it is caught — at compile time, rather than as a
 * scene that passes its own checks and then fails `validate()`.
 */
export function sceneTimeIsATimeValue(value: SceneTimeValue): TimeValue {
  return value;
}

const elementBaseShape = {
  id: sceneIdSchema,
  in: sceneTimeValueSchema.default(0),
  out: sceneTimeValueSchema.optional(),
  entrance: sceneAnimationSchema.default("fade"),
  exit: sceneAnimationSchema.default("fade"),
};

/* One line of text a primitive draws, with the role that sizes it. Primitives
 * carry their text in differently-named fields — `text`, `label`, a bar's
 * `label` — and measurement needs them all in one shape. */
export interface SceneTextRun {
  /** Dotted route into the element, for the error path. */
  path: string;
  text: string;
  role: SceneTextRole;
}

const titleSchema = z
  .object({
    ...elementBaseShape,
    kind: z.literal("title"),
    text: z.string().trim().min(1).max(160),
    subhead: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const kineticTextSchema = z
  .object({
    ...elementBaseShape,
    kind: z.literal("kineticText"),
    text: z.string().trim().min(1).max(160),
    /* Word-by-word is the default because that is what this product's captions
     * do and a beat that animated per letter beside them reads as a different
     * video. */
    unit: z.enum(["word", "line"]).default("word"),
  })
  .strict();

const counterSchema = z
  .object({
    ...elementBaseShape,
    kind: z.literal("counter"),
    to: z.number().finite(),
    from: z.number().finite().default(0),
    prefix: z.string().trim().max(8).optional(),
    suffix: z.string().trim().max(8).optional(),
    decimals: z.number().int().min(0).max(2).default(0),
    /* Thousands separators are a presentation choice the component makes from
     * this flag rather than from the model writing "1,250,000" as a string —
     * a string cannot be counted up to. */
    grouped: z.boolean().default(true),
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const meterSchema = z
  .object({
    ...elementBaseShape,
    kind: z.literal("meter"),
    /* 0..1 rather than a percentage, so the component never has to guess
     * whether `40` means 40% or 4000%. */
    value: z.number().min(0).max(1),
    label: z.string().trim().min(1).max(120).optional(),
    showPercent: z.boolean().default(true),
  })
  .strict();

const barSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    value: z.number().finite().min(0),
  })
  .strict();

const barChartSchema = z
  .object({
    ...elementBaseShape,
    kind: z.literal("barChart"),
    /* Two is the fewest that is a comparison; five is the most that is legible
     * in a vertical frame for two seconds. A sixth bar is a slide, not a beat. */
    bars: z.array(barSchema).min(2).max(5),
    unit: z.string().trim().max(8).optional(),
  })
  .strict();

const compareSideSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    value: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const compareSchema = z
  .object({
    ...elementBaseShape,
    kind: z.literal("compare"),
    left: compareSideSchema,
    right: compareSideSchema,
  })
  .strict();

const listSchema = z
  .object({
    ...elementBaseShape,
    kind: z.literal("list"),
    items: z.array(z.string().trim().min(1).max(90)).min(2).max(5),
    /* Revealing one item per narrated beat is the behaviour; all-at-once is
     * for a list the voice does not walk through. */
    reveal: z.enum(["sequential", "together"]).default("sequential"),
  })
  .strict();

const graphNodeSchema = z
  .object({
    id: sceneIdSchema,
    label: z.string().trim().min(1).max(40),
  })
  .strict();

const graphEdgeSchema = z
  .object({
    from: sceneIdSchema,
    to: sceneIdSchema,
    label: z.string().trim().min(1).max(24).optional(),
  })
  .strict();

const flowGraphSchema = z
  .object({
    ...elementBaseShape,
    kind: z.literal("flowGraph"),
    /* Eight nodes is where a layered layout stops being readable in a 9:16
     * frame; the check still measures every label, so eight SHORT nodes pass
     * and eight long ones do not. */
    nodes: z.array(graphNodeSchema).min(2).max(8),
    edges: z.array(graphEdgeSchema).min(1).max(12),
    direction: z.enum(["down", "right"]).default("down"),
  })
  .strict();

const iconSchema = z
  .object({
    ...elementBaseShape,
    kind: z.literal("icon"),
    icon: sceneIconSchema,
    label: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

const calloutSchema = z
  .object({
    ...elementBaseShape,
    kind: z.literal("callout"),
    text: z.string().trim().min(1).max(200),
    tone: sceneToneSchema.default("neutral"),
  })
  .strict();

export const sceneElementStrictSchema = z.discriminatedUnion("kind", [
  titleSchema,
  kineticTextSchema,
  counterSchema,
  meterSchema,
  barChartSchema,
  compareSchema,
  listSchema,
  flowGraphSchema,
  iconSchema,
  calloutSchema,
]);

export type StrictSceneElement = z.infer<typeof sceneElementStrictSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: sceneSchema, Scene, SIX_ELEMENTS_IS_THE_CEILING
 *
 * WHAT:  A whole beat.
 * WHY:   SIX_ELEMENTS_IS_THE_CEILING, from the phase's own contract, and it is
 *        a legibility rule rather than a performance one: a beat is 1.5 to 6
 *        seconds long, and seven things cannot be read in six seconds. The
 *        per-layout counts in LAYOUT_SLOTS are tighter still; this is the
 *        outer bound that holds whatever a new layout says.
 * WHERE: Parsed at every seam — the designer's output, the document reader,
 *        the gallery's hand-written scenes.
 */
export const sceneSchema = z
  .object({
    layout: sceneLayoutSchema,
    elements: z.array(sceneElementStrictSchema).min(1).max(6),
  })
  .strict();

export type Scene = z.infer<typeof sceneSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: LAYOUT_SLOTS, LayoutSlotRule, SLOT_ORDER_IS_THE_LAYOUT
 *
 * WHAT:  How many elements each layout arranges, and which primitive it
 *        requires.
 * WHY:   A layout is a promise about geometry, and the promise only holds for
 *        a known number of things: `split-2` with three elements has no third
 *        side to put one on, and the honest answers are to refuse or to invent
 *        a geometry the layout was never reviewed in. It refuses, and the
 *        repair loop gets a specific error naming the count — which is a thing
 *        a model fixes on the first retry.
 *
 *        `requires` exists for `flow-graph` alone: that layout's whole job is
 *        to hand a laid-out graph to Dagre, and a flow-graph beat with no
 *        graph in it is a blank frame with a heading.
 * WHERE: checkScene's slot rule; layouts.ts; the designer prompt.
 */
export interface LayoutSlotRule {
  min: number;
  max: number;
  requires?: ScenePrimitive;
}

export const LAYOUT_SLOTS: Readonly<Record<SceneLayout, LayoutSlotRule>> = {
  "stack-center": { min: 1, max: 4 },
  "split-2": { min: 2, max: 2 },
  "grid-3": { min: 3, max: 3 },
  "hero-plus-caption": { min: 2, max: 2 },
  /* One graph, optionally under one heading — so two, not one. The heading is
   * the only non-graph element the layout places. */
  "flow-graph": { min: 1, max: 2, requires: "flowGraph" },
};

/**
 * SOURCE OF TRUTH KEYWORDS: LayoutContext, SAFE_ZONE_IS_SHARED
 *
 * WHAT:  Everything the geometry depends on that is not in the scene.
 * WHY:   SAFE_ZONE_IS_SHARED — `safeZone` is the document's own
 *        `style.safeZone` and it is turned into pixels by
 *        src/lib/captions/safe-zone.ts, the module Phase 08 already wrote.
 *        The phase file says to share it rather than reimplement it, and the
 *        reason is concrete: two implementations of "where TikTok's button
 *        rail is" means a caption and a motion element that disagree about the
 *        bottom of the frame, in the same video.
 *
 *        `wordCount` is here so an anchor can be checked without handing the
 *        whole document to the layout engine — the engine stays pure and knows
 *        nothing about `doc.words`.
 * WHERE: Every function in src/lib/scene/.
 */
export interface LayoutContext {
  /* The document's own CanvasSpec rather than a width/height pair, so the
   * shared safe-zone function can be called with it unchanged — see
   * SAFE_ZONE_IS_SHARED. */
  canvas: CanvasSpec;
  safeZone: SafeZone;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SceneCheckContext, CHECKING_NEEDS_MORE_THAN_LAYOUT
 *
 * WHAT:  What the deterministic checks need on top of the geometry.
 *
 * WHY:   CHECKING_NEEDS_MORE_THAN_LAYOUT, and the split is not tidiness. The
 *        Remotion component lays a scene out on every frame and genuinely does
 *        NOT know the word count — the walker hands a component its item, the
 *        canvas and the document's style, not the transcript. With one
 *        combined context it would have had to invent a `wordCount: 0`, which
 *        is a false statement in a type, and the next reader would not know
 *        whether the layout depended on it.
 *
 *        So the layout takes only what the layout uses. `wordCount` and
 *        `durationSeconds` exist for the anchor and timing checks, which run
 *        where the document IS in hand — the designer, the editor, the tests.
 * WHERE: checkScene; never the renderer.
 */
export interface SceneCheckContext extends LayoutContext {
  /** How many word tokens the document has; 0 for a silent motion piece. */
  wordCount: number;
  /** The beat's own length in seconds, for the timing checks. */
  durationSeconds: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: PlacedRect, PlacedElement, PlacedScene,
 *   GEOMETRY_IS_PIXELS
 *
 * WHAT:  What the layout engine returns: one rectangle per element, in canvas
 *        pixels, plus the font size each text run was fitted at.
 * WHY:   GEOMETRY_IS_PIXELS, and this is the one place in the app that is not
 *        normalized. The document stores normalized boxes so it renders at any
 *        resolution (NormalizedBox in timeline/schema.ts) — but measurement is
 *        in pixels, because a font size is in pixels and an advance width is a
 *        fraction of one. Converting to normalized units in the middle of the
 *        overflow check would round, and a rounded overflow check is one that
 *        passes a beat that is two pixels off the frame.
 *
 *        The renderer converts back to percentages at draw time, from the SAME
 *        canvas the check used, which is what keeps the preview and the paid
 *        render identical.
 * WHERE: Returned by layoutScene; consumed by checkScene and by the
 *        MotionScene components.
 */
export interface PlacedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedTextRun extends SceneTextRun {
  /** The size it actually fitted at, after auto-fit. Never below the floor. */
  fontPx: number;
  /** The wrapped lines, as they will be drawn. */
  lines: string[];
  /** Width of the widest line, in pixels. */
  widthPx: number;
  /** Total height of the wrapped block, in pixels. */
  heightPx: number;
  /** The box the layout reserved for this run. */
  box: PlacedRect;
  /**
   * SOURCE OF TRUTH KEYWORDS: drawnRect, OVERLAP_IS_CHECKED_ON_INK
   *
   * Where the wrapped block actually lands — the measured block, centred in
   * `box`. This is what the overlap and safe-zone checks measure, NOT `box`,
   * and the distinction is the only reason either check can ever fail: slots
   * are laid out not to touch, so comparing slots would be comparing
   * rectangles that are disjoint by construction and the check would be
   * theatre. A run that could not be shrunk to fit (`overflow`) is drawn
   * larger than its box, and THAT is what crosses into the next element or
   * off the frame. Grep OVERLAP_IS_CHECKED_ON_INK.
   */
  drawnRect: PlacedRect;
  /** True when the run could not be made to fit at `minSizeVh`. */
  overflow: boolean;
}

export interface PlacedElement {
  id: string;
  kind: ScenePrimitive;
  /** The slot the layout gave it. */
  rect: PlacedRect;
  /** Every text run this element draws, fitted and wrapped. */
  runs: PlacedTextRun[];
  /** Nodes and edges in pixels, for `flowGraph` only. */
  graph?: PlacedGraph;
}

export interface PlacedGraphNode {
  id: string;
  label: string;
  rect: PlacedRect;
}

export interface PlacedGraphEdge {
  from: string;
  to: string;
  /** Polyline through the laid-out route, in canvas pixels. */
  points: { x: number; y: number }[];
}

export interface PlacedGraph {
  nodes: PlacedGraphNode[];
  edges: PlacedGraphEdge[];
}

export interface PlacedScene {
  layout: SceneLayout;
  /** The safe rectangle every slot was placed inside. */
  safeRect: PlacedRect;
  elements: PlacedElement[];
}

/**
 * SOURCE OF TRUTH KEYWORDS: MotionPrimitiveProps, DRAWN_IS_MEASURED,
 *   MOTION_PRIMITIVE_CONTRACT
 *
 * WHAT:  What every motion primitive component receives.
 *
 * WHY:   MOTION_PRIMITIVE_CONTRACT — one shape for all ten, so the
 *         `MotionScene` family dispatches on `element.kind` through a map and
 *         nobody edits the family to add a primitive. The same argument
 *         RENDER_COMPONENT_CONTRACT makes one level up, which is why `element`
 *         is the whole union and each component narrows it: a component knows
 *         its own kind, a generic dispatcher cannot know which narrowing to
 *         apply.
 *
 *         DRAWN_IS_MEASURED is the reason `placed` is here at all. A primitive
 *         does NOT lay itself out: it is handed the rectangles and the fitted
 *         font sizes the layout engine already computed and measured, and it
 *         draws exactly those. Any primitive that computed its own size would
 *         make the overflow check a statement about a picture that does not
 *         exist — which is the single failure this phase's checks are built to
 *         make impossible.
 *
 *         `palette` is the resolved palette rather than its id, so one lookup
 *         happens in the family and not ten times in its children.
 * WHERE: Implemented by every component under
 *        src/remotion/components/motion-scene/.
 */
export interface MotionPrimitiveProps {
  /** The element as designed. Narrow it on `kind`. */
  element: StrictSceneElement;
  /** Its slot, its graph and its fitted text runs — see DRAWN_IS_MEASURED. */
  placed: PlacedElement;
  /**
   * SOURCE OF TRUTH KEYWORDS: TOKENS_MUST_CHANGE_THE_PICTURE
   *
   * The motion style — Phase 16c. Carried alongside the resolved `palette`
   * rather than instead of it, because a primitive needs the colours on every
   * line it draws and resolving `style.paletteId` ten times per frame to get
   * them would be the lookup this prop exists to avoid. The gallery also
   * previews a style against a palette it does not own, which only works if
   * the two are separable.
   */
  style: MotionStyle;
  palette: Palette;
  canvas: CanvasSpec;
  /** When this element is on screen, in seconds from the start of the beat. */
  window: { from: number; to: number };
  /**
   * SOURCE OF TRUTH KEYWORDS: TIME_IS_A_PROP, PREVIEW_IS_THE_RENDER
   *
   * The moment being drawn, in seconds from the start of the beat.
   *
   * WHY: a PROP rather than `useCurrentFrame()`, which is the pattern
   * src/components/global/caption-preview already established — and the reason
   * is that the gallery has to mount these components, not approximations of
   * them. A primitive that read the frame itself would only work inside a
   * Remotion context, so a gallery of forty cards would need forty Players;
   * with time as a prop the gallery drives the SAME components from one
   * `requestAnimationFrame` loop. One component, two drivers, no second
   * implementation to drift (PREVIEW_IS_THE_RENDER).
   *
   * It also keeps every drawing component free of the `remotion` package,
   * which matters for the same reason CAPTIONS_STAY_PURE does: that package's
   * module body expects a Remotion bundle.
   */
  seconds: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_ERROR_CODES, SceneErrorCode, SceneError,
 *   SceneCheckResult, DETERMINISTIC_CHECKS_FIRST
 *
 * WHAT:  Every way a scene can be wrong without a model looking at it, and the
 *        shape the answer comes back in.
 *
 * WHY:   DETERMINISTIC_CHECKS_FIRST, the phase's step 12 and the reason this
 *        list is long. Each code here is a defect geometry can PROVE, which
 *        makes it free to check and precise to report; the vision pass that
 *        follows costs a still render and an API call per beat and can only
 *        offer an opinion. Catching an overflow with a measured advance width
 *        rather than with a vision model is the difference between a cent and
 *        a dollar per beat, and the deterministic answer is also the one the
 *        repair loop can act on — "element `s2-stat` overflows its slot by
 *        140px at the minimum size" is fixable, "looks cluttered" is not.
 *
 *        Errors are a LIST and the result carries them all, rather than
 *        throwing on the first: Phase 16d sends every error for one beat back
 *        to the model in a single repair attempt, and a bounded two attempts
 *        cannot afford to surface one problem at a time.
 *
 *        `path` is the dotted route into the SCENE — `elements.2.text` — which
 *        mirrors ValidationError in src/lib/timeline/errors.ts so a reader of
 *        either is reading the same thing.
 * WHERE: Returned by checkScene; rendered by the beat strip; fed to the repair
 *        prompt.
 */
export const SCENE_ERROR_CODES = [
  /* The layout cannot arrange this many elements, or is missing the primitive
   * it exists to lay out. */
  "SLOT_COUNT",
  "LAYOUT_REQUIRES_PRIMITIVE",
  /* Measured text does not fit its slot even at the role's floor. */
  "TEXT_OVERFLOW",
  /* Two placed rectangles intersect. */
  "ELEMENT_OVERLAP",
  /* A placed rectangle leaves the platform's safe rectangle. */
  "OUTSIDE_SAFE_ZONE",
  /* A word anchor names a token the document does not have. */
  "UNKNOWN_WORD_ANCHOR",
  /* `out` is at or before `in`, or `in` is past the end of the beat. */
  "TIMING_INVERTED",
  "TIMING_OUT_OF_BEAT",
  /* Two elements, or two graph nodes, share an id. */
  "DUPLICATE_ID",
  /* A graph edge names a node that is not in `nodes`. */
  "GRAPH_EDGE_UNKNOWN_NODE",
  /* The scene did not parse against sceneSchema at all. */
  "SCHEMA",
] as const;

export type SceneErrorCode = (typeof SCENE_ERROR_CODES)[number];

export interface SceneError {
  path: string;
  code: SceneErrorCode;
  message: string;
}

export interface SceneCheckResult {
  ok: boolean;
  errors: SceneError[];
  /** The geometry the checks were run against; absent when parsing failed. */
  placed?: PlacedScene;
}

export function sceneError(
  path: string,
  code: SceneErrorCode,
  message: string,
): SceneError {
  return { path, code, message };
}

/**
 * SOURCE OF TRUTH KEYWORDS: BEAT_INTENTS, BeatIntent, Beat, beatSchema,
 *   INTENT_PICKS_THE_PRIMITIVE
 *
 * WHAT:  One slice of the narration, and what it is for.
 *
 * WHY:   INTENT_PICKS_THE_PRIMITIVE. The storyboard step (Phase 16d) decides
 *        WHERE the beats are and WHAT EACH IS ABOUT, and only then does a
 *        second, per-beat call design the scene. Splitting it that way is what
 *        makes "redesign this beat" possible at all: the intent and the word
 *        range stay fixed, one scene is regenerated, and every other beat is
 *        byte-identical because nothing re-ran. A single call that returned
 *        all the scenes at once would make a one-beat edit a whole-video
 *        regeneration.
 *
 *        The range is WORD INDICES rather than seconds, for the reason
 *        TIMED_BY_ANCHOR_OR_SECONDS gives above: a re-alignment moves the
 *        seconds and must not move the design.
 *
 *        `emphasis` is the fallback intent, and it is in the list rather than
 *        special-cased because the bounded repair loop ends there: a beat that
 *        could not be designed twice becomes a plain emphasis beat and the
 *        pipeline finishes. Grep THE_PIPELINE_ALWAYS_FINISHES.
 * WHERE: Phase 16d's storyboard and beat-design steps; the beat strip.
 */
export const BEAT_INTENTS = [
  "title",
  "stat",
  "meter",
  "flow",
  "compare",
  "list",
  "emphasis",
] as const;

export const beatIntentSchema = z.enum(BEAT_INTENTS);

export type BeatIntent = z.infer<typeof beatIntentSchema>;

export const beatSchema = z
  .object({
    index: z.number().int().min(0),
    startWord: z.number().int().min(0),
    endWord: z.number().int().min(0),
    intent: beatIntentSchema,
  })
  .strict();

export type Beat = z.infer<typeof beatSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: beatIntentPlanSchema, BeatIntentPlan,
 *   ONE_CALL_FOR_THE_WHOLE_VIDEO, A_SPARSE_ANSWER_IS_VALID,
 *   INTENT_PICKS_THE_PRIMITIVE
 *
 * WHAT:  What a model returns when asked what each beat of a video is ABOUT —
 *        a list of (beat index, intent) pairs.
 *
 * WHY:   ONE_CALL_FOR_THE_WHOLE_VIDEO. Choosing a beat's intent needs to see
 *        the OTHER beats: "the second of three numbers" is a `stat`, and
 *        "and here is the list of all of them" is a `list` precisely because
 *        of what came before it. A per-beat call would both cost a request per
 *        beat and answer worse, because each one would be deciding blind. So
 *        the answer is a list and the request is one.
 *
 *        A_SPARSE_ANSWER_IS_VALID: a list, not a full array, and nothing here
 *        requires it to mention every beat. A model that labels eleven of
 *        twelve leaves the twelfth at its default rather than failing the
 *        video — the same bias toward finishing the repair loop has, and the
 *        reason `assignIntents` takes a map. A duplicate index is harmless
 *        for the same reason: the last one wins and no beat is lost.
 * WHERE: Returned by `labelBeatIntents` in src/lib/script/motion-intents.ts,
 *        applied by `assignIntents` in src/lib/scene/storyboard.ts.
 */
export const beatIntentPlanSchema = z
  .object({
    beats: z
      .array(
        z
          .object({
            index: z.number().int().min(0),
            intent: beatIntentSchema,
          })
          .strict(),
      )
      .max(400),
  })
  .strict();

export type BeatIntentPlan = z.infer<typeof beatIntentPlanSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: toBeatIntent, INTENT_HAS_A_FREE_DEFAULT,
 *   A_STORED_INTENT_IS_NARROWED_NOT_CAST
 *
 * WHAT:  An intent from a value that came out of a jsonb column or across a
 *        workflow step boundary.
 *
 * WHY:   A_STORED_INTENT_IS_NARROWED_NOT_CAST. Both of those boundaries lose
 *        the union: `Project.settings` holds a string, and an Inngest step's
 *        return value is JSON by the time the next line reads it. The wrong
 *        answers are a cast (CLAUDE.md rule 4) and a throw — a settings blob
 *        written by a NEWER release can legitimately carry an intent this
 *        build has never heard of, and refusing to read it would make a
 *        rollback drop every beat rather than one label.
 *
 *        So it falls back to `emphasis`, which is the default the storyboard
 *        hands out anyway (INTENT_HAS_A_FREE_DEFAULT) and the one intent every
 *        primitive can serve. The cost of being wrong is a beat designed a
 *        little plainer than it could have been.
 * WHERE: The design stage, the beat strip's reader, and the motion generator.
 */
export function toBeatIntent(value: unknown): BeatIntent {
  const parsed = beatIntentSchema.safeParse(value);
  return parsed.success ? parsed.data : "emphasis";
}

/**
 * SOURCE OF TRUTH KEYWORDS: redesignBeatSchema, RedesignBeatValues,
 *   ONE_BEAT_IS_THE_UNIT, THE_RANGE_IS_NOT_AN_INPUT,
 *   ORGANIZATION_ID_IS_ON_EVERY_INPUT
 *
 * WHAT:  Redesign exactly one beat of a motion project.
 *
 * WHY:   THE_RANGE_IS_NOT_AN_INPUT, and this is the whole security and
 *        correctness argument of the procedure. The only thing a customer may
 *        name is WHICH beat — the word range, the intent and the style all come
 *        from what is already stored. A field for `startWord` would let a
 *        caller point a beat at words it never covered, which is both a
 *        storyboard with a gap in it (narration over a stale graphic) and the
 *        one way to make the stored design disagree with the beats the
 *        generator lays out. There is deliberately no field for a scene
 *        either: the model writes scenes, and a client that could post one
 *        would bypass `checkScene` entirely.
 *
 *        The two inputs are ONE schema extended rather than two, because the
 *        read and the write address the same thing: a client that can see a
 *        beat strip can name a beat in it, and a drift between the two shapes
 *        would be a screen reading one project and redesigning another.
 *
 *        `beatIndex` is the key rather than an array position, matching
 *        `assignIntents` and the stored `index` — positions shift, indices do
 *        not.
 *
 *        ORGANIZATION_ID_IS_ON_EVERY_INPUT because the procedure factory reads
 *        the tenant from the input to establish the boundary before any gate
 *        runs; a procedure whose input omits it is refused with a BAD_REQUEST
 *        at runtime.
 * WHERE: `motionStudio.redesignBeat`; the beat strip's redesign button.
 */
export const motionDesignSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});

export type MotionDesignValues = z.infer<typeof motionDesignSchema>;

export const redesignBeatSchema = motionDesignSchema.extend({
  beatIndex: z.number().int().min(0),
});

export type RedesignBeatValues = z.infer<typeof redesignBeatSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_DESIGN_SOURCES, SceneDesignSource,
 *   sceneDesignSourceSchema, A_FALLBACK_IS_RECORDED
 *
 * WHAT:  How a stored scene came to exist — first try, repaired after a
 *        refusal, or the measured fallback.
 *
 * WHY:   A_FALLBACK_IS_RECORDED. The beat strip has to show this: a customer
 *        looking at a plain beat should be able to see that it IS the fallback
 *        and press redesign, rather than assume that is what the model thought
 *        best. `repaired` is kept distinct from `designed` for the operator's
 *        question instead — when motion quality drops, how often the repair
 *        loop is firing is the first number worth having.
 *
 *        Named here rather than written inline at each of its three users
 *        (`DesignedBeat`, `StoredMotionBeat`, the beat strip's view) because
 *        it crosses a jsonb column, and a fourth copy is how one of them ends
 *        up accepting a value the others do not.
 * WHERE: src/lib/script/motion-beat.ts, src/services/motion.service.ts, the
 *        beat strip.
 */
export const SCENE_DESIGN_SOURCES = [
  "designed",
  "repaired",
  "fallback",
] as const;

export const sceneDesignSourceSchema = z.enum(SCENE_DESIGN_SOURCES);

export type SceneDesignSource = z.infer<typeof sceneDesignSourceSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_REVIEW_VERDICTS, SceneReviewVerdict,
 *   sceneReviewSchema, SceneReview, beatReviewPlanSchema, BeatReviewPlan,
 *   VISION_CATCHES_WHAT_GEOMETRY_CANNOT, THE_VERDICT_IS_A_CLOSED_SET
 *
 * WHAT:  What a vision model is allowed to say about a rendered beat, and the
 *        shape of its answer for a handful of them.
 *
 * WHY:   VISION_CATCHES_WHAT_GEOMETRY_CANNOT, which is the phase's step 12
 *        read carefully. The deterministic checks already prove every number
 *        that can be measured: the text fits, nothing overlaps, everything is
 *        inside the safe zone, the element count is in range. What they cannot
 *        see is whether the frame is a MESS, whether the words on it are the
 *        point of the sentence, or whether a glyph the metrics table does not
 *        know about has pushed a line off the edge. Those three are exactly
 *        the three verdicts here, and there is no fourth, because a verdict
 *        that duplicated a deterministic check would be a paid request
 *        answering a question a millisecond of arithmetic already answered.
 *
 *        THE_VERDICT_IS_A_CLOSED_SET rather than free text. A reviewer — human
 *        or model — handed "describe any problems" writes a paragraph about a
 *        frame that is fine, and a pile of those is indistinguishable from no
 *        review at all. A closed union makes "ok" the cheapest thing to say
 *        and makes a complaint countable, which is what lets the beat strip
 *        show a badge and an operator watch a rate.
 *
 *        `note` is short and REQUIRED even for `ok`, because a verdict with
 *        no reason attached cannot be argued with — and the first thing
 *        anybody does with a vision finding is argue with it.
 * WHERE: src/lib/script/motion-review.ts; stored per beat by the motion
 *        service; shown by the beat strip.
 */
export const SCENE_REVIEW_VERDICTS = [
  "ok",
  /* Too much on screen to read in the time the beat runs. */
  "clutter",
  /* Text running out of the frame, or too small to read at a phone's size. */
  "cutoff",
  /* A correct, tidy graphic about something other than what is being said. */
  "offtopic",
] as const;

export const sceneReviewVerdictSchema = z.enum(SCENE_REVIEW_VERDICTS);

export type SceneReviewVerdict = z.infer<typeof sceneReviewVerdictSchema>;

export const sceneReviewSchema = z
  .object({
    verdict: sceneReviewVerdictSchema,
    /* One sentence. Long enough to be specific, short enough to fit on a card
     * and to make a paragraph impossible. */
    note: z.string().trim().min(1).max(240),
  })
  .strict();

export type SceneReview = z.infer<typeof sceneReviewSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: beatReviewPlanSchema, BeatReviewPlan,
 *   A_SPARSE_ANSWER_IS_VALID
 *
 * The answer for the sampled beats, keyed by beat index — the same sparse
 * shape, and for the same reason, as `beatIntentPlanSchema`: a model that
 * reports on two of the three stills has still told us something worth
 * storing.
 */
export const beatReviewPlanSchema = z
  .object({
    beats: z
      .array(
        z
          .object({
            index: z.number().int().min(0),
            verdict: sceneReviewVerdictSchema,
            note: z.string().trim().min(1).max(240),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

export type BeatReviewPlan = z.infer<typeof beatReviewPlanSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: MotionBeatView, MotionDesignView,
 *   THE_STRIP_READS_A_VIEW_NOT_THE_BLOB, A_RESOLVED_STYLE_NOT_AN_ID
 *
 * WHAT:  One beat as the beat strip shows it, and the whole design around it.
 *
 * WHY:   THE_STRIP_READS_A_VIEW_NOT_THE_BLOB. The screen gets the beat's TEXT
 *        and its SECONDS, neither of which is stored: the words live in the
 *        alignment and the beat holds indices into them
 *        (TIMED_BY_ANCHOR_OR_SECONDS). Resolving both server-side is what
 *        keeps the client from having to download a whole transcript to label
 *        twelve cards, and it means a re-alignment moves the strip with the
 *        audio for free.
 *
 *        A_RESOLVED_STYLE_NOT_AN_ID, the same lesson `MotionPreview` records:
 *        the view carries the STYLE, not its id, so the preview cannot
 *        silently draw the default's tokens under another style's name.
 *
 *        `scene` is nullable because the design stage stores the storyboard
 *        BEFORE it designs anything — a strip opened while the stage is
 *        running shows every beat, its intent and its words, with the pictures
 *        filling in. That is the only state a customer can watch, so it has to
 *        be representable.
 * WHERE: Returned by `motionStudio.design`; consumed by the beat strip.
 */
export interface MotionBeatView {
  index: number;
  intent: BeatIntent;
  /** The words this beat covers, joined — what the graphic is about. */
  text: string;
  startSeconds: number;
  durationSeconds: number;
  /** Null until the design stage reaches this beat. */
  scene: Scene | null;
  source: SceneDesignSource | null;
  /**
   * What the vision pass thought of this beat, when it looked at it. Null
   * covers both "not reviewed" cases and they are deliberately not
   * distinguished: only a sample of beats is ever reviewed
   * (SAMPLED_NOT_EXHAUSTIVE), and a deployment with no renderer configured
   * reviews none. Neither is a problem with the beat, so neither earns a badge.
   */
  review: SceneReview | null;
}

export interface MotionDesignView {
  /** Resolved, not an id — see A_RESOLVED_STYLE_NOT_AN_ID. */
  style: MotionStyle;
  aspect: AspectRatio;
  safeZone: SafeZone;
  beats: MotionBeatView[];
}

/**
 * SOURCE OF TRUTH KEYWORDS: GalleryScene, GALLERY_IS_THE_REVIEW_SURFACE
 *
 * WHAT:  One hand-written scene in the review gallery, with what it is there
 *        to show.
 *
 * WHY:   GALLERY_IS_THE_REVIEW_SURFACE. architecture.md names the weak point
 *        of this phase — motion quality depends on the PRIMITIVE LIBRARY, not
 *        on the model — so the primitives are reviewed on their own merits,
 *        by a human, while there is still nothing else to blame. `note` is
 *        part of the type because a gallery card without a statement of what
 *        it is testing is a picture somebody nods at.
 *
 *        `durationSeconds` is per scene rather than a constant: a kinetic line
 *        needs longer than a title to be judged, and reviewing every primitive
 *        at the same length would hide the ones that are too slow for a short
 *        beat.
 * WHERE: src/lib/scene/gallery.ts holds the set; the motion gallery route
 *        renders it; scene.test.ts asserts all of it checks clean.
 */
export interface GalleryScene {
  id: string;
  title: string;
  /** What this card exists to show a reviewer. */
  note: string;
  durationSeconds: number;
  scene: Scene;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_BEAT_SECONDS, BEAT_LENGTH_IS_A_RANGE
 *
 * The phase's 1.5–6 seconds, as a constant the storyboard validator and the
 * gallery both read. Below 1.5s a beat is a flash nobody reads; above 6s a
 * static scene stops being motion graphics and starts being a slide.
 */
export const SCENE_BEAT_SECONDS = { min: 1.5, max: 6 } as const;

/**
 * SOURCE OF TRUTH KEYWORDS: TimeValue re-export
 *
 * Re-exported so src/lib/scene/ has one import for the whole vocabulary and
 * does not reach into the timeline barrel for one type. The definition stays
 * in src/lib/timeline/schema.ts, which owns it.
 */
export type { TimeValue };
