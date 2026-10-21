/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: reconcileToScript, HeardWord, ALIGN_BACK_TO_SCRIPT,
 *   MANY_HEARD_TO_ONE_WRITTEN, INTERPOLATE_THE_UNHEARD, MONOTONIC_TIMES,
 *   NEEDLEMAN_WUNSCH
 *
 * WHAT:  Takes what the aligner HEARD, with its timings, and the script the
 *        customer WROTE, and returns the written words carrying the heard
 *        timings.
 *
 * WHY:   ALIGN_BACK_TO_SCRIPT is the phase's step 2 and it is not a polish
 *        step. A transcript is what a model thought it heard: `AITA` comes
 *        back as `ay eye tee ay`, `2024` as `twenty twenty four`, a brand
 *        name as whatever is closest in the model's vocabulary, and every
 *        capital and comma the customer typed is gone. Captioning the
 *        transcript means captioning a DIFFERENT SCRIPT from the one on the
 *        screen behind it — and nothing errors, because the words are
 *        perfectly well-formed. So the transcript is used for its TIMINGS
 *        only, and the text is always the customer's.
 *
 *        NEEDLEMAN_WUNSCH rather than a two-pointer walk. The naive walk
 *        works until the first mismatch and then drifts for the rest of the
 *        line, which is the failure that looks fine in a demo and desynchro-
 *        nises a real script at the first number. Global alignment with gaps
 *        recovers: a run of unmatched tokens costs a gap and the next real
 *        match pulls both sides back into step. Cost is O(script × heard) per
 *        LINE — a line is a sentence or two, so the matrix is tiny, and the
 *        whole narration is never aligned as one block.
 *
 *        MANY_HEARD_TO_ONE_WRITTEN. `AITA` matches at most one of the four
 *        tokens it was heard as; the other three would otherwise be dropped
 *        and their time with them, so the word would end a third of a second
 *        after it started and the caption would flash. Unmatched HEARD tokens
 *        are therefore absorbed into the written word on either side,
 *        extending its span. That is what makes an expanded acronym land on
 *        the word being spoken for as long as it is being spoken.
 *
 *        INTERPOLATE_THE_UNHEARD: a written word the aligner never produced —
 *        a word swallowed in fast speech — gets a slice of the gap between
 *        its neighbours, weighted by its length. It is a guess, and a guess
 *        inside a half-second gap between two measured words is bounded by
 *        two correct timings; the alternative is a word with no timing at
 *        all, which a caption cannot be built from.
 *
 *        MONOTONIC_TIMES: the output is forced non-decreasing and every word
 *        gets a positive duration, because the document's validator and the
 *        frame planner both assume it, and a provider is perfectly capable of
 *        returning two words with the same timestamp.
 * WHERE: src/services/alignment.service.ts, per narration line. Pure — no
 *        provider, no database — so every one of these cases is unit tested.
 */

import type { WordToken } from "@/lib/timeline";
import { tokenizeScript, type ScriptToken } from "./tokenize";

/**
 * SOURCE OF TRUTH KEYWORDS: HeardWord
 *
 * WHAT:  One word as the aligner reported it.
 * WHY:   Deliberately NOT a WordToken. A heard word has no index into
 *        `doc.words` — it is not in the document and may never be, since the
 *        document carries the written words. Using the same type for both is
 *        how a transcript ends up stored as the script.
 * WHERE: Returned by the STT adapter; consumed here only.
 */
export interface HeardWord {
  w: string;
  s: number;
  e: number;
}

/* Scores for the alignment matrix. A near match (one is a prefix of the
 * other, or they differ by a single character) scores above a gap so the
 * matcher prefers pairing `landlords` with `landlord` to dropping both. */
const SCORE_EXACT = 3;
const SCORE_NEAR = 1;
const SCORE_MISMATCH = -2;
const SCORE_GAP = -1;

/**
 * SOURCE OF TRUTH KEYWORDS: reconcileToScript, ALIGN_BACK_TO_SCRIPT
 *
 * WHAT:  The customer's words, timed by the aligner.
 * WHY:   Returns a `WordToken[]` indexed from zero for THIS line. The caller
 *        offsets and re-indexes when it concatenates lines — doing it here
 *        would need this function to know where the line sits in the
 *        narration, which is exactly the coupling that keeps it untestable.
 *
 *        An EMPTY transcript is not an error here: it returns an evenly
 *        distributed line if a duration is known, and nothing if it is not.
 *        The degrade decision belongs to the caller (it is the thing that
 *        sets `degraded` on the row), so this function stays a pure mapping.
 * WHERE: The alignment service.
 */
