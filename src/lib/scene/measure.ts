/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: measureLineWidth, wrapText, measureBlock, fitTextRun,
 *   lineHeightPx, roleFontPx, MeasuredBlock, REAL_ADVANCES_NOT_AN_ESTIMATE,
 *   AUTO_FIT_HAS_A_FLOOR, NO_MID_WORD_BREAK, FIT_IS_DETERMINISTIC
 *
 * WHAT:  Real text measurement against the bundled faces: how wide a line is,
 *        where it wraps, how tall the wrapped block is, and the largest size a
 *        run of text fits a box at.
 *
 * WHY:   REAL_ADVANCES_NOT_AN_ESTIMATE — the numbers come from
 *        `metrics-data.ts`, which is the `hmtx` table of the face that
 *        actually renders. See that file's header for the provenance and for
 *        ADVANCE_SUM_IS_AN_UPPER_BOUND, the one direction this is allowed to
 *        be wrong in.
 *
 *        FIT_IS_DETERMINISTIC. `fitTextRun` walks sizes DOWNWARD in fixed
 *        0.1vh steps and returns the first that fits, rather than solving for
 *        the size or bisecting. A closed-form solve is impossible — wrapping
 *        makes width a step function of size, not a continuous one — and a
 *        bisection over a step function can land on either side of a boundary
 *        depending on rounding. Determinism is not a nicety here: Phase 04
 *        decides a render can be REUSED by hashing the document, so the same
 *        scene has to produce the same pixels on a different machine, and
 *        Phase 16d's "redesign this beat leaves the others byte-identical"
 *        requires that re-measuring an untouched beat return the same size.
 *        Forty-one integer steps cost nothing and are reproducible.
 *
 *        NO_MID_WORD_BREAK. A word wider than its box goes on its own line and
 *        is reported as an overflow, rather than being hyphenated or broken.
 *        The renderer is CSS with `overflow-wrap` left alone, so a break here
 *        that the browser would not make is a measurement that disagrees with
 *        the picture — and the whole value of this module is that it does not.
 *        A single unbreakable token too wide for the frame is a real defect
 *        (a URL, a 14-digit figure) and the repair loop's job, not something
 *        to paper over.
 *
 *        Pure, isomorphic, no DOM: the editor, Vitest and the Inngest worker
 *        all get the same answer. That is the reason the table exists at all.
 *
 * WHERE: src/lib/scene/layouts.ts calls fitTextRun for every slot;
 *        src/lib/scene/check.ts turns `overflow` into a TEXT_OVERFLOW error;
 *        the MotionScene components read the fitted `fontPx` and `lines` so the
 *        drawn text is the measured text.
 */

import {
  SCENE_TEXT_ROLE_SPECS,
  type PlacedRect,
  type PlacedTextRun,
  type SceneTextRun,
} from "@/lib/types/scene";
import type { CaptionWeight } from "@/lib/types/caption";

import { FACE_METRICS, type FaceMetrics } from "./metrics-data";

/* Decoded once per face per process. The encoded form is what ships (see
 * ADVANCES_ARE_ENCODED); nothing outside this module sees either. */
const decoded = new Map<CaptionWeight, Map<number, number>>();

function advanceTable(weight: CaptionWeight): Map<number, number> {
  const cached = decoded.get(weight);
  if (cached !== undefined) return cached;

  const table = new Map<number, number>();
  for (const pair of FACE_METRICS[weight].advances.split(",")) {
    const colon = pair.indexOf(":");
    table.set(
      Number.parseInt(pair.slice(0, colon), 36),
      Number.parseInt(pair.slice(colon + 1), 36),
    );
  }
  decoded.set(weight, table);
  return table;
}

/**
 * SOURCE OF TRUTH KEYWORDS: measureLineWidth, ADVANCE_SUM_IS_AN_UPPER_BOUND
 *
 * WHAT:  How wide one line of text is, in pixels, at a given size and weight.
 * WHY:   Iterated by CODE POINT rather than by `charAt`, so an astral
 *        character — an emoji in a callout, which customers do write — is one
 *        glyph rather than two surrogate halves each charged the fallback
 *        width. Measuring it as two would roughly double its contribution and
 *        report an overflow that is not there.
 * WHERE: wrapText and measureBlock; nothing else needs it directly.
 */
