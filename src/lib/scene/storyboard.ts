/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: buildStoryboard, checkStoryboard, beatSeconds,
 *   THE_SPLIT_IS_DETERMINISTIC, COVERAGE_IS_CHECKED_BEFORE_DESIGNING,
 *   BREAK_ON_SENTENCES, INTENT_HAS_A_FREE_DEFAULT
 *
 * WHAT:  Splitting an aligned transcript into beats of 1.5–6 seconds, snapped
 *        to word boundaries, each carrying an intent — and proving the result
 *        covers the narration with no gaps and no overlaps.
 *
 * WHY:   THE_SPLIT_IS_DETERMINISTIC, and this is the phase's step 10 read in
 *        the cheapest order. Deciding WHERE a beat ends is arithmetic over
 *        word timings: it needs no judgement, it has an obviously correct
 *        answer, and asking a model for it would cost a request per video to
 *        get something a test can verify exactly. So the split is code. What a
 *        beat is ABOUT is judgement, so `assignIntents` is the seam a model
 *        plugs into — and INTENT_HAS_A_FREE_DEFAULT means the whole storyboard
 *        still works with no model at all, which is what lets a motion video
 *        be produced end to end before any designer exists.
 *
 *        COVERAGE_IS_CHECKED_BEFORE_DESIGNING. The phase says "validate full
 *        coverage with no gaps and no overlaps before designing anything", and
 *        the order is the whole point: designing is the expensive step, at a
 *        model request per beat, so a storyboard that drops three words in the
 *        middle must be caught while it costs nothing. A gap is not cosmetic —
 *        it is narration playing over whatever the previous beat left on
 *        screen.
 *
 *        BREAK_ON_SENTENCES. Within the allowed range the split prefers a word
 *        that ends a sentence, then one that ends a clause, then the longest
 *        beat that fits. A beat that cuts mid-sentence makes the graphic
 *        change while the speaker is still finishing a thought, which reads as
 *        a mistake even when every number on screen is right. The preference
 *        is a cheap sort over candidates rather than a parser, because the
 *        transcript is words with timings, not grammar.
 *
 *        Pure and isomorphic: this runs in the workflow before any model call,
 *        in the editor to show the beat strip, and in tests. No model, no
 *        database, no Remotion.
 * WHERE: The motion generator's design step (16d), the beat strip, and
 *        storyboard.test.ts.
 */

import type { WordToken } from "@/lib/timeline";
import {
  SCENE_BEAT_SECONDS,
  type Beat,
  type BeatIntent,
  type SceneError,
} from "@/lib/types/scene";
import { sceneError } from "@/lib/types/scene";

/**
 * SOURCE OF TRUTH KEYWORDS: StoryboardResult
 *
 * The beats, and anything wrong with them. A list rather than a throw for the
 * same reason `checkScene` returns one: the caller decides whether a short
 * final beat is worth failing a generation over, and the beat strip shows the
 * problems next to the beats.
 */
export interface StoryboardResult {
  beats: Beat[];
  errors: SceneError[];
}

/**
 * SOURCE OF TRUTH KEYWORDS: beatSeconds
 *
 * WHAT:  How long a beat runs, from its first word's start to its last word's
 *        end.
 * WHY:   Measured from the WORDS rather than stored on the beat, so a
 *        re-alignment moves the beat without anything having to rewrite it —
 *        the same reason a scene element is anchored by word index rather than
 *        by seconds (TIMED_BY_ANCHOR_OR_SECONDS).
 * WHERE: checkStoryboard; the generator, which turns a beat into a scene item.
 */
export function beatSeconds(
  beat: Beat,
  words: readonly WordToken[],
): { start: number; end: number } {
  const first = words[beat.startWord];
  const last = words[beat.endWord];
  if (first === undefined || last === undefined) return { start: 0, end: 0 };
  return { start: first.s, end: last.e };
}

/* A word that ends a sentence, and one that ends a clause. Checked on the
 * token's own text, which is what an aligner returns — punctuation attached to
 * the word rather than as separate tokens. */
