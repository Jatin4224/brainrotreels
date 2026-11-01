/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: checkMotionStyle, CODE_VALIDATES_NOT_THE_EYE,
 *   FONT_NOT_BUNDLED_IS_THE_SILENT_ONE, CONTRAST_IS_MEASURED_NOT_JUDGED,
 *   ONE_CONTRAST_RULE
 *
 * WHAT:  The phase's "code validates" — whether a style's palette exists, its
 *        fonts are really bundled, its caption treatment is a real one, its
 *        plan is a real plan, and whether the result is legible.
 *
 * WHY:   CODE_VALIDATES_NOT_THE_EYE is step 9 of the phase file, and it names
 *        the failure it is defending against: "a model-proposed font that is
 *        not bundled renders as a fallback and silently ruins the video".
 *        FONT_NOT_BUNDLED_IS_THE_SILENT_ONE — there is no error, no failed
 *        render and no complaint, just a finished video in the wrong typeface
 *        that somebody paid for. Of the five checks here it is the only one
 *        whose absence produces no signal at all, which is why the phase
 *        bothers to spell it out.
 *
 *        CONTRAST_IS_MEASURED_NOT_JUDGED, and ONE_CONTRAST_RULE: the
 *        measurement is `contrastRatio` from src/lib/captions/contrast.ts
 *        against `CONTRAST_TEXT_MIN`, the same function and the same threshold
 *        the caption library measures its own thirty-eight styles with and the
 *        same one `palettes.test.ts` uses. A second luminance calculation here
 *        would be a second answer to a question this codebase has already
 *        answered once — and the one that disagreed would be whichever was
 *        written later.
 *
 *        Two contrasts are measured and they are different questions. The
 *        palette's own `text` against its gradient is "can you read a headline
 *        on this", which the palette library already asserts for its five
 *        entries — checked again here because a MODEL may name a palette and a
 *        future palette may be added without the test being re-run. The
 *        caption treatment's `fill` against the gradient is "can you read the
 *        captions over it", which nothing else checks: a caption style is
 *        measured against REFERENCE_BACKGROUNDS in its own library, not
 *        against the palette a motion style happens to pair it with. That
 *        pairing is new in this phase, so the check is too.
 *
 *        Pure and isomorphic — no `server-only`, no model, no database. The
 *        model call in src/lib/script/motion-style.ts imports this; so does the
 *        library's own test, which is what lets the whole shipped library be
 *        asserted shippable with no API key and no spend.
 * WHERE: src/lib/script/motion-style.ts (the retry); ./index.ts;
 *        motion-styles.test.ts; the style picker's refusal list.
 */

import { CAPTION_FONT_FAMILIES } from "@/lib/captions/fonts";
import { getCaptionStyle, isCaptionStyleId } from "@/lib/captions/styles";
import { contrastRatio, CONTRAST_TEXT_MIN } from "@/lib/captions/contrast";
import { PALETTES } from "@/lib/palettes";
import { PLAN_KEYS } from "@/lib/config/plans";
import {
  motionStyleRejection,
  type MotionStyle,
  type MotionStyleCheckResult,
  type MotionStyleRejection,
} from "@/lib/types/motion-style";

/**
 * SOURCE OF TRUTH KEYWORDS: checkMotionStyle, CODE_VALIDATES_NOT_THE_EYE
 *
 * WHAT:  Every provable problem with a style, as a list.
 * WHY:   A list rather than a throw: the model is re-asked once with the
 *        refusals named, and a hand-picked style shows them beside the control
 *        that is wrong. Each message names the token and what would have been
 *        valid, because a model cannot act on "invalid palette".
 * WHERE: See the file header.
 */
