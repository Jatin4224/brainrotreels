/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: applyCaptionCase, captionTextShadow,
 *   captionStrokeShadows, CASE_IS_PRESENTATIONAL, STROKE_WITHOUT_WEBKIT
 *
 * WHAT:  The pure text and CSS derivations the caption component needs: the
 *        cased form of a word, and the shadow stack that draws an outline.
 *
 * WHY:   CASE_IS_PRESENTATIONAL. Casing happens HERE, at draw time, and never
 *        touches `doc.words`. A style that upper-cased the stored words would
 *        make a restyle rewrite the document, which breaks the one property
 *        the whole phase is built on — the words are the script's, the style
 *        is a view of them. It also makes `AITA` and `Aita` indistinguishable
 *        after one round trip through an upper-case style.
 *
 *        STROKE_WITHOUT_WEBKIT. The outline is drawn with a ring of
 *        `text-shadow`s rather than `-webkit-text-stroke`, which is the thing
 *        that looks right and is wrong here: the webkit property strokes the
 *        glyph CENTRE line, eating into the letterform, and it renders at
 *        subtly different widths in the Player's browser and in Remotion's
 *        headless Chrome — a preview that does not match the paid output. A
 *        shadow ring is the same in both and sits OUTSIDE the glyph, which is
 *        also what makes it carry contrast (STROKE_IS_A_PARTICIPANT).
 *
 *        Both are pure string builders with no React and no Remotion import,
 *        so the gallery preview and the renderer produce the same CSS.
 * WHERE: src/remotion/components/captions.tsx and the gallery preview card.
 */

import type { CaptionCase, CaptionStyle } from "@/lib/types/caption";

/**
 * SOURCE OF TRUTH KEYWORDS: applyCaptionCase, CASE_IS_PRESENTATIONAL
 *
 * WHAT:  One word as the style wants it shown.
 * WHY:   `title` upper-cases the first LETTER rather than the first
 *        character, so a word opening with a quote or a bracket — `"stop` —
 *        is still capitalised. Doing it with `charAt(0).toUpperCase()` leaves
 *        that word lower-cased in exactly the places a script uses dialogue.
 * WHERE: Per word, in the caption component.
 */
export function applyCaptionCase(word: string, mode: CaptionCase): string {
  switch (mode) {
    case "upper":
      return word.toLocaleUpperCase();
    case "lower":
      return word.toLocaleLowerCase();
    case "title":
      return word.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
    case "asWritten":
      return word;
    default: {
      const exhaustive: never = mode;
      throw new Error(`[captions/text] Unknown case ${String(exhaustive)}`);
    }
  }
}

/* Eight directions. Four leaves visible notches on the diagonals of a heavy
 * face at caption size; sixteen is twice the shadow cost per glyph for a
 * difference nobody can see at 1080p. */
const STROKE_DIRECTIONS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7, 0.7],
  [-0.7, 0.7],
  [0.7, -0.7],
  [-0.7, -0.7],
];

/**
 * SOURCE OF TRUTH KEYWORDS: captionTextShadow, STROKE_WITHOUT_WEBKIT
 *
 * WHAT:  The complete `text-shadow` value: the outline ring, then the drop
 *        shadow or glow behind it.
 * WHY:   ORDER MATTERS and is the opposite of the intuitive one. CSS paints
 *        the FIRST shadow on top, so the outline has to come first — listed
 *        after the soft shadow, the glow washes over the ring and the outline
 *        stops carrying the contrast the style was measured on.
 *
 *        Sizes are fractions of the font size, so an outline that reads
 *        correctly at 1080p reads identically at 4K — a pixel stroke would be
 *        half as thick on the render the customer pays for.
 * WHERE: The caption component, once per style (not per word).
 */
export function captionTextShadow(
  style: CaptionStyle,
  fontPx: number,
): string {
  const parts: string[] = [];

  const strokePx = style.stroke.width * fontPx;
  if (strokePx > 0) {
    for (const [dx, dy] of STROKE_DIRECTIONS) {
      parts.push(
        `${round(dx * strokePx)}px ${round(dy * strokePx)}px 0 ${style.stroke.color}`,
      );
    }
  }

  if (style.shadow.opacity > 0 && (style.shadow.blur > 0 || style.shadow.offsetY !== 0)) {
    parts.push(
      `0 ${round(style.shadow.offsetY * fontPx)}px ${round(style.shadow.blur * fontPx)}px ${withAlpha(style.shadow.color, style.shadow.opacity)}`,
    );
  }

  return parts.join(", ");
}

/**
 * SOURCE OF TRUTH KEYWORDS: withAlpha
 *
 * WHAT:  A hex colour as `rgba(...)` at a given opacity.
 * WHY:   The style's colours are six-digit hex precisely so the contrast
 *        check can measure them (see hexColorSchema). Opacity is a separate
 *        field, so it is applied HERE, at the point of drawing, rather than
 *        smuggled into a colour the checker would then measure wrongly.
 * WHERE: captionTextShadow.
 */
export function withAlpha(hex: string, opacity: number): string {
  const int = Number.parseInt(hex.slice(1), 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(opacity * 100) / 100})`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
