/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: alignment test, ALIGN_BACK_TO_SCRIPT,
 *   MANY_HEARD_TO_ONE_WRITTEN, INTERPOLATE_THE_UNHEARD, DEGRADE_NEVER_FAIL,
 *   ALIGNMENT_CACHE_KEY, WORD_INDEX_IS_THE_POSITION
 *
 * WHAT:  The three decisions in this phase that can be wrong without anything
 *        erroring: the back-match to the script, the degrade distribution and
 *        the cache key.
 * WHY:   None of them needs a provider, which is the point of keeping them
 *        pure. The cases here are the ones the phase names by example — the
 *        customer typed `AITA` and the model heard `ay eye tee ay`.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import {
  alignmentAudioHash,
  concatAlignedLines,
  distributeEvenly,
  normaliseToken,
  reconcileToScript,
  tokenizeScript,
  type HeardWord,
} from "./index";

function heard(...spec: [string, number, number][]): HeardWord[] {
  return spec.map(([w, s, e]) => ({ w, s, e }));
}

describe("tokenizeScript", () => {
  it("splits on whitespace only, so Dr. and 4.2 survive whole", () => {
    expect(tokenizeScript("Dr. Chen said 4.2 percent.").map((t) => t.raw)).toEqual(
      ["Dr.", "Chen", "said", "4.2", "percent."],
    );
  });

  it("keeps punctuation on the display form and strips it from the match form", () => {
    const [first] = tokenizeScript("“Stop!”");
    expect(first?.raw).toBe("“Stop!”");
    expect(first?.norm).toBe("stop");
  });

  it("folds diacritics so an unaccented transcript still matches", () => {
    expect(normaliseToken("café")).toBe("cafe");
  });
});

describe("reconcileToScript", () => {
  it("returns the words the customer WROTE, not the ones the model heard", () => {
    const words = reconcileToScript(
      heard(["the", 0, 0.3], ["landlord", 0.3, 0.9], ["called", 0.9, 1.3]),
      "The landlord called.",
    );
    expect(words.map((word) => word.w)).toEqual([
      "The",
      "landlord",
      "called.",
    ]);
  });

  /**
   * SOURCE OF TRUTH KEYWORDS: MANY_HEARD_TO_ONE_WRITTEN
   *
   * The phase's own example: "The user typed AITA; the model hears ay eye tee
   * ay." The written word must hold the screen for as long as the expansion
   * was spoken, or the caption flashes and the next one starts early.
   */
  it("absorbs an expanded acronym into the one word that was written", () => {
    const words = reconcileToScript(
      heard(
        ["ay", 0, 0.2],
        ["eye", 0.2, 0.4],
        ["tee", 0.4, 0.6],
        ["ay", 0.6, 0.8],
        ["my", 0.8, 1],
        ["landlord", 1, 1.6],
      ),
      "AITA my landlord",
    );

    expect(words.map((word) => word.w)).toEqual(["AITA", "my", "landlord"]);
    const acronym = words[0];
    expect(acronym?.s).toBeCloseTo(0, 2);
    /* It covers the whole expansion, not a fifth of it. */
    expect(acronym?.e).toBeGreaterThanOrEqual(0.75);
    expect(words[1]?.s).toBeGreaterThanOrEqual(acronym?.e ?? 0);
  });

  it("keeps the customer's spelling when the model misheard a word", () => {
    const words = reconcileToScript(
      heard(["their", 0, 0.3], ["lanlord", 0.3, 0.9], ["left", 0.9, 1.2]),
      "There, landlord left.",
    );
    expect(words.map((word) => word.w)).toEqual([
      "There,",
      "landlord",
      "left.",
    ]);
    /* And the misheard word still carries its measured timing rather than an
     * interpolated one. */
    expect(words[1]?.s).toBeCloseTo(0.3, 2);
    expect(words[1]?.e).toBeCloseTo(0.9, 2);
  });

  /**
   * SOURCE OF TRUTH KEYWORDS: INTERPOLATE_THE_UNHEARD
   */
  it("interpolates a word the aligner never produced, inside its neighbours", () => {
    const words = reconcileToScript(
      heard(["hello", 0, 0.4], ["world", 1.4, 1.8]),
      "hello extraordinarily big world",
    );
    expect(words).toHaveLength(4);
    const [, long, small] = words;
    expect(long?.s).toBeGreaterThanOrEqual(0.4);
    expect(small?.e).toBeLessThanOrEqual(1.4001);
    /* Weighted by length: the long word gets more of the gap than `big`. */
    const longSpan = (long?.e ?? 0) - (long?.s ?? 0);
    const smallSpan = (small?.e ?? 0) - (small?.s ?? 0);
    expect(longSpan).toBeGreaterThan(smallSpan);
  });

  it("never produces a word that ends before it starts, or out of order", () => {
    const words = reconcileToScript(
      heard(["a", 0.5, 0.5], ["b", 0.4, 0.45], ["c", 0.9, 1]),
      "alpha beta gamma delta",
    );
    let previous = -1;
    for (const word of words) {
      expect(word.e).toBeGreaterThan(word.s);
      expect(word.s).toBeGreaterThanOrEqual(previous);
      previous = word.s;
    }
  });

  it("indexes every word by its own position", () => {
    const words = reconcileToScript(
      heard(["one", 0, 0.2], ["two", 0.2, 0.4], ["three", 0.4, 0.6]),
      "one two three",
    );
    expect(words.map((word) => word.i)).toEqual([0, 1, 2]);
  });

  it("returns nothing when there is no transcript, leaving the caller to degrade", () => {
    expect(reconcileToScript([], "something was said")).toEqual([]);
    expect(reconcileToScript(heard(["x", 0, 1]), "")).toEqual([]);
  });

  it("handles a transcript far longer than the script without drifting", () => {
    /* The model hallucinated a run of filler in the middle. The words after
     * it must still land on their measured times, not three seconds late. */
    const words = reconcileToScript(
      heard(
        ["start", 0, 0.5],
        ["um", 0.5, 0.8],
        ["uh", 0.8, 1.1],
        ["you", 1.1, 1.3],
        ["know", 1.3, 1.5],
        ["finish", 3, 3.5],
      ),
      "start finish",
    );
    expect(words.map((word) => word.w)).toEqual(["start", "finish"]);
    expect(words[1]?.s).toBeCloseTo(3, 1);
  });
});

