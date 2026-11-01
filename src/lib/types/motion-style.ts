/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: motionStyleSchema, MotionStyle, MOTION_PERSONALITIES,
 *   MOTION_PERSONALITY_TIMING, MOTION_RADII, MOTION_RADIUS_SCALE, MOTION_STROKES,
 *   MOTION_STROKE_SCALE, MUSIC_MOODS, motionStyleProposalSchema,
 *   designMotionStyleSchema, MOTION_STYLE_REJECTION_CODES, MotionStyleRejection,
 *   STYLE_TOKENS_ARE_DATA, A_TOKEN_IS_A_CHOICE_NOT_A_NUMBER,
 *   TOKENS_MUST_CHANGE_THE_PICTURE, TWO_FONTS_ONE_FAMILY
 *
 * WHAT:  The vocabulary of a motion style — the seven tokens that decide what
 *        a motion video looks and sounds like, what a MODEL is allowed to
 *        propose, and the reasons a proposal is refused.
 *
 * WHY:   STYLE_TOKENS_ARE_DATA, exactly as the caption styles are
 *        (STYLES_ARE_DATA in ./caption.ts) and the palettes are
 *        (PALETTES_ARE_DATA in src/lib/palettes). A style is a ROW OF CONFIG,
 *        so shipping the seventh one is an object in
 *        src/lib/motion-styles/ rather than a deploy of new component code.
 *        The components read these fields; none of them knows a style's name.
 *
 *        A_TOKEN_IS_A_CHOICE_NOT_A_NUMBER. `radius` is `square | soft | round`
 *        and not a pixel value; `strokeWeight` is `hairline | regular | bold`
 *        and not a float. Two reasons, and the second decides it:
 *
 *          - A raw number is unbounded, so a model proposing `radius: 400`
 *            type-checks and renders a flow-graph node as a circle with the
 *            label outside it. A closed union cannot be out of range.
 *          - The pixel value depends on the canvas and on what it is being
 *            applied to — a node box, a meter track, a callout rule — so the
 *            number belongs where that is known, which is the scale tables
 *            below, not in a style object.
 *
 *        TOKENS_MUST_CHANGE_THE_PICTURE is the rule that keeps this file from
 *        becoming decoration. Every token here is read by something that
 *        draws: `paletteId` by every primitive, `fonts` by `TextBlock`,
 *        `radius` and `strokeWeight` by the graph, meter and callout,
 *        `motionPersonality` by `animation.tsx`, `captionTreatment` by the
 *        Phase 08 caption layer, `musicMood` by the generator's audio lane. A
 *        token nothing reads would be a promise to a customer that the product
 *        does not keep, and `motion-styles.test.ts` asserts each one has a
 *        consumer by exercising it.
 *
 *        TWO_FONTS_ONE_FAMILY, and this is the phase's one unmet requirement
 *        stated in the type rather than hidden. The phase file asks a style to
 *        name two fonts and asks code to prove both are bundled. The proving
 *        is here and it is real: `fonts.display` and `fonts.body` are
 *        `CaptionFontKey`s, the union of faces `public/fonts` actually holds,
 *        so a model naming "Impact" is refused by the schema and a key with no
 *        family mapping is refused by `checkMotionStyle`. But that union has
 *        ONE member today, so both fonts resolve to the same family and the
 *        library cannot be typographically distinct until somebody licenses a
 *        second face. The indirection is what makes that a one-line change
 *        when they do — a woff2, a `FACES` entry in src/remotion/fonts.ts, a
 *        key in CAPTION_FONT_KEYS and its family in
 *        src/lib/captions/fonts.ts. Grep BUNDLED_FONT_ONLY.
 *
 * WHERE: src/lib/motion-styles/ holds the library and the validation;
 *        src/lib/script/motion-style.ts is the model call;
 *        src/remotion/components/motion-scene/ reads the tokens;
 *        `motionStudio.*` in src/trpc/routers/motion.ts.
 */

import { z } from "zod";

import { captionFontSchema } from "./caption";
import type { PlanKey } from "@/lib/config/plans";

/**
 * SOURCE OF TRUTH KEYWORDS: MOTION_PERSONALITIES, MotionPersonality,
 *   MOTION_PERSONALITY_TIMING
 *
 * WHAT:  How the motion itself feels, and the timings each personality means.
 *
 * WHY:   The phase file calls this token "motion personality", and the table
 *        below is what stops that from being a word on a screen. An
 *        explainer about a security incident and one about a new feature want
 *        genuinely different pacing, and the difference is two durations and
 *        an easing — not a different set of animations, which would multiply
 *        the gallery by four and the review burden with it.
 *
 *        The easing is a NAME, implemented once in
 *        src/remotion/components/motion-scene/animation.tsx, for the same
 *        reason the animations are named: a curve is the one thing in a scene
 *        that geometry cannot check, so the set of them has to be small enough
 *        to have been looked at. `overshoot` is the only one that passes 1 and
 *        comes back, which is why `playful` is the only personality that can
 *        look like a mistake — and why it is a deliberate choice rather than a
 *        default.
 * WHERE: MotionStyle.motionPersonality; the animation shell.
 */
