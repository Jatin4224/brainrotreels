/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: NEON_STYLES, caption family neon, GLOW_IS_A_SHADOW
 *
 * WHAT:  The saturated family — bright fills, coloured glows, high energy.
 * WHY:   GLOW_IS_A_SHADOW. A neon look is a coloured shadow at high blur and
 *        zero offset, which is why there is no `glow` field: it would be a
 *        second way to express the thing `shadow` already expresses, and the
 *        renderer would have to composite both. One field, used differently,
 *        keeps the component from growing a branch per family.
 *
 *        Every style here still carries a dark outline. A glow spreads light
 *        AWAY from the letterform, so it does nothing for legibility over
 *        bright footage — without the stroke, this entire family would fail
 *        the light reference background, which is exactly what the contrast
 *        test is there to catch.
 * WHERE: Merged into CAPTION_STYLES by ./index.ts.
 */

import type { CaptionStyle } from "@/lib/types/caption";
import { defineStyle } from "./define";

const FAMILY = "Neon";

export const NEON_STYLES: readonly CaptionStyle[] = [
  defineStyle("neon-cyan", "Neon Cyan", FAMILY, {
    fill: "#8FFFFF",
    highlight: "#00E5FF",
    stroke: { width: 0.09, color: "#001B1F" },
    shadow: { blur: 0.4, offsetY: 0, color: "#00E5FF", opacity: 0.8 },
    animation: "pop",
  }),

  defineStyle("neon-magenta", "Neon Magenta", FAMILY, {
    fill: "#FFC2E8",
    highlight: "#FF4FD8",
    stroke: { width: 0.09, color: "#1A0014" },
    shadow: { blur: 0.4, offsetY: 0, color: "#FF4FD8", opacity: 0.8 },
    animation: "pop",
  }),

  defineStyle("neon-lime", "Neon Lime", FAMILY, {
    fill: "#E4FFB0",
    highlight: "#B6FF00",
    stroke: { width: 0.09, color: "#0C1400" },
    shadow: { blur: 0.36, offsetY: 0, color: "#B6FF00", opacity: 0.8 },
    animation: "bounce",
    maxWords: 2,
  }),

  defineStyle("neon-sunset", "Neon Sunset", FAMILY, {
    fill: "#FFD9B0",
    highlight: "#FF7A00",
    stroke: { width: 0.09, color: "#1A0D00" },
    shadow: { blur: 0.34, offsetY: 0, color: "#FF7A00", opacity: 0.8 },
    animation: "slide",
  }),

  defineStyle("neon-ice", "Neon Ice", FAMILY, {
    minPlan: "starter",
    fill: "#FFFFFF",
    highlight: "#9BE8FF",
    stroke: { width: 0.08, color: "#001421" },
    shadow: { blur: 0.45, offsetY: 0, color: "#4FC3F7", opacity: 0.9 },
    animation: "fade",
  }),

  defineStyle("neon-vhs", "Neon VHS", FAMILY, {
    minPlan: "pro",
    sizeVh: 7,
    tracking: 0.04,
    fill: "#FFFFFF",
    highlight: "#FF4FD8",
    stroke: { width: 0.08, color: "#12002B" },
    shadow: { blur: 0.3, offsetY: 0.06, color: "#00E5FF", opacity: 0.85 },
    animation: "slide",
    maxWords: 2,
  }),
];
