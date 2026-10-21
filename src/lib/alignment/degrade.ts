/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: distributeEvenly, DEGRADE_NEVER_FAIL,
 *   WEIGHTED_BY_LENGTH, offsetWords, concatAlignedLines
 *
 * WHAT:  The fallback timing — words spread across a known duration — and the
 *        two functions that stitch per-line alignments into one narration.
 *
 * WHY:   DEGRADE_NEVER_FAIL is the phase's step 4 and it is a product
 *        decision, not an error-handling convenience: "a degraded video with
 *        a visible warning beats a failed pipeline". A customer whose STT
 *        provider had a bad minute still gets a video they can watch,
 *        re-align and publish; the alternative is a pipeline that stops after
 *        the expensive half — the script is written, the narration is
 *        recorded and paid for — and produces nothing.
 *
 *        WEIGHTED_BY_LENGTH rather than equal slices. Equal slices are
 *        noticeably wrong in a specific way: short function words hold the
 *        screen as long as the long nouns around them, so the captions run
 *        steadily ahead of the voice through a sentence and snap back at the
 *        end of it. Weighting by characters is still a guess, but it is a
 *        guess that tracks speech rather than fighting it.
 *
 *        The duration it distributes across is the MEASURED narration length
 *        (`NarrationLine.durationSec`, written from the normalised audio),
 *        never an estimate — so a degraded alignment is at least correct at
 *        the two ends and in total.
 * WHERE: The alignment service, when the provider has failed its retries.
 *        Pure, so the degrade path is unit tested without inducing a provider
 *        failure.
 */

import type { WordToken } from "@/lib/timeline";
import { tokenizeScript } from "./tokenize";

/**
 * SOURCE OF TRUTH KEYWORDS: distributeEvenly, DEGRADE_NEVER_FAIL
 *
 * WHAT:  Timings for a line nobody could align, spread across its duration.
 * WHY:   Takes the DURATION rather than a start and an end, so the caller
 *        cannot accidentally pass a line's absolute position and get words
 *        timed into the middle of the video. Offsetting is a separate,
 *        obvious step — see offsetWords.
 * WHERE: The alignment service's degrade path.
 */
export function distributeEvenly(
  scriptText: string,
  durationSec: number,
): WordToken[] {
  const tokens = tokenizeScript(scriptText);
  if (tokens.length === 0) return [];

  const total = Math.max(durationSec, 0);
  const weights = tokens.map((token) => (token.norm.length || 1) + 1);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

  const words: WordToken[] = [];
  let cursor = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) continue;
    const weight = weights[i] ?? 1;
    const slice = weightTotal > 0 ? (total * weight) / weightTotal : 0;

    words.push({
      i: words.length,
      w: token.raw,
      s: round(cursor),
      e: round(cursor + slice),
    });
    cursor += slice;
  }

  return words;
}

/**
 * SOURCE OF TRUTH KEYWORDS: offsetWords
 *
 * WHAT:  The same words, moved along the timeline.
 * WHY:   Alignment runs PER LINE, against that line's own audio file, so
 *        every line comes back starting at zero. The narration is those lines
 *        played in order, so each one's words are shifted by the total
 *        duration of the lines before it. Aligning the whole narration as one
 *        file was the alternative and it is worse in every direction: it
 *        needs the lines concatenated into a temporary file first, it
 *        re-aligns everything when one line is re-recorded, and it cannot
 *        attribute a word to a speaker.
 * WHERE: concatAlignedLines.
 */
export function offsetWords(
  words: readonly WordToken[],
  offsetSec: number,
  speaker?: string,
): WordToken[] {
  return words.map((word) => ({
    ...word,
    s: round(word.s + offsetSec),
    e: round(word.e + offsetSec),
    ...(speaker !== undefined ? { speaker } : {}),
  }));
}

/**
 * SOURCE OF TRUTH KEYWORDS: concatAlignedLines, WORD_INDEX_IS_THE_POSITION
 *
 * WHAT:  Every line's words as one narration-wide array, re-indexed.
 * WHY:   WORD_INDEX_IS_THE_POSITION. `WordToken.i` must equal the array
 *        index — the document's validator checks it and every caption item
 *        and motion anchor resolves against it. Each line's words are indexed
 *        from zero on their own, so concatenating without re-indexing
 *        produces a document where word 0 appears once per line and every
 *        anchor past the first line points at the wrong word.
 * WHERE: The alignment service, after every line is aligned or degraded.
 */
export function concatAlignedLines(
  lines: readonly {
    words: readonly WordToken[];
    offsetSec: number;
    speaker?: string | undefined;
  }[],
): WordToken[] {
  const all: WordToken[] = [];

  for (const line of lines) {
    for (const word of offsetWords(line.words, line.offsetSec, line.speaker)) {
      all.push({ ...word, i: all.length });
    }
  }

  return all;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