export function measureLineWidth(
  text: string,
  weight: CaptionWeight,
  fontPx: number,
): number {
  const face: FaceMetrics = FACE_METRICS[weight];
  const table = advanceTable(weight);

  let units = 0;
  for (const char of text) {
    const cp = char.codePointAt(0);
    /* `for…of` over a string always yields at least one code unit, so this is
     * unreachable in practice — it exists because codePointAt's type is
     * optional and narrowing it with a non-null assertion is a TypeScript
     * bypass this codebase does not use. */
    if (cp === undefined) continue;
    units += table.get(cp) ?? face.widestAdvance;
  }

  return (units / face.upem) * fontPx;
}

/**
 * SOURCE OF TRUTH KEYWORDS: lineHeightPx
 *
 * WHAT:  Baseline-to-baseline distance for a role at a size.
 * WHY:   The ROLE's multiplier, not the font's own `ascender + descender +
 *        lineGap`, which for Geist comes to 1.24 em and is too loose for a
 *        three-word headline. The font's metrics still decide the FIRST line's
 *        height in `measureBlock`, because that is what the browser does.
 * WHERE: measureBlock.
 */
export function lineHeightPx(lineHeight: number, fontPx: number): number {
  return lineHeight * fontPx;
}

/**
 * SOURCE OF TRUTH KEYWORDS: wrapText, NO_MID_WORD_BREAK
 *
 * WHAT:  The lines `text` breaks into inside `maxWidthPx`.
 * WHY:   Greedy, breaking on whitespace only — which is what CSS does for a
 *        block of normal text, and matching CSS is the point. Collapsing runs
 *        of whitespace mirrors the browser too: a double space in a model's
 *        output must not measure as two spaces and then draw as one.
 * WHERE: measureBlock.
 */
export function wrapText(
  text: string,
  weight: CaptionWeight,
  fontPx: number,
  maxWidthPx: number,
): string[] {
  const words = text.split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = words[0] ?? "";

  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (measureLineWidth(candidate, weight, fontPx) <= maxWidthPx) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);

  return lines;
}

/**
 * SOURCE OF TRUTH KEYWORDS: MeasuredBlock, measureBlock
 *
 * WHAT:  A wrapped block's lines and its real extent in pixels.
 * WHY:   `heightPx` is the first line's FONT height plus one line-height per
 *        further line, not `lines.length * lineHeight`. The difference is the
 *        leading below the last line, which the browser does not draw and
 *        which a slot does not need to reserve — reserving it is how a
 *        two-line headline ends up refused by a box it fits in.
 * WHERE: fitTextRun.
 */
export interface MeasuredBlock {
  lines: string[];
  widthPx: number;
  heightPx: number;
}

export function measureBlock(args: {
  text: string;
  weight: CaptionWeight;
  fontPx: number;
  maxWidthPx: number;
  lineHeight: number;
}): MeasuredBlock {
  const { text, weight, fontPx, maxWidthPx, lineHeight } = args;
  const lines = wrapText(text, weight, fontPx, maxWidthPx);

  let widthPx = 0;
  for (const line of lines) {
    widthPx = Math.max(widthPx, measureLineWidth(line, weight, fontPx));
  }

  const face = FACE_METRICS[weight];
  const firstLinePx = ((face.ascender - face.descender) / face.upem) * fontPx;
  const heightPx =
    lines.length === 0
      ? 0
      : firstLinePx + (lines.length - 1) * lineHeightPx(lineHeight, fontPx);

  return { lines, widthPx, heightPx };
}

/**
 * SOURCE OF TRUTH KEYWORDS: roleFontPx, SIZE_IS_A_FRACTION_OF_HEIGHT
 *
 * A role's size in real pixels on this canvas — the same derivation
 * `captionFontPx` makes for a caption style, and for the same reason.
 */
export function roleFontPx(sizeVh: number, canvasHeight: number): number {
  return (sizeVh / 100) * canvasHeight;
}

/* 0.1vh. Small enough that the chosen size is visually the largest that fits,
 * coarse enough that the walk is bounded at a few dozen steps for every role
 * in SCENE_TEXT_ROLE_SPECS. */
