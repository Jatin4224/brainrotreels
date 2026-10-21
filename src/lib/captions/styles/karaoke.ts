/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: KARAOKE_STYLES, caption family karaoke,
 *   WORD_AT_A_TIME, HIGHLIGHT_BOX
 *
 * WHAT:  The family built around the ACTIVE WORD — one or two words at a
 *        time, with the spoken word boxed or colour-swapped.
 * WHY:   WORD_AT_A_TIME is a grouping decision as much as a look, which is
 *        why these styles carry `maxWords: 2` in the style itself rather than
 *        relying on the customer's slider. A karaoke style shown four words
 *        at a time is not a subtler karaoke style, it is a broken one — the
 *        highlight is the whole point and it needs room to be the only thing
 *        moving.
 * WHERE: Merged into CAPTION_STYLES by ./index.ts.
 */

import type { CaptionStyle } from "@/lib/types/caption";
import { defineStyle } from "./define";

const FAMILY = "Karaoke";

export const KARAOKE_STYLES: readonly CaptionStyle[] = [
  defineStyle("karaoke-classic", "Karaoke Classic", FAMILY, {
    maxWords: 2,
    highlight: "#FFE600",
    animation: "pop",
  }),

  defineStyle("karaoke-single", "Karaoke Single", FAMILY, {
    maxWords: 2,
    sizeVh: 9,
    tracking: -0.02,
    highlight: "#FFFFFF",
    fill: "#B9B9B9",
    stroke: { width: 0.1, color: "#000000" },
    animation: "pop",
  }),

  defineStyle("karaoke-boxed", "Karaoke Boxed", FAMILY, {
    maxWords: 2,
    highlight: "#000000",
    highlightBox: "#FFE600",
    animation: "pop",
  }),

  defineStyle("karaoke-boxed-mint", "Karaoke Boxed Mint", FAMILY, {
    maxWords: 2,
    highlight: "#06281C",
    highlightBox: "#2BFFB2",
    animation: "slide",
  }),

  defineStyle("karaoke-fade", "Karaoke Fade", FAMILY, {
    maxWords: 3,
    fill: "#9A9A9A",
    highlight: "#FFFFFF",
    animation: "fade",
    stroke: { width: 0.07, color: "#000000" },
  }),

  defineStyle("karaoke-bounce", "Karaoke Bounce", FAMILY, {
    minPlan: "starter",
    maxWords: 2,
    sizeVh: 7.5,
    highlight: "#00E5FF",
    animation: "bounce",
  }),

  defineStyle("karaoke-spotlight", "Karaoke Spotlight", FAMILY, {
    minPlan: "starter",
    maxWords: 2,
    sizeVh: 8,
    fill: "#8A8A8A",
    highlight: "#FFFFFF",
    highlightBox: "#101010",
    animation: "pop",
  }),
];
