/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PLAYFUL_STYLES, caption family playful,
 *   REDDIT_LOOK, QUIZ_LOOK
 *
 * WHAT:  The light family — rounded, bouncy, friendly. The default look for
 *        the Reddit-story and quiz formats that Phases 12 and 13 add.
 * WHY:   Named by MOOD rather than by format, deliberately. A style called
 *        `reddit-story` would tie the library to the format list and invite a
 *        format to ship its own one-off style, which is how a library of
 *        thirty becomes a library of ninety with twelve near-duplicates. A
 *        format picks a style; it does not own one.
 * WHERE: Merged into CAPTION_STYLES by ./index.ts.
 */

import type { CaptionStyle } from "@/lib/types/caption";
import { defineStyle } from "./define";

const FAMILY = "Playful";

export const PLAYFUL_STYLES: readonly CaptionStyle[] = [
  defineStyle("playful-bubble", "Playful Bubble", FAMILY, {
    case: "title",
    sizeVh: 6.5,
    lineHeight: 1.2,
    highlight: "#FFFFFF",
    highlightBox: "#1F4FD0",
    animation: "bounce",
    maxWords: 3,
  }),

  defineStyle("playful-candy", "Playful Candy", FAMILY, {
    case: "title",
    sizeVh: 6.5,
    fill: "#FFFFFF",
    highlight: "#FF4FD8",
    stroke: { width: 0.1, color: "#2B0032" },
    animation: "bounce",
    maxWords: 2,
  }),

  defineStyle("playful-sticker", "Playful Sticker", FAMILY, {
    sizeVh: 7,
    highlight: "#101010",
    highlightBox: "#FFE600",
    stroke: { width: 0.1, color: "#000000" },
    animation: "pop",
    maxWords: 2,
  }),

  defineStyle("playful-chat", "Playful Chat", FAMILY, {
    minPlan: "starter",
    case: "asWritten",
    weight: 400,
    sizeVh: 5,
    maxWords: 4,
    lineHeight: 1.3,
    fill: "#FFFFFF",
    highlight: "#2BFFB2",
    stroke: { width: 0.06, color: "#001A12" },
    shadow: { blur: 0.2, offsetY: 0.03, color: "#000000", opacity: 0.7 },
    animation: "slide",
  }),

  defineStyle("playful-pastel", "Playful Pastel", FAMILY, {
    minPlan: "starter",
    case: "title",
    sizeVh: 6,
    fill: "#FFF1C9",
    highlight: "#FF9500",
    stroke: { width: 0.09, color: "#2B1A00" },
    shadow: { blur: 0.18, offsetY: 0.04, color: "#2B1A00", opacity: 0.6 },
    animation: "bounce",
  }),
];
