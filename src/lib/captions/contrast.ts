/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: contrastRatio, relativeLuminance, passesContrast,
 *   CONTRAST_IS_A_TEST_NOT_AN_EYE, WCAG_AA_TEXT, STROKE_IS_A_PARTICIPANT,
 *   REFERENCE_BACKGROUNDS, ContrastReport
 *
 * WHAT:  WCAG relative luminance and contrast ratio, and the rule that decides
 *        whether a caption style is legible over both a white and a black
 *        background.
 *
 * WHY:   CONTRAST_IS_A_TEST_NOT_AN_EYE is the phase's step 6, and it is a rule
 *        about PROCESS rather than about colour. Thirty-odd styles cannot be
 *        checked by a reviewer looking at a gallery — they can on the day they
 *        are added and never again, and the thirty-first arrives in a hurry.
 *        So the rule is executable and contrast.test.ts runs it over the whole
 *        library: an illegible style fails CI instead of shipping into
 *        somebody's video.
 *
 *        STROKE_IS_A_PARTICIPANT. The obvious implementation checks the fill
 *        against the background and rejects every white-on-light style — which
 *        would delete most of the library, because that is not how captions
 *        work. A caption over footage is legible through its OUTLINE: white
 *        text with a black stroke is readable on snow, and the fill alone is
 *        not. So the rule asks whether the fill OR a load-bearing stroke
 *        carries the contrast, and additionally that the two are distinct
 *        enough from each other to read as an outline at all. A stroke too
 *        thin to see is not allowed to count — see MIN_LOAD_BEARING_STROKE.
 *
 *        REFERENCE_BACKGROUNDS are pure white and pure black rather than a
 *        sampled frame. A caption sits over arbitrary footage whose brightness
 *        changes every frame, so the only honest test is the worst case at
 *        both ends. Passing both means passing everything between them.
 *
 *        WCAG_AA_TEXT: 4.5:1 for the text itself, 3:1 for the outline against
 *        the fill and for a highlight box treated as a graphical object. These
 *        are the published AA thresholds, used unchanged — a house threshold
 *        would be a number nobody can defend to an accessibility review.
 * WHERE: contrast.test.ts over every style in CAPTION_STYLES; the style
 *        gallery shows the same verdict on a card.
 */

import type { CaptionStyle } from "@/lib/types/caption";

/**
 * SOURCE OF TRUTH KEYWORDS: WCAG_AA_TEXT, CONTRAST_TEXT_MIN,
 *   CONTRAST_GRAPHIC_MIN
 */
export const CONTRAST_TEXT_MIN = 4.5;
export const CONTRAST_GRAPHIC_MIN = 3;

/**
 * SOURCE OF TRUTH KEYWORDS: MIN_LOAD_BEARING_STROKE, STROKE_IS_A_PARTICIPANT
 *
 * A stroke thinner than 4% of the font size is a hairline at 1080p and gone
 * at preview resolution, so it cannot be what carries a style's legibility.
 * Styles that want a decorative hairline are free to have one; they just have
 * to pass on their fill instead.
 */
export const MIN_LOAD_BEARING_STROKE = 0.04;

/**
 * SOURCE OF TRUTH KEYWORDS: REFERENCE_BACKGROUNDS
 *
 * The two worst cases. Named rather than inlined so the gallery can label
 * which one a style failed against.
 */
export const REFERENCE_BACKGROUNDS = [
  { id: "light", color: "#FFFFFF" },
  { id: "dark", color: "#000000" },
] as const;

export type ReferenceBackgroundId = (typeof REFERENCE_BACKGROUNDS)[number]["id"];

/**
 * SOURCE OF TRUTH KEYWORDS: ContrastReport
 *
 * WHAT:  Whether a style is legible, and if not, exactly why.
 * WHY:   The failures are SENTENCES, not a boolean, because the consumer is a
 *        developer adding the thirty-first style at speed. "bold-pop is
 *        illegible" sends them guessing; "the active word (#FFE600) reads at
 *        1.6:1 on light and its stroke is too thin to carry it" is a fix.
 * WHERE: Returned by passesContrast; asserted in contrast.test.ts.
 */
export interface ContrastReport {
  ok: boolean;
  failures: string[];
}

/**
 * SOURCE OF TRUTH KEYWORDS: relativeLuminance
 *
 * WHAT:  WCAG 2.x relative luminance of a six-digit hex colour.
 * WHY:   The sRGB gamma expansion is the published formula and is not an
 *        approximation of it — the naive "average the channels" version rates
 *        pure blue as mid-grey, which is wrong by a factor of five on exactly
 *        the saturated colours a caption library is full of.
 * WHERE: contrastRatio.
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const [lr, lg, lb] = [r, g, b].map(channelLuminance) as [
    number,
    number,
    number,
  ];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/**
 * SOURCE OF TRUTH KEYWORDS: contrastRatio, WCAG_AA_TEXT
 *
 * WHAT:  The WCAG contrast ratio between two colours, 1:1 to 21:1.
 * WHERE: passesContrast, and the gallery's per-card badge.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * SOURCE OF TRUTH KEYWORDS: passesContrast, STROKE_IS_A_PARTICIPANT,
 *   REFERENCE_BACKGROUNDS, CONTRAST_IS_A_TEST_NOT_AN_EYE
 *
 * WHAT:  Whether a style's resting text and its active word are both legible
 *        over white and over black.
 *
 * WHY:   Both colours are checked, not just the fill. The active word is the
 *        one the viewer is reading — a style whose highlight is a pale yellow
 *        on an otherwise legible white caption fails exactly where it matters
 *        and passes a fill-only check.
 *
 *        A highlight that sits on a filled BOX is judged against the box
 *        instead of the footage, because that is what is behind it. The box
 *        itself is then judged as a graphical object at 3:1, which is the
 *        WCAG rule for a shape that conveys meaning.
 * WHERE: contrast.test.ts over the whole library; the gallery card.
 */