export const MOTION_PERSONALITIES = [
  "calm",
  "precise",
  "energetic",
  "playful",
] as const;

export const motionPersonalitySchema = z.enum(MOTION_PERSONALITIES);

export type MotionPersonality = z.infer<typeof motionPersonalitySchema>;

export const MOTION_EASINGS = ["soft", "sharp", "overshoot"] as const;

export type MotionEasing = (typeof MOTION_EASINGS)[number];

export interface MotionPersonalityTiming {
  entranceSeconds: number;
  exitSeconds: number;
  easing: MotionEasing;
  /** Seconds between staggered parts of one element — a list, a chart. */
  staggerSeconds: number;
}

export const MOTION_PERSONALITY_TIMING: Readonly<
  Record<MotionPersonality, MotionPersonalityTiming>
> = {
  calm: {
    entranceSeconds: 0.5,
    exitSeconds: 0.35,
    easing: "soft",
    staggerSeconds: 0.36,
  },
  precise: {
    entranceSeconds: 0.3,
    exitSeconds: 0.2,
    easing: "sharp",
    staggerSeconds: 0.24,
  },
  energetic: {
    entranceSeconds: 0.22,
    exitSeconds: 0.14,
    easing: "sharp",
    staggerSeconds: 0.16,
  },
  playful: {
    entranceSeconds: 0.42,
    exitSeconds: 0.26,
    easing: "overshoot",
    staggerSeconds: 0.28,
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: MOTION_RADII, MOTION_RADIUS_SCALE,
 *   A_TOKEN_IS_A_CHOICE_NOT_A_NUMBER
 *
 * WHAT:  How round a drawn box's corners are, as a fraction of its own height.
 * WHY:   A fraction of the HEIGHT rather than a pixel radius, so a flow-graph
 *        node and a meter track are equally round at 720p and at 4K, and so
 *        `round` means a pill on both regardless of how tall the box is. 0.5
 *        is exactly a pill; anything above it is clamped by the browser, which
 *        is why the scale stops there.
 * WHERE: MotionStyle.radius; the graph nodes, the meter track.
 */
export const MOTION_RADII = ["square", "soft", "round"] as const;

export const motionRadiusSchema = z.enum(MOTION_RADII);

export type MotionRadius = z.infer<typeof motionRadiusSchema>;

export const MOTION_RADIUS_SCALE: Readonly<Record<MotionRadius, number>> = {
  square: 0,
  soft: 0.22,
  round: 0.5,
};

/**
 * SOURCE OF TRUTH KEYWORDS: MOTION_STROKES, MOTION_STROKE_SCALE
 *
 * WHAT:  How heavy a drawn line is, as a multiplier on the engine's base
 *        stroke.
 * WHY:   A MULTIPLIER rather than a width, so one token covers a graph edge, a
 *        node border and a callout rule — three lines whose base widths differ
 *        because they are read at different distances. A style that set an
 *        absolute width would make the callout rule and the graph edge the same
 *        weight, which looks like a bug at either end of the scale.
 * WHERE: MotionStyle.strokeWeight; the graph, the callout rule, the meter.
 */
export const MOTION_STROKES = ["hairline", "regular", "bold"] as const;

export const motionStrokeSchema = z.enum(MOTION_STROKES);

export type MotionStroke = z.infer<typeof motionStrokeSchema>;

export const MOTION_STROKE_SCALE: Readonly<Record<MotionStroke, number>> = {
  hairline: 0.6,
  regular: 1,
  bold: 1.7,
};

/**
 * SOURCE OF TRUTH KEYWORDS: MUSIC_MOODS, MusicMood, MUSIC_LICENCE_IS_NOT_RESOLVED_YET
 *
 * WHAT:  What kind of bed should sit under the narration.
 * WHY:   A MOOD rather than a track id, because the track is Phase 11's job
 *        and its catalogue is **deliberately empty** —
 *        MUSIC_LICENCE_IS_NOT_RESOLVED_YET is an open owner decision, not a
 *        missing feature. A mood is the durable half of the choice: when a
 *        licensed library exists, the generator resolves a mood to a track and
 *        no stored style changes.
 *
 *        `none` is first and is the default, which is the honest setting while
 *        there is nothing to play. A style defaulting to `upbeat` would promise
 *        music that silently never arrives.
 * WHERE: MotionStyle.musicMood; the generator's audio lane in 16d.
 */
export const MUSIC_MOODS = [
  "none",
  "ambient",
  "upbeat",
  "tense",
  "warm",
] as const;

export const musicMoodSchema = z.enum(MUSIC_MOODS);

export type MusicMood = z.infer<typeof musicMoodSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: motionStyleSchema, MotionStyle, TOKENS_MUST_CHANGE_THE_PICTURE
 *
 * WHAT:  A whole motion style: the seven tokens the phase file names, plus an
 *        id, a name and the plan it needs.
 *
 * WHY:   `captionTreatment` is an id from the **Phase 08 caption library**
 *        rather than a new vocabulary of its own. That library already holds
 *        thirty-eight styles, each one measured against the contrast rule by a
 *        test, so a motion style inventing its own caption description would be
 *        a second answer to a solved question — and an unmeasured one. The id
 *        is validated against `isCaptionStyleId`, so a style naming a caption
 *        treatment that does not exist is refused rather than silently
 *        defaulted.
 *
 *        `paletteId` is likewise an id from src/lib/palettes, whose five
 *        entries each pass their own contrast test. That is what lets
 *        `checkMotionStyle` make a real statement about legibility: it has
 *        actual colours to measure.
 *
 *        `minPlan` mirrors `CaptionStyle.minPlan` — the library can hold a
 *        style the free trial cannot reach without a second gating mechanism.
 * WHERE: Every file in src/lib/motion-styles/; the components, through
 *        `MotionPrimitiveProps`.
 */
export const motionStyleSchema = z
  .object({
    id: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(80),
    minPlan: z.string().trim().min(1).max(40),
    /** An id from src/lib/palettes. */
    paletteId: z.string().trim().min(1).max(60),
    fonts: z
      .object({
        display: captionFontSchema,
        body: captionFontSchema,
      })
      .strict(),
    radius: motionRadiusSchema,
    strokeWeight: motionStrokeSchema,
    motionPersonality: motionPersonalitySchema,
    /** An id from the Phase 08 caption style library. */
    captionTreatment: z.string().trim().min(1).max(60),
    musicMood: musicMoodSchema,
  })
  .strict();

export type MotionStyle = z.infer<typeof motionStyleSchema>;

/* The plan union, restated as a runtime check rather than imported as a schema:
 * `PlanKey` comes from the config module and `minPlan` is a string column's
 * worth of value, so the library's own test is what proves every style names a
 * real plan. */
export type MotionStyleMinPlan = PlanKey;

/**
 * SOURCE OF TRUTH KEYWORDS: designMotionStyleSchema, THREE_QUESTIONS
 *
 * WHAT:  The input to "design one for me".
 *
 * WHY:   THREE_QUESTIONS, and the phase file is specific about the number. The
 *        point is not to gather requirements — it is to give a model just
 *        enough to make a defensible choice, and to keep the screen something
 *        somebody will actually finish. A seven-field form produces fewer
 *        styles than a three-field one.
 *
 *        All three are UNTRUSTED TEXT and go in the model's `user` message
 *        wrapped in delimiters, never into the system prompt — see
 *        UNTRUSTED_TEXT_IS_NEVER_SYSTEM in src/lib/adapters/llm/types.ts.
 *        `subject` is the one a customer types freely, so it is also the one
 *        that could carry an injection attempt.
 * WHERE: `motionStudio.designStyle`; the style picker's "design one for me".
 */
export const designMotionStyleSchema = z.object({
  organizationId: z.string().min(1),
  /** What the videos are about. */
  subject: z.string().trim().min(3).max(200),
  /** Who is watching. */
  audience: z.string().trim().min(3).max(200),
  /** How it should feel. */
  feeling: z.string().trim().min(3).max(120),
});

export type DesignMotionStyleValues = z.infer<typeof designMotionStyleSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: motionStyleProposalSchema, MotionStyleProposal,
 *   THE_MODEL_PROPOSES_TOKENS_NOT_VALUES
 *
 * WHAT:  What a model is allowed to return.
 *
 * WHY:   THE_MODEL_PROPOSES_TOKENS_NOT_VALUES, which is the same constraint
 *        THE_MODEL_NEVER_EMITS_COORDINATES puts on a scene, applied to style.
 *        Every field is a closed union or an id from an existing library, so
 *        the model is choosing from a menu rather than inventing CSS. There is
 *        no hex colour here, no font family name and no pixel radius — a model
 *        cannot run a contrast check, and a font family it names is a font
 *        nothing bundles.
 *
 *        It carries `name` and `rationale` and NOT an `id`: the id is minted by
 *        code, because a model-chosen id could collide with a library style and
 *        silently replace it. `rationale` is shown to the customer — the one
 *        output of this call that is prose, and it is why the answer feels like
 *        a design decision rather than a dice roll.
 *
 *        It is still CHECKED after parsing. The schema proves the shape; it
 *        cannot prove the palette's text colour is legible on its own
 *        gradient, that the caption treatment exists, or that the fonts
 *        resolve to a bundled family. That is `checkMotionStyle`, and it is
 *        the phase's "code validates" — grep THE_SCHEMA_IS_NOT_ENOUGH, which
 *        src/lib/types/quiz.ts argues at length for the same reason.
 * WHERE: The schema handed to `LlmAdapter.generate`.
 */
export const motionStyleProposalSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    paletteId: z.string().trim().min(1).max(60),
    fonts: z
      .object({
        display: captionFontSchema,
        body: captionFontSchema,
      })
      .strict(),
    radius: motionRadiusSchema,
    strokeWeight: motionStrokeSchema,
    motionPersonality: motionPersonalitySchema,
    captionTreatment: z.string().trim().min(1).max(60),
    musicMood: musicMoodSchema,
    /** One sentence, shown to the customer. */
    rationale: z.string().trim().min(1).max(300),
  })
  .strict();

