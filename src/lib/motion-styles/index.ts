/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: motion-styles barrel, MOTION_STYLES, getMotionStyle,
 *   listMotionStyles, isMotionStyleId, DEFAULT_MOTION_STYLE_ID, checkMotionStyle,
 *   UNKNOWN_STYLE_FALLS_BACK, THE_PICKER_MUST_NOT_FALL_BACK
 *
 * WHAT:  The public surface of the motion style library — the lookup, the list,
 *        the strict membership test and the validator.
 *
 * WHY:   UNKNOWN_STYLE_FALLS_BACK and THE_PICKER_MUST_NOT_FALL_BACK are both
 *        here on purpose, and the split is the same one the caption library
 *        draws between `getCaptionStyle` and `isCaptionStyleId`.
 *
 *        A RENDER resolves a style id with `getMotionStyle`, which falls back
 *        to the default rather than failing: a document written by a newer
 *        release naming a style this worker has never heard of must still
 *        produce a video, for the reason architecture.md gives — a missing
 *        element is recoverable, a failed render is money gone.
 *
 *        A MUTATION that stores a customer's choice uses `isMotionStyleId` and
 *        refuses. Falling back there would mean somebody picked a style, got a
 *        different one, and has no way to tell that is what happened.
 *
 *        `DEFAULT_MOTION_STYLE_ID` is `studio`, which is `MOTION_STYLE_BASE`
 *        named — so the fallback is the one entry in the library guaranteed to
 *        be the plainest shippable thing rather than somebody's loud favourite.
 * WHERE: The style picker and the gallery (list), 16d's generator (get), the
 *        apply mutation (is), and the library's own test (check).
 */

import type { MotionStyle } from "@/lib/types/motion-style";

import { MOTION_STYLE_LIBRARY } from "./library";

export { MOTION_STYLE_BASE, defineMotionStyle } from "./define";
export { MOTION_STYLE_LIBRARY } from "./library";
export { checkMotionStyle } from "./validate";

export const DEFAULT_MOTION_STYLE_ID = "studio";

/**
 * SOURCE OF TRUTH KEYWORDS: MOTION_STYLES
 *
 * The library keyed by id. Built once at module load, and a duplicate id is a
 * silently lost style — so `motion-styles.test.ts` asserts the count matches
 * the array's.
 */
export const MOTION_STYLES: Readonly<Record<string, MotionStyle>> =
  Object.fromEntries(MOTION_STYLE_LIBRARY.map((style) => [style.id, style]));

/**
 * SOURCE OF TRUTH KEYWORDS: getMotionStyle, UNKNOWN_STYLE_FALLS_BACK
 *
 * WHAT:  The style an id names, or the default.
 * WHERE: 16d's generator and the renderer — never a mutation that stores a
 *        choice.
 */
export function getMotionStyle(styleId: string | undefined): MotionStyle {
  const style = styleId === undefined ? undefined : MOTION_STYLES[styleId];
  if (style !== undefined) return style;

  const fallback = MOTION_STYLES[DEFAULT_MOTION_STYLE_ID];
  /* The default is in the library by construction — this is the type system
   * asking rather than a real possibility. */
  if (fallback === undefined) {
    throw new Error(
      `[motion-styles] The default style "${DEFAULT_MOTION_STYLE_ID}" is missing from the library.`,
    );
  }
  return fallback;
}

/**
 * SOURCE OF TRUTH KEYWORDS: isMotionStyleId, THE_PICKER_MUST_NOT_FALL_BACK
 *
 * WHERE: Any mutation that stores a style id.
 */
export function isMotionStyleId(styleId: string): boolean {
  return Object.hasOwn(MOTION_STYLES, styleId);
}

export function listMotionStyles(): MotionStyle[] {
  return [...MOTION_STYLE_LIBRARY];
}