const FIT_STEP_VH = 0.1;

/**
 * SOURCE OF TRUTH KEYWORDS: fitTextRun, AUTO_FIT_HAS_A_FLOOR, FIT_IS_DETERMINISTIC
 *
 * WHAT:  The largest size this run of text fits `box` at, with the lines it
 *        wraps to there — or the floor size and `overflow: true` when no size
 *        in the role's range fits.
 *
 * WHY:   AUTO_FIT_HAS_A_FLOOR. Shrinking long copy to fit is what a designer
 *        does and is why a 90-character list item does not have to be refused.
 *        Shrinking PAST the floor is not: at 2vh on a 1080-tall proxy the text
 *        is nine pixels and the beat is unreadable, so "it fits" would be a
 *        true statement about a useless frame. Below the floor it returns the
 *        floor — so the component still has a size to draw and the beat still
 *        renders — and sets `overflow`, which `checkScene` turns into the
 *        error the repair loop acts on. Both halves matter: the pipeline
 *        always finishes AND the defect is reported.
 *
 *        Both axes are checked. Width alone would pass a headline that wrapped
 *        to five lines and ran out of the bottom of its slot, and `maxLines`
 *        alone would pass a single line wider than the frame.
 * WHERE: layouts.ts, once per text run per element.
 */
export function fitTextRun(run: SceneTextRun, box: PlacedRect, canvasHeight: number): PlacedTextRun {
  const spec = SCENE_TEXT_ROLE_SPECS[run.role];

  let fallback: PlacedTextRun | null = null;

  for (let sizeVh = spec.sizeVh; sizeVh >= spec.minSizeVh - 1e-9; sizeVh -= FIT_STEP_VH) {
    /* Rounded to the step so floating-point accumulation cannot make the walk
     * — and therefore the chosen size — depend on how many steps it took. */
    const stepped = Math.round(sizeVh * 10) / 10;
    const fontPx = roleFontPx(stepped, canvasHeight);
    const block = measureBlock({
      text: run.text,
      weight: spec.weight,
      fontPx,
      maxWidthPx: box.width,
      lineHeight: spec.lineHeight,
    });

    const fits =
      block.lines.length <= spec.maxLines &&
      block.widthPx <= box.width &&
      block.heightPx <= box.height;

    if (fits) {
      return {
        ...run,
        fontPx,
        lines: block.lines,
        widthPx: block.widthPx,
        heightPx: block.heightPx,
        box,
        drawnRect: centreIn(box, block.widthPx, block.heightPx),
        overflow: false,
      };
    }

    /* Kept on every pass so the floor's own measurement is what gets reported,
     * rather than the first size tried — the error message quotes how far over
     * the text is, and at the floor that number is the smallest it can be. */
    fallback = {
      ...run,
      fontPx,
      lines: block.lines,
      widthPx: block.widthPx,
      heightPx: block.heightPx,
      box,
      drawnRect: centreIn(box, block.widthPx, block.heightPx),
      overflow: true,
    };
  }

  /* Unreachable: the loop runs at least once because every role's sizeVh is
   * above its minSizeVh. Constructed rather than asserted for the same reason
   * measureLineWidth does not assert on codePointAt. */
  return (
    fallback ?? {
      ...run,
      fontPx: roleFontPx(spec.minSizeVh, canvasHeight),
      lines: [run.text],
      widthPx: box.width,
      heightPx: box.height,
      box,
      drawnRect: box,
      overflow: true,
    }
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: centreIn, OVERLAP_IS_CHECKED_ON_INK
 *
 * WHAT:  Where a block of a given extent lands inside its box.
 * WHY:   Centred on both axes, which is what every primitive in this library
 *        does — and stated once here rather than in each component, so the
 *        rectangle the overlap check measures is the rectangle that gets
 *        drawn. A block WIDER than its box therefore overhangs symmetrically,
 *        which is why the overflow error and the overlap error often fire
 *        together on the same beat: the second is the consequence of the first.
 * WHERE: fitTextRun; nothing else should centre by hand.
 */
function centreIn(box: PlacedRect, width: number, height: number): PlacedRect {
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}
