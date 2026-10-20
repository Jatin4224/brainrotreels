/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: buildWords, FIXTURE_WORD_CADENCE
 *
 * WHAT:  Turns a sentence into word tokens with plausible timings.
 * WHY:   FIXTURE_WORD_CADENCE. Hand-writing 40 tokens per fixture is how a
 *        fixture's `i` drifts from its index and a test starts asserting on a
 *        document that validate() would reject. Timings are proportional to
 *        word length so the fixtures exercise the same uneven cadence that
 *        setCaptionText's redistribution has to preserve — a uniform grid would
 *        let a bug in that maths pass.
 * WHERE: Every fixture in this folder.
 */

import type { WordToken } from "../schema";

/* Seconds per character, plus a fixed cost per word for the gap between them.
 * Chosen to land a typical sentence near real narration pace. */
const SECONDS_PER_CHARACTER = 0.055;
const SECONDS_PER_WORD = 0.08;

export function buildWords(
  text: string,
  options: { startAt?: number; speaker?: string } = {},
): WordToken[] {
  const { startAt = 0, speaker } = options;
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const out: WordToken[] = [];
  let cursor = startAt;

  tokens.forEach((word, index) => {
    const duration = round(
      word.length * SECONDS_PER_CHARACTER + SECONDS_PER_WORD,
    );
    const token: WordToken = {
      i: index,
      w: word,
      s: round(cursor),
      e: round(cursor + duration),
    };
    if (speaker !== undefined) token.speaker = speaker;
    out.push(token);
    cursor = cursor + duration;
  });

  return out;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
