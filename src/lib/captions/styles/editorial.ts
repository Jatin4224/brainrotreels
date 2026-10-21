/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: EDITORIAL_STYLES, caption family editorial,
 *   BOXED_CAPTION, NEWS_LOOK
 *
 * WHAT:  The structured family — boxed words, wide tracking, news and
 *        explainer looks that read as deliberate rather than energetic.
 * WHY:   These are the styles a longer sentence survives, so they carry
 *        `maxWords: 4` and a taller line height. A quiz question or a
 *        statistic read out in a four-word card is comprehensible; the same
 *        line in a two-word karaoke style is a slideshow.
 * WHERE: Merged into CAPTION_STYLES by ./index.ts.
 */

import type { CaptionStyle } from "@/lib/types/caption";
import { defineStyle } from "./define";

const FAMILY = "Editorial";

export const EDITORIAL_STYLES: readonly CaptionStyle[] = [
  defineStyle("editorial-band", "Editorial Band", FAMILY, {
    case: "upper",
    sizeVh: 5,
    tracking: 0.06,
    maxWords: 4,
    lineHeight: 1.25,
    highlight: "#FFFFFF",
    highlightBox: "#C4003F",
    animation: "slide",
  }),

  defineStyle("editorial-ticker", "Editorial Ticker", FAMILY, {
    case: "upper",
    weight: 400,
    sizeVh: 4.2,
    tracking: 0.1,
    maxWords: 4,
    highlight: "#FFE600",
    stroke: { width: 0.06, color: "#000000" },
    animation: "slide",
  }),

  defineStyle("editorial-quote", "Editorial Quote", FAMILY, {
    case: "asWritten",
    weight: 400,
    sizeVh: 5.5,
    maxWords: 4,
    lineHeight: 1.35,
    position: "middle",
    fill: "#FFFFFF",
    highlight: "#FFE600",
    stroke: { width: 0.05, color: "#000000" },
    shadow: { blur: 0.26, offsetY: 0.03, color: "#000000", opacity: 0.8 },
    animation: "fade",
  }),

  defineStyle("editorial-stat", "Editorial Stat", FAMILY, {
    minPlan: "starter",
    sizeVh: 7,
    tracking: -0.02,
    maxWords: 2,
    highlight: "#0A1A0F",
    highlightBox: "#2BFFB2",
    animation: "pop",
  }),

  defineStyle("editorial-dossier", "Editorial Dossier", FAMILY, {
    minPlan: "pro",
    case: "upper",
    sizeVh: 4.5,
    tracking: 0.12,
    maxWords: 3,
    position: "top",
    fill: "#FFFFFF",
    highlight: "#FF9500",
    stroke: { width: 0.06, color: "#000000" },
    shadow: { blur: 0.2, offsetY: 0.02, color: "#000000", opacity: 0.75 },
    animation: "fade",
  }),
];
