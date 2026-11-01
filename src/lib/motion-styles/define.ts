/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: defineMotionStyle, MOTION_STYLE_BASE,
 *   STYLE_TOKENS_ARE_DATA, ONE_DEFAULT_TO_DIVERGE_FROM, PARSED_AT_DEFINITION
 *
 * WHAT:  The helper every motion style is written with: a shippable base, and
 *        a parse of the result.
 *
 * WHY:   ONE_DEFAULT_TO_DIVERGE_FROM, the same argument `defineStyle` in
 *        src/lib/captions/styles/define.ts makes. Seven tokens written out in
 *        full for every style is seven chances to typo a token nobody reads
 *        carefully, and a style's definition should show ONLY what makes it
 *        that style — which is also what makes the library readable as a
 *        library rather than as ten unrelated objects.
 *
 *        The base is deliberately the plainest style worth shipping rather
 *        than a neutral zero: the default palette, regular strokes, precise
 *        motion, and a caption treatment from the Phase 08 library that is
 *        legible over it. A style that overrides nothing is still one you
 *        would put in front of a customer.
 *
 *        PARSED_AT_DEFINITION: every style goes through `motionStyleSchema` as
 *        it is defined, at module load. A style is DATA, so the compile-time
 *        guarantee is weaker than it looks — but unlike a caption style, every
 *        token here is a closed union or an id, so the schema catches a typo'd
 *        token and `checkMotionStyle` catches an id that does not resolve. The
 *        two together are why `motion-styles.test.ts` can assert the whole
 *        library is shippable rather than merely well-typed.
 * WHERE: Every file in this folder.
 */

import { motionStyleSchema, type MotionStyle } from "@/lib/types/motion-style";

/**
 * SOURCE OF TRUTH KEYWORDS: MOTION_STYLE_BASE
 *
 * The plainest motion style worth shipping. Every style in the library is this
 * plus a difference.
 *
 * `fonts` names the same key twice, which is TWO_FONTS_ONE_FAMILY: there is one
 * bundled family today, so display and body resolve to it. The two fields exist
 * so that licensing a second face is a key and a mapping rather than an edit to
 * every style object.
 */
export const MOTION_STYLE_BASE: Omit<MotionStyle, "id" | "name"> = {
  minPlan: "pro",
  paletteId: "default",
  fonts: { display: "display", body: "display" },
  radius: "soft",
  strokeWeight: "regular",
  motionPersonality: "precise",
  captionTreatment: "clean-center",
  musicMood: "none",
};

/**
 * SOURCE OF TRUTH KEYWORDS: defineMotionStyle, PARSED_AT_DEFINITION
 *
 * WHAT:  One library style: the base, plus what makes it itself.
 * WHY:   Parses as it defines, so a bad token fails at import — which in
 *        practice means in the test run that imports the library, rather than
 *        in a render somebody paid for.
 * WHERE: The style files in this folder.
 */
export function defineMotionStyle(
  id: string,
  name: string,
  overrides: Partial<Omit<MotionStyle, "id" | "name">> = {},
): MotionStyle {
  return motionStyleSchema.parse({
    ...MOTION_STYLE_BASE,
    ...overrides,
    id,
    name,
  });
}
