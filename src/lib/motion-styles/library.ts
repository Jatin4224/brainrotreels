/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MOTION_STYLE_LIBRARY, STYLE_TOKENS_ARE_DATA,
 *   EIGHT_STYLES_THAT_DIFFER, STYLES_DIFFER_ON_MOTION_NOT_TYPE
 *
 * WHAT:  The eight shipped motion styles.
 *
 * WHY:   The phase file asks for six to ten. Eight, and each one is a shape of
 *        video somebody actually makes rather than a colour variation: a
 *        product explainer, an internal brief, a launch, a post-mortem, a
 *        customer story, a friendly how-to, a long-form documentary cut, and a
 *        metrics read-out.
 *
 *        EIGHT_STYLES_THAT_DIFFER. Every pair differs on at least three of the
 *        seven tokens, which `motion-styles.test.ts` asserts — because a
 *        library whose entries differ only in palette is a palette picker
 *        wearing a style picker's clothes, and the customer finds that out
 *        after choosing.
 *
 *        STYLES_DIFFER_ON_MOTION_NOT_TYPE, and this is the honest limitation
 *        of the set as shipped. With one bundled font family
 *        (TWO_FONTS_ONE_FAMILY in src/lib/types/motion-style.ts) no two styles
 *        here can differ typographically, so the distinctions carry on
 *        palette, radius, stroke, motion personality, caption treatment and
 *        music. That is enough for eight genuinely different-looking videos
 *        and it is NOT what the phase file describes — it asks a style to name
 *        two fonts. Licensing a second face is the remaining half, and when it
 *        lands these objects each gain one line.
 *
 *        Every id is referenced by nothing outside this folder, so renaming one
 *        is safe today — but a stored `Project.settings.motion.styleId` will
 *        point at one from 16d onward, and at that point an id is a contract.
 * WHERE: ./index.ts builds the lookup; the gallery and the style picker list
 *        it; `motionStudio.styles` returns it.
 */

import type { MotionStyle } from "@/lib/types/motion-style";

import { defineMotionStyle } from "./define";

export const MOTION_STYLE_LIBRARY: readonly MotionStyle[] = [
  /* The base, named. Nothing overridden, which is the point of
   * ONE_DEFAULT_TO_DIVERGE_FROM — the plainest entry is still shippable. */
  defineMotionStyle("studio", "Studio", {
    minPlan: "pro",
  }),

  /* An internal brief: quiet, grey, nothing moving quickly, and a caption band
   * rather than word-by-word emphasis. Square corners because an editorial
   * band with rounded boxes above it reads as two designs. */
  defineMotionStyle("boardroom", "Boardroom", {
    paletteId: "mono",
    radius: "square",
    strokeWeight: "hairline",
    motionPersonality: "calm",
    captionTreatment: "editorial-band",
    musicMood: "ambient",
  }),

  /* A launch. Everything loud: the brightest palette, pill corners, heavy
   * strokes, the fastest motion and the most emphatic captions. */
  defineMotionStyle("launch", "Launch", {
    paletteId: "electric",
    radius: "round",
    strokeWeight: "bold",
    motionPersonality: "energetic",
    captionTreatment: "bold-punch",
    musicMood: "upbeat",
  }),

  /* A post-mortem or a security note. Dark, square, deliberate, and the one
   * style that asks for tension under it. */
  defineMotionStyle("incident", "Incident", {
    paletteId: "noir",
    radius: "square",
    strokeWeight: "regular",
    motionPersonality: "precise",
    captionTreatment: "editorial-dossier",
    musicMood: "tense",
  }),

  /* A customer story. Warm, round, unhurried — the style for a video where
   * somebody is being quoted rather than informed. */
  defineMotionStyle("testimonial", "Testimonial", {
    paletteId: "warm",
    radius: "round",
    strokeWeight: "regular",
    motionPersonality: "calm",
    captionTreatment: "clean-soft",
    musicMood: "warm",
  }),

  /* A friendly how-to. The only style with `playful` motion, which is the only
   * personality that overshoots — see MOTION_PERSONALITY_TIMING for why that is
   * a deliberate choice and not a default. */
  defineMotionStyle("friendly", "Friendly", {
    paletteId: "default",
    radius: "round",
    strokeWeight: "regular",
    motionPersonality: "playful",
    captionTreatment: "playful-bubble",
    musicMood: "upbeat",
  }),

  /* A long-form cut. Hairline strokes and calm motion, so the graphics sit
   * under the narration rather than competing with it. */
  defineMotionStyle("documentary", "Documentary", {
    paletteId: "noir",
    radius: "soft",
    strokeWeight: "hairline",
    motionPersonality: "calm",
    captionTreatment: "clean-documentary",
    musicMood: "ambient",
  }),

  /* A metrics read-out. Heavy strokes because the bars and meters ARE the
   * content, and silence because nobody wants a bed under a numbers video. */
  defineMotionStyle("data-desk", "Data desk", {
    paletteId: "mono",
    radius: "soft",
    strokeWeight: "bold",
    motionPersonality: "precise",
    captionTreatment: "editorial-stat",
    musicMood: "none",
  }),
];
