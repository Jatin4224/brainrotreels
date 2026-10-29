/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: pickBestStockResult, scoreStockResult,
 *   StockScoreInput, BEST_MATCH_IS_A_PRODUCT_RULE, COVERAGE_BEATS_RESOLUTION,
 *   LANDSCAPE_IS_REFUSED, UNKNOWN_IS_NOT_PENALISED, TIE_BREAK_IS_DETERMINISTIC
 *
 * WHAT:  Which of the clips a stock search returned is the best one for one
 *        narration block.
 *
 * WHY:   BEST_MATCH_IS_A_PRODUCT_RULE, and that is why this file is here rather
 *        than in the stock adapter. Choosing between the RENDITIONS of one clip
 *        is provider knowledge and lives in
 *        src/lib/adapters/stock/pexels/index.ts (ONE_RENDITION_IS_CHOSEN_HERE);
 *        choosing between whole CLIPS is a decision about what makes a good
 *        vertical video, which is the product's own and is identical whichever
 *        library the clips came from. Keeping it pure means the rule is
 *        unit-testable with no key, no network and no spend — which matters
 *        more here than almost anywhere, because the alternative way to find
 *        out whether the rule is any good is to watch a generated video.
 *
 *        COVERAGE_BEATS_RESOLUTION is the ordering that drives everything
 *        below. A clip at least as long as the block it sits under plays once
 *        and holds; a shorter one is LOOPED (LOOP_IS_A_MODULO), and a visible
 *        repeat is the single most obvious tell that a video was assembled by a
 *        machine. A 720-tall clip that covers the block looks better on a phone
 *        than a 4K clip that stutters three times under it, so coverage is
 *        weighted an order of magnitude above pixel height.
 *
 *        LANDSCAPE_IS_REFUSED outright rather than penalised. The search
 *        already asked for portrait (PORTRAIT_IS_NOT_A_FILTER), so a landscape
 *        result means the provider ignored the parameter — and a landscape clip
 *        cropped to 9:16 keeps a third of the frame and usually loses the
 *        subject. Refusing lets the block fall through to a generated image,
 *        which is drawn vertical by construction.
 *
 *        UNKNOWN_IS_NOT_PENALISED. A missing duration or missing dimensions
 *        scores NEUTRAL, not zero. Not every provider reports them, and a rule
 *        that punished silence would systematically prefer whichever library
 *        happens to be chattier about its metadata — which has nothing to do
 *        with which clip is better.
 *
 *        TIE_BREAK_IS_DETERMINISTIC, and it is load-bearing rather than tidy.
 *        Two clips with the same score must resolve the same way on every run,
 *        because the pick ends up in a document whose hash decides whether a
 *        paid render is reused (RENDER_REUSE). A tie broken by array order is
 *        a tie broken by whatever the provider felt like returning that minute,
 *        which would make an unchanged project re-render for nothing.
 *
 *        PURE — no Prisma, no network, no `server-only`, no clock, no
 *        randomness. The same discipline as src/lib/credits/estimate.ts.
 * WHERE: `resolveBlockVisual` in src/services/visuals.service.ts, and the
 *        candidate ordering the swap UI shows.
 */

import type { StockResult } from "@/lib/adapters/stock/types";

/**
 * SOURCE OF TRUTH KEYWORDS: StockScoreInput, SCORE_TAKES_FACTS
 *
 * WHAT:  Everything that can change which clip is best.
 * WHY:   SCORE_TAKES_FACTS — the candidate and the length of the block it would
 *        sit under. Not a `ScriptBlock`, not a document, not a project: the
 *        same reasoning as ESTIMATE_TAKES_FACTS. The caller extracts the facts;
 *        this does the judging.
 * WHERE: `scoreStockResult`.
 */
export interface StockScoreInput {
  result: StockResult;
  /** How many seconds of narration this clip has to cover. */
  blockSeconds: number;
}

/** Weights. Separated so the ordering argument in the header is checkable. */
const COVERAGE_WEIGHT = 1_000;
const PORTRAIT_WEIGHT = 200;
const HEIGHT_WEIGHT = 1 / 10;

/** Below this, a clip reads as low-resolution on a phone. */
const COMFORTABLE_HEIGHT = 1_080;

/**
 * SOURCE OF TRUTH KEYWORDS: UNKNOWN_CREDIT, UNKNOWN_IS_NOT_PENALISED,
 *   NEUTRAL_IS_THE_MIDDLE_NOT_ZERO
 *
 * WHAT:  The share of a term's weight a clip gets when the provider did not
 *        report the fact that term measures.
 *
 * WHY:   NEUTRAL_IS_THE_MIDDLE_NOT_ZERO, and it is worth writing down because
 *        the obvious value is wrong. Scoring an unknown as ZERO is not neutral,
 *        it is the WORST possible score — so a clip of unreported length would
 *        lose to one that is known to cover an eighth of the block and
 *        therefore known to stutter seven times. That is backwards: a known-bad
 *        clip is bad, and an unknown one might be fine.
 *
 *        Half the weight is the honest reading of "we do not know": it beats
 *        every candidate measured as worse than half, loses to every candidate
 *        measured as better, and so never systematically prefers whichever
 *        library happens to be chattier about its metadata — which is the thing
 *        UNKNOWN_IS_NOT_PENALISED is actually guarding against.
 * WHERE: Every term of `scoreStockResult` that can be missing.
 */