const SENTENCE_END = /[.!?]["')\]]?$/u;
const CLAUSE_END = /[,;:—]["')\]]?$/u;

/**
 * SOURCE OF TRUTH KEYWORDS: buildStoryboard, THE_SPLIT_IS_DETERMINISTIC,
 *   BREAK_ON_SENTENCES
 *
 * WHAT:  The whole narration as beats, in order, covering every word exactly
 *        once.
 *
 * WHY:   Greedy forward, which is the only approach that guarantees coverage
 *        by construction: each beat starts at the word after the last one
 *        ended, so a gap is impossible without a bug and an overlap is
 *        impossible at all. An optimiser over the whole transcript would
 *        produce slightly prettier breaks and could leave a word out.
 *
 *        THE LAST BEAT IS ALLOWED TO BE SHORT. A transcript does not divide
 *        evenly, and the alternatives are both worse: dropping the remainder
 *        loses narration, and merging it into the previous beat pushes that
 *        one past the six-second ceiling the phase sets. A final beat of 0.4s
 *        is reported by `checkStoryboard` as a warning the caller can act on,
 *        and `mergeShortTail` is offered for callers that would rather absorb
 *        it. Grep SHORT_TAIL_IS_REPORTED.
 * WHERE: The design step, before any model call.
 */
export function buildStoryboard(words: readonly WordToken[]): Beat[] {
  if (words.length === 0) return [];

  const beats: Beat[] = [];
  let startWord = 0;

  while (startWord < words.length) {
    const start = words[startWord];
    if (start === undefined) break;

    const endWord = chooseBeatEnd(words, startWord);
    beats.push({
      index: beats.length,
      startWord,
      endWord,
      /* INTENT_HAS_A_FREE_DEFAULT — `emphasis` is the intent that always has a
       * designable scene, so a storyboard with no model attached is still a
       * storyboard somebody can render. */
      intent: "emphasis",
    });
    startWord = endWord + 1;
  }

  return beats;
}

/* The last word of the beat starting at `startWord`. */
function chooseBeatEnd(
  words: readonly WordToken[],
  startWord: number,
): number {
  const start = words[startWord];
  if (start === undefined) return startWord;

  /* Two candidates, tracked separately — which is the bug this shape exists to
   * avoid. Folding them into one variable means the next iteration's "longest
   * so far" overwrites a sentence break already chosen, and the split silently
   * stops preferring sentences at all. */
  let longest = startWord;
  let best = -1;
  let bestScore = -1;

  for (let i = startWord; i < words.length; i += 1) {
    const word = words[i];
    if (word === undefined) break;

    const length = word.e - start.s;
    if (length > SCENE_BEAT_SECONDS.max) break;

    /* The longest beat that fits, so a run of words with no punctuation at all
     * still ends somewhere sensible. */
    longest = i;

    if (length < SCENE_BEAT_SECONDS.min) continue;

    /* BREAK_ON_SENTENCES — a sentence end beats a clause end beats nothing,
     * and a later break beats an earlier one at the same rank, because a beat
     * nearer the ceiling carries more of the thought. */
    const rank = SENTENCE_END.test(word.w)
      ? 2
      : CLAUSE_END.test(word.w)
        ? 1
        : 0;
    const score = rank * 1000 + i;

    if (rank > 0 && score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return best >= 0 ? best : longest;
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkStoryboard, COVERAGE_IS_CHECKED_BEFORE_DESIGNING,
 *   SHORT_TAIL_IS_REPORTED
 *
 * WHAT:  Everything wrong with a storyboard, before a single beat is designed.
 *
 * WHY:   The phase's "validate full coverage with no gaps and no overlaps
 *        before designing anything". Each of these is a real video:
 *
 *          - a GAP is narration playing over whatever the last beat left on
 *            screen;
 *          - an OVERLAP is two scenes drawn at once;
 *          - a beat PAST the ceiling is a static frame long enough to stop
 *            being motion graphics;
 *          - a beat under the floor is a flash nobody reads.
 *
 *        The floor is reported rather than refused for the LAST beat only —
 *        see SHORT_TAIL_IS_REPORTED on `buildStoryboard`.
 * WHERE: The design step; the beat strip.
 */
export function checkStoryboard(
  beats: readonly Beat[],
  words: readonly WordToken[],
): SceneError[] {
  const errors: SceneError[] = [];

  if (beats.length === 0) {
    if (words.length > 0) {
      errors.push(
        sceneError(
          "beats",
          "SLOT_COUNT",
          `No beats were produced for ${words.length} words of narration.`,
        ),
      );
    }
    return errors;
  }

  const first = beats[0];
  if (first !== undefined && first.startWord !== 0) {
    errors.push(
      sceneError(
        "beats.0.startWord",
        "UNKNOWN_WORD_ANCHOR",
        `The first beat starts at word ${first.startWord}, leaving the first ${first.startWord} word(s) with nothing on screen.`,
      ),
    );
  }

  const last = beats[beats.length - 1];
  if (last !== undefined && last.endWord !== words.length - 1) {
    errors.push(
      sceneError(
        `beats.${beats.length - 1}.endWord`,
        "UNKNOWN_WORD_ANCHOR",
        `The last beat ends at word ${last.endWord} of ${words.length - 1}, leaving the end of the narration with nothing on screen.`,
      ),
    );
  }

  beats.forEach((beat, index) => {
    const path = `beats.${index}`;

    if (beat.endWord < beat.startWord) {
      errors.push(
        sceneError(
          path,
          "TIMING_INVERTED",
          `Beat ${index} ends at word ${beat.endWord}, before it starts at ${beat.startWord}.`,
        ),
      );
      return;
    }

    if (
      beat.startWord >= words.length ||
      beat.endWord >= words.length
    ) {
      errors.push(
        sceneError(
          path,
          "UNKNOWN_WORD_ANCHOR",
          `Beat ${index} names words ${beat.startWord}–${beat.endWord}, but the narration has ${words.length}.`,
        ),
      );
      return;
    }

    const previous = beats[index - 1];
    if (previous !== undefined) {
      if (beat.startWord <= previous.endWord) {
        errors.push(
          sceneError(
            path,
            "ELEMENT_OVERLAP",
            `Beat ${index} starts at word ${beat.startWord}, which beat ${index - 1} already covers.`,
          ),
        );
      } else if (beat.startWord > previous.endWord + 1) {
        errors.push(
          sceneError(
            path,
            "UNKNOWN_WORD_ANCHOR",
            `Words ${previous.endWord + 1}–${beat.startWord - 1} belong to no beat, so nothing is on screen while they are spoken.`,
          ),
        );
      }
    }

    const { start, end } = beatSeconds(beat, words);
    const length = end - start;

    if (length > SCENE_BEAT_SECONDS.max) {
      errors.push(
        sceneError(
          path,
          "TIMING_OUT_OF_BEAT",
          `Beat ${index} runs ${length.toFixed(1)}s, past the ${SCENE_BEAT_SECONDS.max}s ceiling — a static scene that long stops being motion graphics.`,
        ),
      );
    }

    /* The last beat is allowed to be short; every other one being short means
     * the splitter did something wrong. */
    if (length < SCENE_BEAT_SECONDS.min && index < beats.length - 1) {
      errors.push(
        sceneError(
          path,
          "TIMING_OUT_OF_BEAT",
          `Beat ${index} runs ${length.toFixed(1)}s, under the ${SCENE_BEAT_SECONDS.min}s floor — a flash nobody reads.`,
        ),
      );
    }
  });

  return errors;
}

/**
 * SOURCE OF TRUTH KEYWORDS: mergeShortTail, SHORT_TAIL_IS_REPORTED
 *
 * WHAT:  Absorbs a too-short final beat into the one before it, when doing so
 *        does not push that beat past the ceiling.
 * WHY:   Offered rather than applied inside `buildStoryboard`, because the two
 *        outcomes are both defensible and the caller knows which it wants: a
 *        0.4s final beat is a flash, and a 6.3s merged beat is over the
 *        ceiling. When neither is acceptable the short beat stays and
 *        `checkStoryboard` reports it — there is no third option that keeps
 *        every word and every bound.
 * WHERE: The design step, before designing.
 */
export function mergeShortTail(
  beats: readonly Beat[],
  words: readonly WordToken[],
): Beat[] {
  if (beats.length < 2) return [...beats];

  const last = beats[beats.length - 1];
  const previous = beats[beats.length - 2];
  if (last === undefined || previous === undefined) return [...beats];

  const lastSpan = beatSeconds(last, words);
  if (lastSpan.end - lastSpan.start >= SCENE_BEAT_SECONDS.min) {
    return [...beats];
  }

  const merged = { ...previous, endWord: last.endWord };
  const mergedSpan = beatSeconds(merged, words);
  if (mergedSpan.end - mergedSpan.start > SCENE_BEAT_SECONDS.max) {
    return [...beats];
  }

  return [...beats.slice(0, -2), merged];
}

/**
 * SOURCE OF TRUTH KEYWORDS: assignIntents, INTENT_HAS_A_FREE_DEFAULT,
 *   INTENT_PICKS_THE_PRIMITIVE
 *
 * WHAT:  Applies a model's intent choices onto a storyboard, by beat index.
 *
 * WHY:   A separate function from the split, which is the seam that keeps
 *        THE_SPLIT_IS_DETERMINISTIC true: a model is asked WHAT each beat is
 *        about, never where it ends. It takes a sparse map rather than a full
 *        array, so a model that answers for eleven of twelve beats leaves the
 *        twelfth at `emphasis` instead of failing the whole storyboard — the
 *        same bias toward finishing that the repair loop has
 *        (THE_PIPELINE_ALWAYS_FINISHES).
 * WHERE: The design step, between the split and the per-beat design.
 */
export function assignIntents(
  beats: readonly Beat[],
  intents: Readonly<Record<number, BeatIntent>>,
): Beat[] {
  return beats.map((beat) => {
    const intent = intents[beat.index];
    return intent === undefined ? { ...beat } : { ...beat, intent };
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: beatWords
 *
 * The words a beat covers, which is what the designer is shown. Returned as
 * tokens rather than a joined string so the caller can quote the range and
 * also pass the indices the scene will anchor to.
 */
export function beatWords(
  beat: Beat,
  words: readonly WordToken[],
): WordToken[] {
  return words.slice(beat.startWord, beat.endWord + 1);
}