export function passesContrast(style: CaptionStyle): ContrastReport {
  const failures: string[] = [];

  const strokeCounts = style.stroke.width >= MIN_LOAD_BEARING_STROKE;
  const strokeDistinct =
    contrastRatio(style.fill, style.stroke.color) >= CONTRAST_GRAPHIC_MIN;

  for (const background of REFERENCE_BACKGROUNDS) {
    /* The resting caption. Either the fill carries it, or a load-bearing
     * stroke that is itself distinct from the fill does. */
    const fillRatio = contrastRatio(style.fill, background.color);
    const strokeRatio = contrastRatio(style.stroke.color, background.color);

    const restingOk =
      fillRatio >= CONTRAST_TEXT_MIN ||
      (strokeCounts && strokeDistinct && strokeRatio >= CONTRAST_TEXT_MIN);

    if (!restingOk) {
      failures.push(
        `the caption text (${style.fill}) reads at ${format(fillRatio)}:1 on ${background.id} ` +
          `and its ${describeStroke(style, strokeCounts, strokeDistinct)} ` +
          `(${style.stroke.color}, ${format(strokeRatio)}:1) cannot carry it`,
      );
    }

    if (style.highlightBox === null) {
      const highlightRatio = contrastRatio(style.highlight, background.color);
      const highlightStrokeDistinct =
        contrastRatio(style.highlight, style.stroke.color) >=
        CONTRAST_GRAPHIC_MIN;

      const highlightOk =
        highlightRatio >= CONTRAST_TEXT_MIN ||
        (strokeCounts && highlightStrokeDistinct && strokeRatio >= CONTRAST_TEXT_MIN);

      if (!highlightOk) {
        failures.push(
          `the active word (${style.highlight}) reads at ${format(highlightRatio)}:1 on ${background.id} ` +
            `and its ${describeStroke(style, strokeCounts, highlightStrokeDistinct)} ` +
            `(${style.stroke.color}, ${format(strokeRatio)}:1) cannot carry it`,
        );
      }
    } else {
      /* The box is what is behind the active word, so the footage no longer
       * decides the word's legibility. What the footage can still swallow is
       * the PAIR: a near-black box holding white text is invisible as a box
       * over dark footage and perfectly readable anyway, so the pair passes
       * if EITHER the box reads as a shape (3:1) or the word inside it reads
       * as text (4.5:1) against the background. Requiring the box alone
       * rejects half of a legitimate family for a problem nobody can see. */
      const boxRatio = contrastRatio(style.highlightBox, background.color);
      const wordRatio = contrastRatio(style.highlight, background.color);
      if (boxRatio < CONTRAST_GRAPHIC_MIN && wordRatio < CONTRAST_TEXT_MIN) {
        failures.push(
          `the highlight box (${style.highlightBox}) reads at ${format(boxRatio)}:1 on ${background.id} ` +
            `and the word on it (${style.highlight}) at ${format(wordRatio)}:1 — neither is visible there`,
        );
      }
    }
  }

  /* Checked once rather than per background: the active word on its box does
   * not depend on what is behind the box. */
  if (style.highlightBox !== null) {
    const onBox = contrastRatio(style.highlight, style.highlightBox);
    if (onBox < CONTRAST_TEXT_MIN) {
      failures.push(
        `the active word (${style.highlight}) reads at ${format(onBox)}:1 on its own highlight box ` +
          `(${style.highlightBox})`,
      );
    }
  }

  return { ok: failures.length === 0, failures };
}

function describeStroke(
  style: CaptionStyle,
  counts: boolean,
  distinct: boolean,
): string {
  if (!counts) {
    return `stroke is too thin to count (${style.stroke.width} < ${MIN_LOAD_BEARING_STROKE})`;
  }
  if (!distinct) return "stroke is too close to the fill to read as an outline";
  return "stroke";
}

function format(ratio: number): string {
  return (Math.round(ratio * 100) / 100).toFixed(2);
}

function channelLuminance(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (match === null || match[1] === undefined) {
    /* Throwing is right here and nowhere else in this module: a malformed
     * colour is a style that cannot be rendered OR measured, and returning a
     * neutral grey would let it pass the contrast test it exists to fail. */
    throw new Error(
      `[captions/contrast] "${hex}" is not a six-digit hex colour.`,
    );
  }
  const int = Number.parseInt(match[1], 16);
  return {
    r: (int >> 16) & 0xff,
    g: (int >> 8) & 0xff,
    b: int & 0xff,
  };
}