export function checkMotionStyle(style: MotionStyle): MotionStyleCheckResult {
  const rejections: MotionStyleRejection[] = [];

  /* The palette has to resolve for its own sake AND because the two contrast
   * checks below have nothing to measure without it. `getPalette` would fall
   * back to the default here, which is exactly wrong for a validator: it would
   * measure a palette nobody chose and report a pass. */
  const palette = Object.hasOwn(PALETTES, style.paletteId)
    ? PALETTES[style.paletteId]
    : undefined;

  if (palette === undefined) {
    rejections.push(
      motionStyleRejection(
        "paletteId",
        "UNKNOWN_PALETTE",
        `"${style.paletteId}" is not a palette. Choose one of: ${Object.keys(PALETTES).join(", ")}.`,
      ),
    );
  }

  /* FONT_NOT_BUNDLED_IS_THE_SILENT_ONE. The key is already narrowed by the
   * schema, so this catches the case the schema cannot: a key that exists in
   * the union but has no family mapped — which is what a half-finished second
   * face would look like. */
  for (const slot of ["display", "body"] as const) {
    const key = style.fonts[slot];
    if (CAPTION_FONT_FAMILIES[key] === undefined) {
      rejections.push(
        motionStyleRejection(
          `fonts.${slot}`,
          "FONT_NOT_BUNDLED",
          `"${key}" has no bundled face, so it would render in a fallback typeface and nobody would be told. Bundled keys: ${Object.keys(CAPTION_FONT_FAMILIES).join(", ")}.`,
        ),
      );
    }
  }

  if (!isCaptionStyleId(style.captionTreatment)) {
    rejections.push(
      motionStyleRejection(
        "captionTreatment",
        "UNKNOWN_CAPTION_TREATMENT",
        `"${style.captionTreatment}" is not a caption style in this app's library.`,
      ),
    );
  }

  if (!(PLAN_KEYS as readonly string[]).includes(style.minPlan)) {
    rejections.push(
      motionStyleRejection(
        "minPlan",
        "UNKNOWN_PLAN",
        `"${style.minPlan}" is not a plan. Plans: ${PLAN_KEYS.join(", ")}.`,
      ),
    );
  }

  if (palette !== undefined) {
    /* Question one: can a headline be read on this palette? Measured against
     * BOTH gradient stops, because a motion element can land anywhere in the
     * frame and the gradient runs corner to corner. */
    const headline = Math.min(
      contrastRatio(palette.text, palette.from),
      contrastRatio(palette.text, palette.to),
    );
    if (headline < CONTRAST_TEXT_MIN) {
      rejections.push(
        motionStyleRejection(
          "paletteId",
          "CONTRAST_TOO_LOW",
          `Text on the "${palette.id}" palette measures ${headline.toFixed(2)}:1, below the ${CONTRAST_TEXT_MIN}:1 minimum.`,
        ),
      );
    }

    /* Question two, and the one nothing else in the codebase asks: can the
     * CAPTIONS be read over this palette? A caption style is measured against
     * REFERENCE_BACKGROUNDS in its own library, never against the palette a
     * motion style pairs it with — that pairing is new in this phase.
     *
     * Measured on the fill alone rather than through `passesContrast`, which
     * also credits the style's stroke. The stroke is what makes a caption
     * legible over arbitrary FOOTAGE; over a known flat gradient the fill is
     * the honest question, and a style that needs its outline to clear 4.5:1
     * against a colour we chose is a pairing worth refusing. */
    const captionFill = getCaptionStyle(style.captionTreatment).fill;
    const captions = Math.min(
      contrastRatio(captionFill, palette.from),
      contrastRatio(captionFill, palette.to),
    );
    if (isCaptionStyleId(style.captionTreatment) && captions < CONTRAST_TEXT_MIN) {
      rejections.push(
        motionStyleRejection(
          "captionTreatment",
          "CONTRAST_TOO_LOW",
          `The "${style.captionTreatment}" caption fill measures ${captions.toFixed(2)}:1 on the "${palette.id}" palette, below the ${CONTRAST_TEXT_MIN}:1 minimum. Pair it with a different palette or pick a lighter caption style.`,
        ),
      );
    }
  }

  return { ok: rejections.length === 0, rejections };
}