describe("distributeEvenly", () => {
  it("spreads the words across the measured duration, weighted by length", () => {
    const words = distributeEvenly("a extraordinarily b", 6);
    expect(words).toHaveLength(3);
    expect(words[0]?.s).toBe(0);
    expect(words[2]?.e).toBeCloseTo(6, 3);

    const longSpan = (words[1]?.e ?? 0) - (words[1]?.s ?? 0);
    const shortSpan = (words[0]?.e ?? 0) - (words[0]?.s ?? 0);
    expect(longSpan).toBeGreaterThan(shortSpan * 3);
  });

  it("covers the whole duration with no gaps between words", () => {
    const words = distributeEvenly("one two three four five", 10);
    for (let i = 1; i < words.length; i += 1) {
      expect(words[i]?.s).toBeCloseTo(words[i - 1]?.e ?? -1, 3);
    }
  });

  it("is empty for an empty line rather than one zero-length word", () => {
    expect(distributeEvenly("   ", 5)).toEqual([]);
  });
});

describe("concatAlignedLines", () => {
  /**
   * SOURCE OF TRUTH KEYWORDS: WORD_INDEX_IS_THE_POSITION
   */
  it("offsets each line and re-indexes the whole narration", () => {
    const first = distributeEvenly("one two", 2);
    const second = distributeEvenly("three four", 2);

    const all = concatAlignedLines([
      { words: first, offsetSec: 0, speaker: "narrator" },
      { words: second, offsetSec: 2, speaker: "guest" },
    ]);

    expect(all.map((word) => word.i)).toEqual([0, 1, 2, 3]);
    expect(all.map((word) => word.speaker)).toEqual([
      "narrator",
      "narrator",
      "guest",
      "guest",
    ]);
    expect(all[2]?.s).toBeGreaterThanOrEqual(2);
    /* Monotonic across the join, which is the thing an offset gets wrong. */
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i]?.s).toBeGreaterThanOrEqual(all[i - 1]?.s ?? 0);
    }
  });
});

describe("alignmentAudioHash", () => {
  it("is stable for the same lines in the same order", () => {
    const lines = [
      { position: 0, textHash: "aaaa" },
      { position: 1, textHash: "bbbb" },
    ];
    expect(alignmentAudioHash(lines)).toBe(alignmentAudioHash(lines));
  });

  it("changes when one line is re-recorded", () => {
    const before = alignmentAudioHash([
      { position: 0, textHash: "aaaa" },
      { position: 1, textHash: "bbbb" },
    ]);
    const after = alignmentAudioHash([
      { position: 0, textHash: "aaaa" },
      { position: 1, textHash: "cccc" },
    ]);
    expect(after).not.toBe(before);
  });

  it("changes when the same lines are re-ordered", () => {
    const forwards = alignmentAudioHash([
      { position: 0, textHash: "aaaa" },
      { position: 1, textHash: "bbbb" },
    ]);
    const backwards = alignmentAudioHash([
      { position: 0, textHash: "bbbb" },
      { position: 1, textHash: "aaaa" },
    ]);
    expect(backwards).not.toBe(forwards);
  });

  it("cannot be fooled by a concatenation that happens to line up", () => {
    const a = alignmentAudioHash([{ position: 0, textHash: "ab" }]);
    const b = alignmentAudioHash([{ position: 0, textHash: "a" }]);
    expect(a).not.toBe(b);
  });

  it("is stable for a narration with no lines yet", () => {
    expect(alignmentAudioHash([])).toBe(alignmentAudioHash([]));
  });
});
