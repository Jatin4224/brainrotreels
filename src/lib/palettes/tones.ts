/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_TONE_COLOURS, toneColor, TONE_IS_MEANING_NOT_COLOUR,
 *   RENDER_COLOURS_ARE_LITERAL, TONE_CONTRAST_IS_TESTED
 *
 * WHAT:  What a motion scene's `tone` — neutral, positive, warning, negative —
 *        is actually drawn in, on a given palette.
 *
 * WHY:   TONE_IS_MEANING_NOT_COLOUR. A `callout` element says `tone:
 *        'negative'` and never a hex, because the model is not allowed to pick
 *        colour: every colour burned into a video has to pass a CONTRAST TEST
 *        rather than a reviewer's eye (COLOURS_ARE_CONTENT in
 *        src/lib/types/caption.ts), and a model cannot run one. So meaning is
 *        what crosses the seam and this table is where it becomes pixels —
 *        which also means one scene restyles across all five palettes without
 *        anything being rewritten.
 *
 *        `neutral` resolves to the palette's own `text` rather than to a value
 *        here, deliberately: a neutral callout IS the palette's voice, and a
 *        sixth near-white would be a second answer to a question
 *        `paletteSchema.text` already answers (and the one value in the
 *        palette that is documented as legible over `from`).
 *
 *        The other three are literal, which is the documented exception
 *        RENDER_COLOURS_ARE_LITERAL covers: these are composited into an MP4
 *        by a headless browser with no stylesheet, no CSS variables and no
 *        light/dark mode, so a theme token would render as the browser
 *        default. Nothing in this module may be used to style app chrome — the
 *        gallery's own UI uses the theme tokens like every other screen.
 *
 *        They are light tints rather than mid or deep ones for one reason:
 *        every palette in the library is DARK (see PALETTES — each one's
 *        `from` and `to` are deep), so a tone has to be lighter than its
 *        background. That is an assumption about the library rather than a
 *        general truth, which is exactly why TONE_CONTRAST_IS_TESTED —
 *        `palettes.test.ts` measures every tone against both gradient stops of
 *        every palette with the caption library's own `contrastRatio`, so
 *        adding a light palette fails a test instead of shipping an unreadable
 *        callout.
 *
 *        `negative` IS ONE STEP LIGHTER THAN THE OTHER TWO, and that is the
 *        test earning its place rather than a taste decision. The obvious
 *        choice alongside the other 400s measured 3.39 against `warm`, whose
 *        own background is a deep red — a red warning on a red gradient. One
 *        step lighter measures 4.94, which passes, and the margin is thin
 *        enough that a sixth palette could well push it under; that is what
 *        the test is for.
 * WHERE: The motion scene components in src/remotion/components/motion-scene/;
 *        the gallery, through the same function.
 */

import type { SceneTone } from "@/lib/types/scene";

import type { Palette } from "./index";

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_TONE_COLOURS
 *
 * The three tones that carry a judgement. `neutral` is absent on purpose —
 * see TONE_IS_MEANING_NOT_COLOUR above.
 */
export const SCENE_TONE_COLOURS: Readonly<
  Record<Exclude<SceneTone, "neutral">, string>
> = {
  positive: "#4ade80",
  warning: "#fbbf24",
  /* Lighter than the other two on purpose — see the file header. */
  negative: "#fca5a5",
};

/**
 * SOURCE OF TRUTH KEYWORDS: toneColor
 *
 * WHAT:  The colour a tone draws in on this palette.
 * WHY:   One function so the gallery's preview and the Remotion render cannot
 *        disagree — the same reason `captionBox` is shared rather than
 *        reimplemented per surface.
 * WHERE: Every motion primitive that takes a tone.
 */
export function toneColor(tone: SceneTone, palette: Palette): string {
  return tone === "neutral" ? palette.text : SCENE_TONE_COLOURS[tone];
}