export type MotionStyleProposal = z.infer<typeof motionStyleProposalSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: MOTION_STYLE_REJECTION_CODES, MotionStyleRejection,
 *   MotionStyleCheckResult, CODE_VALIDATES_NOT_THE_EYE
 *
 * WHAT:  Every way a style can be wrong that code can prove, and the shape the
 *        answer comes back in.
 *
 * WHY:   CODE_VALIDATES_NOT_THE_EYE is the phase's step 9 verbatim: "the LLM
 *        proposes tokens, and **code validates** contrast ratios and that both
 *        fonts are actually bundled". The second half is the one the phase
 *        bothers to explain, and the explanation is the whole reason this list
 *        exists — "a model-proposed font that is not bundled renders as a
 *        fallback and silently ruins the video". Silently is the operative
 *        word: there is no error, no failed render and no complaint, just a
 *        video in the wrong typeface that somebody paid for.
 *
 *        A LIST rather than a throw, for the same reason `checkQuizSet` returns
 *        one: the model is re-asked once with the refusals named, and a
 *        hand-picked style shows them next to the control that is wrong.
 * WHERE: `checkMotionStyle` in src/lib/motion-styles/validate.ts; the retry in
 *        src/lib/script/motion-style.ts; the style picker.
 */
export const MOTION_STYLE_REJECTION_CODES = [
  /* The palette id is not in src/lib/palettes. */
  "UNKNOWN_PALETTE",
  /* A font key has no family in CAPTION_FONT_FAMILIES — the failure the phase
   * file names explicitly. */
  "FONT_NOT_BUNDLED",
  /* The caption treatment is not in the Phase 08 library. */
  "UNKNOWN_CAPTION_TREATMENT",
  /* The palette's own text colour is not legible on its own gradient, or the
   * caption treatment is not legible over the palette. */
  "CONTRAST_TOO_LOW",
  /* `minPlan` is not a plan this app sells. */
  "UNKNOWN_PLAN",
] as const;

export type MotionStyleRejectionCode =
  (typeof MOTION_STYLE_REJECTION_CODES)[number];

export interface MotionStyleRejection {
  /** The token at fault, e.g. `fonts.body`. */
  path: string;
  code: MotionStyleRejectionCode;
  /** Customer-facing, and specific enough for a model to act on. */
  message: string;
}

export interface MotionStyleCheckResult {
  ok: boolean;
  rejections: MotionStyleRejection[];
}

export function motionStyleRejection(
  path: string,
  code: MotionStyleRejectionCode,
  message: string,
): MotionStyleRejection {
  return { path, code, message };
}

/**
 * SOURCE OF TRUTH KEYWORDS: listMotionStylesSchema, applyMotionStyleSchema
 *
 * The input schemas of the `motionStudio.*` procedures that deal in styles.
 * `organizationId` is on every one of them because the procedure factory reads
 * it to resolve the workspace before any handler runs.
 */
export const listMotionStylesSchema = z.object({
  organizationId: z.string().min(1),
});

export type ListMotionStylesValues = z.infer<typeof listMotionStylesSchema>;
