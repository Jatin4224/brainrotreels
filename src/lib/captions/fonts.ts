/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_FONT_FAMILIES, captionFontFamily,
 *   RENDER_FONT_FAMILY, BUNDLED_FONT_ONLY, ONE_FACE_TODAY, CAPTIONS_STAY_PURE
 *
 * WHAT:  The family name the bundled face is registered under, and the
 *        mapping from a style's `font` key to it.
 *
 * WHY:   BUNDLED_FONT_ONLY, the rule src/remotion/fonts.ts exists to enforce:
 *        a render may only use a face bundled in `public/fonts`, because a
 *        network font that fails mid-render produces a video that is SILENTLY
 *        in the wrong typeface — the worst failure mode a paid render has.
 *
 *        THE NAME LIVES HERE, AND src/remotion/fonts.ts RE-EXPORTS IT, which
 *        is the inversion that keeps this module pure. The caption library is
 *        imported by the gallery, by the apply mutation and by a test; if the
 *        family name were reached through src/remotion/fonts.ts, every one of
 *        those would pull the `remotion` package — and the package's module
 *        body expects a Remotion bundle. CAPTIONS_STAY_PURE.
 *
 *        ONE_FACE_TODAY, and the indirection exists anyway: a style says
 *        `font: 'display'` rather than naming a family, so adding a second
 *        face is a woff2, a FACES entry in src/remotion/fonts.ts and a line
 *        here — not an edit to thirty-eight style objects.
 * WHERE: src/remotion/fonts.ts re-exports RENDER_FONT_FAMILY from here;
 *        the caption component and the gallery preview call
 *        captionFontFamily().
 */

import type { CaptionFontKey } from "@/lib/types/caption";

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_FONT_FAMILY
 *
 * The family name components set in `fontFamily`. It is a LOCAL name declared
 * by the FontFace in src/remotion/fonts.ts, not a lookup into whatever happens
 * to be installed — which is why it carries no fallback stack. A missing face
 * must show up as unstyled text during development, not as a system font that
 * looks close enough to ship.
 */
export const RENDER_FONT_FAMILY = "GeistRender";

export const CAPTION_FONT_FAMILIES: Readonly<Record<CaptionFontKey, string>> = {
  display: RENDER_FONT_FAMILY,
};

export function captionFontFamily(key: CaptionFontKey): string {
  return CAPTION_FONT_FAMILIES[key];
}
