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

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_FONT_FACES, ONE_FACE_LIST_TWO_LOADERS,
 *   BUNDLED_FONT_ONLY, THE_PREVIEW_MUST_LOAD_THE_FACE
 *
 * WHAT:  The woff2 files in `public/fonts`, with the weight each one is.
 *        Paths are relative to the public root, with no leading slash.
 *
 * WHY:   ONE_FACE_LIST_TWO_LOADERS. `RENDER_FONT_FAMILY` is a LOCAL name
 *        declared by a `FontFace`, not a lookup into whatever is installed —
 *        which means something has to declare it, and there are two somethings:
 *        `src/remotion/fonts.ts` for a render (through `staticFile`, inside
 *        `delayRender`), and `src/components/global/render-fonts` for the app's
 *        own preview surfaces (plain `FontFace`, no Remotion). Two loaders with
 *        two copies of this list is how one of them ends up a weight behind.
 *
 *        THE_PREVIEW_MUST_LOAD_THE_FACE, and this constant exists because that
 *        was not true. From Phase 08 until Phase 16c, only the RENDER loader
 *        existed — so every preview in the app drawing with
 *        `RENDER_FONT_FAMILY` (the caption gallery, then the motion gallery)
 *        asked for a family nothing had registered and got the browser's
 *        default serif. The deliberate absence of a fallback stack
 *        (see RENDER_FONT_FAMILY above) is what made it visible rather than
 *        "close enough", which is the trade working as intended — it was
 *        caught by looking at the gallery, which is what the gallery is for.
 *
 *        For the motion engine the stakes are higher than appearance: the
 *        overflow checks measure Geist's real glyph advances, so a preview
 *        drawing a different face is a preview whose text has nothing to do
 *        with what was measured. DRAWN_IS_MEASURED is false the moment the
 *        face is wrong.
 * WHERE: Both loaders. Nothing else should name these files.
 */
export const RENDER_FONT_FACES: readonly {
  weight: "400" | "700";
  file: string;
}[] = [
  { weight: "400", file: "fonts/geist-sans-400.woff2" },
  { weight: "700", file: "fonts/geist-sans-700.woff2" },
];

export function captionFontFamily(key: CaptionFontKey): string {
  return CAPTION_FONT_FAMILIES[key];
}