export function reconcileToScript(
  heard: readonly HeardWord[],
  scriptText: string,
): WordToken[] {
  const script = tokenizeScript(scriptText);
  if (script.length === 0) return [];
  if (heard.length === 0) return [];

  const pairs = alignTokens(script, heard);

  /* [1] Every written word takes the span of the heard tokens it was paired
   *     with. A word paired with nothing is left open for step 2. */
  const spans: ({ s: number; e: number } | null)[] = script.map(() => null);
  for (let i = 0; i < pairs.length; i += 1) {
    const heardIndexes = pairs[i];
    if (heardIndexes === undefined || heardIndexes.length === 0) continue;

    const first = heard[heardIndexes[0] ?? 0];
    const last = heard[heardIndexes[heardIndexes.length - 1] ?? 0];
    if (first === undefined || last === undefined) continue;
    spans[i] = { s: first.s, e: last.e };
  }

  /* [2] INTERPOLATE_THE_UNHEARD — fill every remaining run from its
   *     neighbours, weighted by word length so a long word gets more of the
   *     gap than `a` does. */
  fillGaps(spans, script, bounds(heard));

  /* [3] MONOTONIC_TIMES. */
  return toWordTokens(script, spans);
}

/**
 * SOURCE OF TRUTH KEYWORDS: alignTokens, NEEDLEMAN_WUNSCH,
 *   MANY_HEARD_TO_ONE_WRITTEN
 *
 * WHAT:  For each script token, the indexes of the heard tokens that belong
 *        to it — usually one, sometimes several, sometimes none.
 * WHY:   Global alignment, then an absorption pass for the heard tokens the
 *        traceback left unpaired. Absorption prefers the PREVIOUS written
 *        word, because an expansion (`AITA` → four tokens) is spoken as a
 *        continuation of the word it expands, not as a run-up to the next
 *        one.
 * WHERE: reconcileToScript.
 */
function alignTokens(
  script: readonly ScriptToken[],
  heard: readonly HeardWord[],
): number[][] {
  const n = script.length;
  const m = heard.length;

  const heardNorm = heard.map((word) => normalise(word.w));

  /* (n+1) × (m+1), flattened. */
  const width = m + 1;
  const matrix = new Float64Array((n + 1) * width);
  for (let i = 1; i <= n; i += 1) matrix[i * width] = i * SCORE_GAP;
  for (let j = 1; j <= m; j += 1) matrix[j] = j * SCORE_GAP;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diagonal =
        (matrix[(i - 1) * width + (j - 1)] ?? 0) +
        pairScore(script[i - 1]?.norm ?? "", heardNorm[j - 1] ?? "");
      const up = (matrix[(i - 1) * width + j] ?? 0) + SCORE_GAP;
      const left = (matrix[i * width + (j - 1)] ?? 0) + SCORE_GAP;
      matrix[i * width + j] = Math.max(diagonal, up, left);
    }
  }

  const pairs: number[][] = script.map(() => []);
  /* Heard tokens the traceback did not pair, in order, so they can be
   * absorbed afterwards. */
  const orphans: number[] = [];

  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const score = matrix[i * width + j] ?? 0;
    const diagonal =
      (matrix[(i - 1) * width + (j - 1)] ?? 0) +
      pairScore(script[i - 1]?.norm ?? "", heardNorm[j - 1] ?? "");

    if (score === diagonal) {
      /* A MISMATCH pairing is still a pairing — the model heard a different
       * word in that slot, and its timing is the best evidence available for
       * where the written word is. */
      pairs[i - 1]?.push(j - 1);
      i -= 1;
      j -= 1;
      continue;
    }
    if (score === (matrix[(i - 1) * width + j] ?? 0) + SCORE_GAP) {
      i -= 1;
      continue;
    }
    orphans.push(j - 1);
    j -= 1;
  }
  while (j > 0) {
    orphans.push(j - 1);
    j -= 1;
  }

  for (const row of pairs) row.reverse();

  /* MANY_HEARD_TO_ONE_WRITTEN — absorb each orphan into the nearest written
   * word before it, falling back to the one after it for orphans at the very
   * start of the line. */
  for (const orphan of orphans) {
    const owner = ownerFor(pairs, orphan);
    if (owner === null) continue;
    pairs[owner]?.push(orphan);
  }
  for (const row of pairs) row.sort((a, b) => a - b);

  return pairs;
}

/**
 * SOURCE OF TRUTH KEYWORDS: ownerFor
 *
 * WHAT:  Which written word an unpaired heard token belongs to.
 * WHY:   The LAST written word whose own pairing starts before this orphan —
 *        i.e. the word being spoken when the orphan was heard. Scanning
 *        forward instead would attach `eye tee ay` to the word AFTER `AITA`,
 *        which stretches the wrong caption and starts it too early.
 * WHERE: alignTokens.
 */
