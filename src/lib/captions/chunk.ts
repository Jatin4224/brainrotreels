/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: groupWords, WordChunk, GROUPING_IS_TWO_TO_FOUR,
 *   BREAK_ON_PUNCTUATION, NEVER_SPLIT_A_HYPHENATED_WORD, BREAK_ON_A_PAUSE,
 *   NO_ORPHAN_CHUNK, GROUPING_IS_PURE
 *
 * WHAT:  Turns a flat list of timed words into the groups that each become one
 *        on-screen caption card.
 *
 * WHY:   GROUPING_IS_PURE, and that is the property the whole phase leans on:
 *        this function reads the words' TEXT and their GAPS and returns
 *        INDEX RANGES. It never reads a style's colours and never writes a
 *        time, which is what makes "changing the style provably does not
 *        change the timing" testable rather than asserted — the only input a
 *        restyle changes is `maxWords`, and the output is still ranges over
 *        the same unmodified words.
 *
 *        BREAK_ON_PUNCTUATION, the phase's step 7. A card that runs across a
 *        full stop puts the end of one sentence and the start of the next on
 *        screen together, which reads as a single garbled thought at the
 *        third of a second a caption is actually on screen for.
 *
 *        BREAK_ON_A_PAUSE is not in the phase and is needed anyway: narration
 *        has pauses that carry no punctuation — a dramatic beat, a breath
 *        before a list — and a card spanning one sits frozen on screen for the
 *        whole silence with its last word already spoken. The threshold is
 *        generous, so ordinary speech rhythm does not shatter the grouping.
 *
 *        NEVER_SPLIT_A_HYPHENATED_WORD, also the phase's step 7. Aligners
 *        routinely emit `well-` and `known` as two tokens, and a break
 *        between them ends a card on a dangling hyphen. The join is forced
 *        even past the word limit, because a five-word card is a cosmetic
 *        problem and `well-` alone on screen is a broken one.
 *
 *        NO_ORPHAN_CHUNK: a trailing single word is pulled back into company
 *        by moving one word from the previous card, but ONLY when the break
 *        between them was a soft length break. Rebalancing across a full stop
 *        would undo BREAK_ON_PUNCTUATION to fix a cosmetic problem.
 * WHERE: buildCaptionTrack. Tested directly in build-track.test.ts.
 */

import type { WordToken } from "@/lib/timeline";

/**
 * SOURCE OF TRUTH KEYWORDS: WordChunk
 *
 * WHAT:  One card's worth of words, as a half-open range over `doc.words`.
 * WHY:   `endWord` is INCLUSIVE, matching `captionItemSchema.endWord` and
 *        `captionRangeSeconds`, so the two cannot disagree about whether a
 *        one-word caption is `[3,3]` or `[3,4]` — which is a one-word
 *        off-by-one that shows up as the caption disappearing a word early.
 * WHERE: Returned by groupWords; converted to caption items by
 *        buildCaptionTrack.
 */
export interface WordChunk {
  startWord: number;
  /** Inclusive — see the WHY above. */
  endWord: number;
  /** True when the card was ended by punctuation or a pause, not by length. */
  hardBreak: boolean;
}

/**
 * SOURCE OF TRUTH KEYWORDS: PAUSE_BREAK_SECONDS, BREAK_ON_A_PAUSE
 *
 * Six tenths of a second of silence is a beat, not a rhythm. Shorter than
 * this and ordinary speech would end a card on every comma-less clause.
 */
export const PAUSE_BREAK_SECONDS = 0.6;

/* Sentence and clause enders. The ellipsis is listed as both the character
 * and three dots because transcripts carry either. */
const BREAKING_PUNCTUATION = /[.!?,;:—](["')\]]*)$|\.\.\.$|…$/;

/**
 * SOURCE OF TRUTH KEYWORDS: groupWords, GROUPING_IS_TWO_TO_FOUR
 *
 * WHAT:  The cards, in order, covering every word exactly once.
 * WHY:   Every word appears in exactly one chunk and no index is skipped —
 *        a gap would be a word that is spoken and never captioned, which is
 *        invisible in a unit test that only checks the first chunk and
 *        obvious to a viewer. Asserted directly.
 * WHERE: buildCaptionTrack.
 */
export function groupWords(
  words: readonly WordToken[],
  maxWords: number,
): WordChunk[] {
  if (words.length === 0) return [];

  const limit = Math.max(1, Math.floor(maxWords));
  const chunks: WordChunk[] = [];

  let start = 0;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = words[i + 1];
    if (word === undefined) continue;

    const isLast = next === undefined;
    /* NEVER_SPLIT_A_HYPHENATED_WORD — a trailing or leading hyphen means the
     * two tokens are one word, so no break may fall between them whatever
     * the limit says. */
    const joinedToNext =
      !isLast && (word.w.endsWith("-") || next.w.startsWith("-"));

    if (isLast) {
      chunks.push({ startWord: start, endWord: i, hardBreak: true });
      break;
    }
    if (joinedToNext) continue;

    const full = i - start + 1 >= limit;
    const punctuated = BREAKING_PUNCTUATION.test(word.w);
    const paused = next.s - word.e >= PAUSE_BREAK_SECONDS;

    if (full || punctuated || paused) {
      chunks.push({
        startWord: start,
        endWord: i,
        hardBreak: punctuated || paused,
      });
      start = i + 1;
    }
  }

  return rebalanceOrphan(chunks);
}

/**
 * SOURCE OF TRUTH KEYWORDS: rebalanceOrphan, NO_ORPHAN_CHUNK
 *
 * WHAT:  Moves one word back onto a trailing single-word card.
 * WHY:   A lone word flashing on screen after a full card reads as a glitch.
 *        Only applied when the previous break was SOFT: a card ending in a
 *        full stop is where the grouping is meant to break, and undoing that
 *        to tidy the last card trades a correctness rule for a cosmetic one.
 *        Only the LAST card is considered, because an orphan anywhere else
 *        is a punctuation break and therefore intentional.
 * WHERE: groupWords.
 */
function rebalanceOrphan(chunks: WordChunk[]): WordChunk[] {
  if (chunks.length < 2) return chunks;

  const last = chunks[chunks.length - 1];
  const previous = chunks[chunks.length - 2];
  if (last === undefined || previous === undefined) return chunks;

  const lastLength = last.endWord - last.startWord + 1;
  const previousLength = previous.endWord - previous.startWord + 1;

  if (lastLength !== 1 || previous.hardBreak || previousLength < 3) {
    return chunks;
  }

  chunks[chunks.length - 2] = { ...previous, endWord: previous.endWord - 1 };
  chunks[chunks.length - 1] = { ...last, startWord: last.startWord - 1 };
  return chunks;
}