const UNKNOWN_CREDIT = 0.5;

/**
 * SOURCE OF TRUTH KEYWORDS: scoreStockResult, COVERAGE_BEATS_RESOLUTION,
 *   UNKNOWN_IS_NOT_PENALISED
 *
 * WHAT:  How good this clip is for a block of this length. Higher is better.
 * WHY:   Three terms, in the order the file header argues for. Exported so the
 *        weighting is testable directly rather than only through the winner —
 *        a rule that happens to pick the right clip for the wrong reason is one
 *        that breaks on the next candidate set.
 * WHERE: `pickBestStockResult`; its own test.
 */
export function scoreStockResult(input: StockScoreInput): number {
  const { result, blockSeconds } = input;

  let score = 0;

  /* COVERAGE — the dominant term. A clip that covers the block never loops. */
  if (result.durationSec === undefined) {
    score += COVERAGE_WEIGHT * UNKNOWN_CREDIT;
  } else if (result.durationSec >= blockSeconds) {
    score += COVERAGE_WEIGHT;
  } else {
    /* Partial credit, proportional to how much it covers: a clip at 90% of the
     * block loops once and barely shows it, and one at 20% loops five times. */
    const ratio =
      blockSeconds > 0
        ? Math.max(0, Math.min(1, result.durationSec / blockSeconds))
        : 0;
    score += COVERAGE_WEIGHT * ratio;
  }

  /* SHAPE — a taller-than-wide clip fills a vertical frame with no crop. */
  if (result.width !== undefined && result.height !== undefined) {
    if (result.height > result.width) score += PORTRAIT_WEIGHT;
  } else {
    score += PORTRAIT_WEIGHT * UNKNOWN_CREDIT;
  }

  /* RESOLUTION — the weakest term, and capped: beyond the comfortable height
   * the extra pixels are discarded by the transcode (VERTICAL_MASTER), so
   * rewarding them would prefer a bigger download for an identical frame. */
  if (result.height !== undefined) {
    score += Math.min(result.height, COMFORTABLE_HEIGHT) * HEIGHT_WEIGHT;
  } else {
    score += COMFORTABLE_HEIGHT * HEIGHT_WEIGHT * UNKNOWN_CREDIT;
  }

  return score;
}

/**
 * SOURCE OF TRUTH KEYWORDS: pickBestStockResult, LANDSCAPE_IS_REFUSED,
 *   TIE_BREAK_IS_DETERMINISTIC
 *
 * WHAT:  The best usable clip, or null when none of them is usable.
 *
 * WHY:   Returns NULL rather than the least bad option, which is the whole
 *        reason the chain exists: a block with no usable clip falls through to
 *        a generated image, and a generated image beats a landscape clip
 *        cropped to a third of itself. "Usable" is two checks — a real download
 *        URL, and not landscape when the shape is known
 *        (LANDSCAPE_IS_REFUSED).
 *
 *        The tie-break compares `providerId` as a STRING, which is stable for
 *        the life of the clip and identical on every run — see
 *        TIE_BREAK_IS_DETERMINISTIC in the file header for why that matters to
 *        the render cache.
 * WHERE: `resolveBlockVisual` in src/services/visuals.service.ts.
 */
export function pickBestStockResult(
  results: readonly StockResult[],
  blockSeconds: number,
): StockResult | null {
  let best: { result: StockResult; score: number } | null = null;

  for (const result of results) {
    if (result.downloadUrl.length === 0) continue;
    /* LANDSCAPE_IS_REFUSED — only when the shape is actually known. */
    if (
      result.width !== undefined &&
      result.height !== undefined &&
      result.height <= result.width
    ) {
      continue;
    }

    const score = scoreStockResult({ result, blockSeconds });

    if (
      best === null ||
      score > best.score ||
      (score === best.score &&
        result.providerId.localeCompare(best.result.providerId) < 0)
    ) {
      best = { result, score };
    }
  }

  return best === null ? null : best.result;
}

/**
 * SOURCE OF TRUTH KEYWORDS: orderStockResults, PICKER_SHOWS_THE_SAME_ORDER
 *
 * WHAT:  Every candidate, best first, for the swap UI's grid.
 *
 * WHY:   PICKER_SHOWS_THE_SAME_ORDER. The grid is ordered by the SAME score the
 *        automatic pick uses, so the tile the chain chose is the first one a
 *        customer sees — and when they disagree with it, the alternatives are
 *        ranked by the same reasoning rather than by the provider's relevance
 *        ordering. Two different orderings would make "why did it pick that
 *        one" unanswerable.
 *
 *        Landscape results are kept here, unlike in `pickBestStockResult`,
 *        because a customer looking at a grid can see for themselves that a
 *        clip is wide — and LOCKED_NOT_HIDDEN's reasoning applies: removing an
 *        option a person can evaluate is worse than showing it ranked last.
 * WHERE: `visuals.searchStock`.
 */
export function orderStockResults(
  results: readonly StockResult[],
  blockSeconds: number,
): StockResult[] {
  return [...results].sort((a, b) => {
    const delta =
      scoreStockResult({ result: b, blockSeconds }) -
      scoreStockResult({ result: a, blockSeconds });
    if (delta !== 0) return delta;
    return a.providerId.localeCompare(b.providerId);
  });
}
