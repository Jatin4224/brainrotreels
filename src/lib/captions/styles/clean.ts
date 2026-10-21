/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: CLEAN_STYLES, caption family clean,
 *   LOWER_THIRD, AS_WRITTEN_CASE
 *
 * WHAT:  The quiet family — sentence case, moderate size, low on the frame.
 *        What a talking-head explainer or a documentary cut wants.
 * WHY:   AS_WRITTEN_CASE matters more here than anywhere else in the library.
 *        These styles exist for content where the SCRIPT'S punctuation and
 *        capitalisation carry meaning — a product name, an acronym, a quoted
 *        line — and upper-casing it throws that away. It is also the family
 *        that most exposes the alignment's back-matching: the words on screen
 *        are the ones the customer typed, not the ones the model heard.
 * WHERE: Merged into CAPTION_STYLES by ./index.ts.
 */

import type { CaptionStyle } from "@/lib/types/caption";
import { defineStyle } from "./define";

const FAMILY = "Clean";

export const CLEAN_STYLES: readonly CaptionStyle[] = [
  defineStyle("clean-lower", "Clean Lower Third", FAMILY, {
    case: "asWritten",
    weight: 400,
    sizeVh: 4.5,
    tracking: 0,
    maxWords: 4,
    highlight: "#FFFFFF",
    fill: "#E6E6E6",
    stroke: { width: 0.05, color: "#000000" },
    shadow: { blur: 0.16, offsetY: 0.02, color: "#000000", opacity: 0.7 },
    animation: "fade",
  }),

  defineStyle("clean-bold-lower", "Clean Lower Third Bold", FAMILY, {
    case: "asWritten",
    sizeVh: 5,
    maxWords: 4,
    highlight: "#FFFFFF",
    fill: "#E6E6E6",
    stroke: { width: 0.06, color: "#000000" },
    animation: "fade",
  }),

  defineStyle("clean-center", "Clean Centre", FAMILY, {
    case: "asWritten",
    weight: 400,
    sizeVh: 5,
    maxWords: 4,
    position: "middle",
    highlight: "#FFFFFF",
    fill: "#DCDCDC",
    stroke: { width: 0.05, color: "#000000" },
    animation: "fade",
  }),

  defineStyle("clean-title", "Clean Title Case", FAMILY, {
    case: "title",
    sizeVh: 5.5,
    maxWords: 3,
    highlight: "#FFE600",
    stroke: { width: 0.06, color: "#000000" },
    animation: "fade",
  }),

  defineStyle("clean-soft", "Clean Soft", FAMILY, {
    case: "asWritten",
    weight: 400,
    sizeVh: 4.5,
    maxWords: 4,
    fill: "#F2F2F2",
    highlight: "#9BE8FF",
    stroke: { width: 0.05, color: "#102027" },
    shadow: { blur: 0.2, offsetY: 0.02, color: "#102027", opacity: 0.6 },
    animation: "fade",
  }),

  defineStyle("clean-documentary", "Clean Documentary", FAMILY, {
    minPlan: "starter",
    case: "asWritten",
    weight: 400,
    sizeVh: 4,
    tracking: 0.02,
    maxWords: 4,
    lineHeight: 1.3,
    fill: "#D8D8D8",
    highlight: "#FFFFFF",
    stroke: { width: 0.05, color: "#000000" },
    shadow: { blur: 0.24, offsetY: 0.03, color: "#000000", opacity: 0.8 },
    animation: "fade",
  }),
];