function ownerFor(pairs: readonly number[][], orphan: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < pairs.length; i += 1) {
    const row = pairs[i];
    if (row === undefined || row.length === 0) continue;
    const first = row[0] ?? 0;
    if (first < orphan) best = i;
    else if (best === null) return i;
    else break;
  }
  return best;
}

/**
 * SOURCE OF TRUTH KEYWORDS: fillGaps, INTERPOLATE_THE_UNHEARD
 *
 * WHAT:  Gives every unpaired written word a slice of the silence around it.
 * WHY:   Weighted by character length, because "extraordinarily" takes longer
 *        to say than "of" and splitting the gap evenly puts the caption's
 *        highlight visibly ahead of the voice on the long word. The run is
 *        bounded by two MEASURED times at its ends, so the error cannot
 *        accumulate past the next real word.
 * WHERE: reconcileToScript, step 2.
 */
function fillGaps(
  spans: ({ s: number; e: number } | null)[],
  script: readonly ScriptToken[],
  limits: { start: number; end: number },
): void {
  let index = 0;
  while (index < spans.length) {
    if (spans[index] !== null) {
      index += 1;
      continue;
    }

    let runEnd = index;
    while (runEnd + 1 < spans.length && spans[runEnd + 1] === null) runEnd += 1;

    const before = index > 0 ? spans[index - 1] : null;
    const after = runEnd + 1 < spans.length ? spans[runEnd + 1] : null;
    const from = before?.e ?? limits.start;
    const to = after?.s ?? limits.end;

    const weights: number[] = [];
    let total = 0;
    for (let i = index; i <= runEnd; i += 1) {
      /* +1 so a one-character word still gets a share rather than zero. */
      const weight = (script[i]?.norm.length ?? 0) + 1;
      weights.push(weight);
      total += weight;
    }

    const available = Math.max(to - from, 0);
    let cursor = from;
    for (let i = index; i <= runEnd; i += 1) {
      const weight = weights[i - index] ?? 1;
      const slice = total > 0 ? (available * weight) / total : 0;
      spans[i] = { s: cursor, e: cursor + slice };
      cursor += slice;
    }

    index = runEnd + 1;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: toWordTokens, MONOTONIC_TIMES, MIN_WORD_SECONDS
 *
 * WHAT:  The final `WordToken[]`: indexed, ordered, and never zero-length.
 * WHY:   `i` is written to match the array position because the document's
 *        validator checks exactly that, and a word whose `i` has drifted
 *        mis-times every caption anchored past it. The minimum duration
 *        exists because an interpolated word inside a zero-length gap would
 *        otherwise start and end at the same instant — a caption the renderer
 *        shows for no frames at all.
 * WHERE: reconcileToScript, step 3.
 */
const MIN_WORD_SECONDS = 0.01;

function toWordTokens(
  script: readonly ScriptToken[],
  spans: readonly ({ s: number; e: number } | null)[],
): WordToken[] {
  const words: WordToken[] = [];
  let previousEnd = 0;

  for (let i = 0; i < script.length; i += 1) {
    const token = script[i];
    if (token === undefined) continue;
    const span = spans[i] ?? { s: previousEnd, e: previousEnd };

    const start = Math.max(span.s, previousEnd);
    const end = Math.max(span.e, start + MIN_WORD_SECONDS);

    words.push({
      i: words.length,
      w: token.raw,
      s: round(start),
      e: round(end),
    });
    previousEnd = end;
  }

  return words;
}

function bounds(heard: readonly HeardWord[]): { start: number; end: number } {
  const first = heard[0];
  const last = heard[heard.length - 1];
  return { start: first?.s ?? 0, end: last?.e ?? 0 };
}

function pairScore(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return SCORE_MISMATCH;
  if (a === b) return SCORE_EXACT;
  if (a.startsWith(b) || b.startsWith(a)) return SCORE_NEAR;
  if (a.length >= 4 && b.length >= 4 && differsByOne(a, b)) return SCORE_NEAR;
  return SCORE_MISMATCH;
}

/**
 * SOURCE OF TRUTH KEYWORDS: differsByOne
 *
 * A bounded edit-distance check rather than a full Levenshtein: the question
 * is only "is this the same word with a plural, a tense or a typo", and the
 * early exit keeps the matrix cheap on the one function that runs per cell.
 */
function differsByOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (shorter.length === longer.length) i += 1;
    j += 1;
  }

  return edits + (longer.length - j) <= 1;
}

function normalise(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
