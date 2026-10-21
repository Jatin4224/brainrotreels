/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: defineStyle, CAPTION_STYLE_BASE, StyleOverrides,
 *   STYLES_ARE_DATA, ONE_DEFAULT_TO_DIVERGE_FROM, PARSED_AT_DEFINITION
 *
 * WHAT:  The helper every caption style is written with: a legible base, and
 *        a parse of the result.
 *
 * WHY:   ONE_DEFAULT_TO_DIVERGE_FROM. Thirty-odd styles written out in full
 *        would be thirty-odd copies of `lineHeight: 1.1` — and the first one
 *        typed as `11` renders a caption a frame tall in exactly one style,
 *        which nobody notices until a customer picks it. Starting from a base
 *        means a style's definition shows ONLY what makes it that style,
 *        which is also what makes the library readable as a library.
 *
 *        The base is deliberately the plainest legible caption rather than a
 *        neutral zero: white, heavy, black-outlined, bottom third. A style
 *        that overrides nothing is still something you would ship.
 *
 *        PARSED_AT_DEFINITION: every style goes through `captionStyleSchema`
 *        as it is defined, at module load. A style is DATA, so the usual
 *        compile-time guarantee is weaker than it looks — a number out of its
 *        sane range (a `sizeVh` of 60, a stroke of 3) type-checks perfectly
 *        and renders a frame of solid colour. Parsing turns that into a
 *        failure at import, which in practice means in the test run that
 *        imports the library.
 * WHERE: Every file in this folder.
 */

import { captionStyleSchema, type CaptionStyle } from "@/lib/types/caption";

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_STYLE_BASE
 *
 * The plainest caption worth shipping: heavy white text with a black outline,
 * three words at a time, low on the frame. Every style in the library is this
 * plus a difference.
 */
export const CAPTION_STYLE_BASE: Omit<CaptionStyle, "id" | "name" | "family"> =
  {
    minPlan: "free",
    font: "display",
    weight: 700,
    case: "upper",
    sizeVh: 6,
    tracking: -0.01,
    lineHeight: 1.1,
    fill: "#FFFFFF",
    highlight: "#FFE600",
    highlightBox: null,
    stroke: { width: 0.08, color: "#000000" },
    shadow: { blur: 0.12, offsetY: 0.03, color: "#000000", opacity: 0.6 },
    animation: "pop",
    maxWords: 3,
    position: "bottom",
  };

export type StyleOverrides = Partial<
  Omit<CaptionStyle, "id" | "name" | "family">
>;

/**
 * SOURCE OF TRUTH KEYWORDS: defineStyle, PARSED_AT_DEFINITION
 *
 * WHAT:  One style: the base, the family's identity, and its own difference.
 * WHY:   Returns a PARSED value rather than the object literal, so the
 *        library cannot hold a style the renderer would choke on — see
 *        PARSED_AT_DEFINITION above.
 * WHERE: Every style definition in this folder.
 */
export function defineStyle(
  id: string,
  name: string,
  family: string,
  overrides: StyleOverrides = {},
): CaptionStyle {
  return captionStyleSchema.parse({
    ...CAPTION_STYLE_BASE,
    ...overrides,
    id,
    name,
    family,
  });
}
