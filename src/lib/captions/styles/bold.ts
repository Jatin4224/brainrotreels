/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: BOLD_STYLES, caption family bold, STYLES_ARE_DATA
 *
 * WHAT:  The loud family — heavy, upper case, high contrast. The default look
 *        of short-form video and the family most projects will use.
 * WHY:   Grouped by FAMILY rather than by plan or by colour, because that is
 *        how the gallery is browsed: a customer is choosing a mood, not a
 *        tier. The plan gate lives on each style's `minPlan`, so a family can
 *        hold both free and premium looks — which is what makes the upsell
 *        visible in the place the choice is made.
 * WHERE: Merged into CAPTION_STYLES by ./index.ts.
 */

import type { CaptionStyle } from "@/lib/types/caption";
import { defineStyle } from "./define";

const FAMILY = "Bold";

export const BOLD_STYLES: readonly CaptionStyle[] = [
  defineStyle("bold-pop", "Bold Pop", FAMILY),

  defineStyle("bold-punch", "Bold Punch", FAMILY, {
    sizeVh: 7.5,
    tracking: -0.03,
    animation: "bounce",
    maxWords: 2,
  }),

  defineStyle("bold-slam", "Bold Slam", FAMILY, {
    sizeVh: 8,
    stroke: { width: 0.12, color: "#000000" },
    highlight: "#FF2D55",
    animation: "bounce",
    maxWords: 2,
  }),

  defineStyle("bold-block", "Bold Block", FAMILY, {
    highlight: "#FFFFFF",
    highlightBox: "#C4003F",
    animation: "pop",
  }),

  defineStyle("bold-sunrise", "Bold Sunrise", FAMILY, {
    highlight: "#FF9500",
    shadow: { blur: 0.18, offsetY: 0.05, color: "#000000", opacity: 0.75 },
  }),

  defineStyle("bold-mint", "Bold Mint", FAMILY, {
    highlight: "#2BFFB2",
    animation: "slide",
  }),

  defineStyle("bold-ink", "Bold Ink", FAMILY, {
    /* The inverse: dark text carried by a white outline. Legible over bright
     * footage in a way white-on-white never is, which is why the contrast
     * rule treats the outline as a participant. */
    fill: "#101010",
    highlight: "#B3001B",
    stroke: { width: 0.1, color: "#FFFFFF" },
    shadow: { blur: 0.1, offsetY: 0.02, color: "#FFFFFF", opacity: 0.5 },
  }),

  defineStyle("bold-stadium", "Bold Stadium", FAMILY, {
    minPlan: "starter",
    sizeVh: 8.5,
    tracking: -0.04,
    highlight: "#00E5FF",
    stroke: { width: 0.14, color: "#000000" },
    animation: "bounce",
    maxWords: 2,
  }),

  defineStyle("bold-headline", "Bold Headline", FAMILY, {
    minPlan: "starter",
    sizeVh: 6.5,
    maxWords: 4,
    lineHeight: 1,
    highlight: "#FFE600",
    animation: "slide",
    position: "middle",
  }),
];
