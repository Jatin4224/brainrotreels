/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: storyboard test, COVERAGE_IS_CHECKED_BEFORE_DESIGNING,
 *   BREAK_ON_SENTENCES, THE_SPLIT_IS_DETERMINISTIC, FALLBACK_IS_ALWAYS_VALID,
 *   THE_PIPELINE_ALWAYS_FINISHES
 *
 * WHAT:  That the split covers every word exactly once, respects the phase's
 *        1.5–6 second range, prefers sentence boundaries — and that the
 *        fallback beat is valid for any narration it could be handed.
 *
 * WHY:   The coverage assertion is the phase's own "validate full coverage
 *        with no gaps and no overlaps before designing anything", and it is
 *        worth asserting over GENERATED transcripts rather than one fixture:
 *        a greedy splitter is easy to get right on a tidy example and wrong on
 *        a long run of unpunctuated words, or on a transcript whose last beat
 *        lands exactly on the ceiling.
 *
 *        FALLBACK_IS_ALWAYS_VALID is the other assertion that earns its place.
 *        The fallback exists so a failed design cannot break a video; a
 *        fallback that itself failed `checkScene` would do exactly that, and
 *        it would only show up on the beats where something had already gone
 *        wrong. So it is checked against hostile input — a very long stretch
 *        of narration, a single word, no words at all — at both aspects and
 *        in every safe zone.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import type { WordToken } from "@/lib/timeline";
import { SAFE_ZONES } from "@/lib/types/caption";
import { SCENE_BEAT_SECONDS, type SceneCheckContext } from "@/lib/types/scene";

import { checkScene } from "./check";
import { fallbackScene } from "./fallback";
import {
  assignIntents,
  beatSeconds,
  beatWords,
  buildStoryboard,
  checkStoryboard,
  mergeShortTail,
} from "./storyboard";

const PORTRAIT: SceneCheckContext = {
  canvas: { width: 1080, height: 1920, fps: 30 },
  safeZone: "none",
  wordCount: 0,
  durationSeconds: 4,
};

const LANDSCAPE: SceneCheckContext = {
  ...PORTRAIT,
  canvas: { width: 1920, height: 1080, fps: 30 },
};

/* A transcript of `count` words, each `perWord` seconds long, with a sentence
 * ending every `sentenceEvery` words. */
function transcript(args: {
  count: number;
  perWord?: number;
  sentenceEvery?: number;
}): WordToken[] {
  const { count, perWord = 0.35, sentenceEvery = 0 } = args;
  return Array.from({ length: count }, (_, i) => {
    const ends = sentenceEvery > 0 && (i + 1) % sentenceEvery === 0;
    return {
      i,
      w: ends ? `word${i}.` : `word${i}`,
      s: i * perWord,
      e: (i + 1) * perWord,
    };
  });
}

describe("the split", () => {
  it("covers every word exactly once, with no gaps and no overlaps", () => {
    /* COVERAGE_IS_CHECKED_BEFORE_DESIGNING, over a range of shapes rather than
     * one tidy fixture. */
    for (const count of [1, 2, 7, 23, 60, 141]) {
      for (const perWord of [0.12, 0.35, 0.8, 1.4]) {
        const words = transcript({ count, perWord, sentenceEvery: 9 });
        const beats = buildStoryboard(words);

        expect(checkStoryboard(beats, words), `${count}@${perWord}`).toEqual(
          [],
        );

        /* Said again directly, because the check could in principle agree with
         * a bug in the splitter: walk the beats and rebuild the word list. */
        const covered = beats.flatMap((beat) =>
          beatWords(beat, words).map((word) => word.i),
        );
        expect(covered, `${count}@${perWord}`).toEqual(
          words.map((word) => word.i),
        );
      }
    }
  });

  it("keeps every beat but the last inside the phase's range", () => {
    const words = transcript({ count: 90, sentenceEvery: 7 });
    const beats = buildStoryboard(words);

    beats.forEach((beat, index) => {
      const { start, end } = beatSeconds(beat, words);
      const length = end - start;
      expect(length, `beat ${index}`).toBeLessThanOrEqual(
        SCENE_BEAT_SECONDS.max + 1e-9,
      );
      if (index < beats.length - 1) {
        expect(length, `beat ${index}`).toBeGreaterThanOrEqual(
          SCENE_BEAT_SECONDS.min - 1e-9,
        );
      }
    });
  });

  it("breaks on a sentence end when one is in range", () => {
    /* BREAK_ON_SENTENCES. Words of 0.35s, so a sentence ending at word 8 falls
     * at 3.15s — comfortably inside 1.5–6s, and the split should take it over
     * the longer beat that would also have fitted. */
    const words = transcript({ count: 40, perWord: 0.35, sentenceEvery: 9 });
    const beats = buildStoryboard(words);
    const first = beats[0];

    expect(first).toBeDefined();
    expect(words[first?.endWord ?? 0]?.w).toMatch(/\.$/u);
  });

  it("still splits a long run with no punctuation at all", () => {
    /* The case a sentence-seeking splitter gets wrong: nothing to prefer, so
     * it has to fall back to the longest beat that fits. */
    const words = transcript({ count: 80, perWord: 0.3 });
    const beats = buildStoryboard(words);

    expect(beats.length).toBeGreaterThan(1);
    expect(checkStoryboard(beats, words)).toEqual([]);
  });

  it("handles a transcript shorter than one beat", () => {
    const words = transcript({ count: 2, perWord: 0.3 });
    const beats = buildStoryboard(words);

    expect(beats).toHaveLength(1);
    expect(beats[0]?.startWord).toBe(0);
    expect(beats[0]?.endWord).toBe(1);
    /* Under the floor, but it is the last beat — reported for a longer
     * transcript, allowed here. */
    expect(checkStoryboard(beats, words)).toEqual([]);
  });

  it("produces nothing for a silent document", () => {
    expect(buildStoryboard([])).toEqual([]);
    expect(checkStoryboard([], [])).toEqual([]);
  });

  it("splits one word per beat when every word is longer than the ceiling", () => {
    /* A pathological aligner result — a single word timed at eight seconds.
     * Coverage still has to hold; the ceiling is then reported rather than
     * silently dropping the word. */
    const words = transcript({ count: 3, perWord: 8 });
    const beats = buildStoryboard(words);

    expect(beats).toHaveLength(3);
    expect(checkStoryboard(beats, words).map((e) => e.code)).toContain(
      "TIMING_OUT_OF_BEAT",
    );
  });

  it("is deterministic", () => {
    /* THE_SPLIT_IS_DETERMINISTIC — the same transcript must storyboard the
     * same way, or "redesign one beat leaves the others byte-identical" is
     * false before any design happens. */
    const words = transcript({ count: 55, sentenceEvery: 6 });
    expect(buildStoryboard(words)).toEqual(buildStoryboard(words));
  });
});

describe("checkStoryboard", () => {
  const words = transcript({ count: 30, sentenceEvery: 5 });

  it("reports a gap between two beats", () => {
    const beats = [
      { index: 0, startWord: 0, endWord: 5, intent: "emphasis" as const },
      { index: 1, startWord: 8, endWord: 29, intent: "emphasis" as const },
    ];
    const errors = checkStoryboard(beats, words);

    expect(errors.map((e) => e.code)).toContain("UNKNOWN_WORD_ANCHOR");
    expect(errors.some((e) => e.message.includes("belong to no beat"))).toBe(
      true,
    );
  });

  it("reports an overlap between two beats", () => {
    const beats = [
      { index: 0, startWord: 0, endWord: 10, intent: "emphasis" as const },
      { index: 1, startWord: 7, endWord: 29, intent: "emphasis" as const },
    ];

    expect(checkStoryboard(beats, words).map((e) => e.code)).toContain(
      "ELEMENT_OVERLAP",
    );
  });

  it("reports narration left uncovered at either end", () => {
    const fromOne = checkStoryboard(
      [{ index: 0, startWord: 1, endWord: 29, intent: "emphasis" }],
      words,
    );
    const stopsEarly = checkStoryboard(
      [{ index: 0, startWord: 0, endWord: 20, intent: "emphasis" }],
      words,
    );

    expect(fromOne.length).toBeGreaterThan(0);
    expect(stopsEarly.length).toBeGreaterThan(0);
  });

  it("reports a beat naming a word the transcript does not have", () => {
    expect(
      checkStoryboard(
        [{ index: 0, startWord: 0, endWord: 999, intent: "emphasis" }],
        words,
      ).map((e) => e.code),
    ).toContain("UNKNOWN_WORD_ANCHOR");
  });
});

describe("the short tail", () => {
  it("absorbs a short final beat when the merge stays inside the ceiling", () => {
    const words = transcript({ count: 10, perWord: 0.3 });
    const beats = [
      { index: 0, startWord: 0, endWord: 7, intent: "emphasis" as const },
      { index: 1, startWord: 8, endWord: 9, intent: "emphasis" as const },
    ];

    const merged = mergeShortTail(beats, words);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.endWord).toBe(9);
  });

  it("leaves it alone when merging would break the ceiling", () => {
    /* SHORT_TAIL_IS_REPORTED — there is no third option that keeps every word
     * and every bound, so the short beat stays and the check reports it. */
    const words = transcript({ count: 24, perWord: 0.3 });
    const beats = [
      { index: 0, startWord: 0, endWord: 21, intent: "emphasis" as const },
      { index: 1, startWord: 22, endWord: 23, intent: "emphasis" as const },
    ];

    expect(mergeShortTail(beats, words)).toHaveLength(2);
  });

  it("leaves a single beat alone", () => {
    const words = transcript({ count: 3, perWord: 0.2 });
    const beats = buildStoryboard(words);
    expect(mergeShortTail(beats, words)).toEqual(beats);
  });
});

describe("intents", () => {
  it("defaults every beat to the one intent that always has a scene", () => {
    /* INTENT_HAS_A_FREE_DEFAULT — the storyboard works with no model. */
    const words = transcript({ count: 40, sentenceEvery: 6 });
    for (const beat of buildStoryboard(words)) {
      expect(beat.intent).toBe("emphasis");
    }
  });

  it("applies a sparse map and leaves the rest at the default", () => {
    const words = transcript({ count: 40, sentenceEvery: 6 });
    const beats = buildStoryboard(words);
    const assigned = assignIntents(beats, { 0: "title", 2: "stat" });

    expect(assigned[0]?.intent).toBe("title");
    expect(assigned[2]?.intent).toBe("stat");
    expect(assigned[1]?.intent).toBe("emphasis");
    /* The beats themselves are untouched — only the intent changes. */
    expect(assigned.map((b) => b.startWord)).toEqual(
      beats.map((b) => b.startWord),
    );
  });
});

describe("the fallback beat", () => {
  it("is valid for any narration, at both aspects and every safe zone", () => {
    /* FALLBACK_IS_ALWAYS_VALID. If this can fail, a failed DESIGN becomes a
     * broken video — on exactly the beats where something already went wrong. */
    const cases: readonly WordToken[][] = [
      transcript({ count: 1 }),
      transcript({ count: 12 }),
      /* A nine-second stretch of narration, which is what an unpunctuated run
       * at the ceiling looks like. */
      transcript({ count: 40, perWord: 0.22 }),
      /* Long unbreakable tokens — a URL, a compound. */
      [
        { i: 0, w: "https://example.com/onboarding/first-run", s: 0, e: 1 },
        { i: 1, w: "Rindfleischetikettierungsueberwachungsaufgaben", s: 1, e: 2 },
      ],
      [],
    ];

    for (const [index, words] of cases.entries()) {
      for (const ctx of [PORTRAIT, LANDSCAPE]) {
        for (const safeZone of SAFE_ZONES) {
          /* Built FOR this frame — the fallback measures itself, so it takes
             the canvas and safe zone it has to fit. */
          const scene = fallbackScene({
            words,
            beatIndex: index,
            ctx: { canvas: ctx.canvas, safeZone },
            durationSeconds: 4,
          });
          const result = checkScene(scene, {
            ...ctx,
            safeZone,
            durationSeconds: 4,
          });
          expect(
            result.errors,
            `case ${index} at ${ctx.canvas.width}x${ctx.canvas.height} ${safeZone}`,
          ).toEqual([]);
        }
      }
    }
  });

  it("truncates rather than trusting the narration to fit", () => {
    const scene = fallbackScene({
      words: transcript({ count: 40 }),
      beatIndex: 0,
      ctx: { canvas: PORTRAIT.canvas, safeZone: "none" },
      durationSeconds: 4,
    });
    const element = scene.elements[0];

    expect(element?.kind).toBe("kineticText");
    expect(element?.kind === "kineticText" ? element.text : "").toMatch(/…$/u);
  });

  it("draws something deliberate for a beat with no words", () => {
    const scene = fallbackScene({ words: [], beatIndex: 3, ctx: { canvas: PORTRAIT.canvas, safeZone: "none" }, durationSeconds: 4 });
    const element = scene.elements[0];

    expect(element?.kind === "kineticText" ? element.text : "").toBe("•");
  });

  it("gives each beat a distinct element id", () => {
    const a = fallbackScene({ words: transcript({ count: 3 }), beatIndex: 0, ctx: { canvas: PORTRAIT.canvas, safeZone: "none" }, durationSeconds: 4 });
    const b = fallbackScene({ words: transcript({ count: 3 }), beatIndex: 1, ctx: { canvas: PORTRAIT.canvas, safeZone: "none" }, durationSeconds: 4 });

    expect(a.elements[0]?.id).not.toBe(b.elements[0]?.id);
  });

  it("is timed in seconds rather than anchored", () => {
    /* The beat exists because something upstream went wrong, so it should
     * depend on as little as possible — including on word indices surviving a
     * re-alignment. */
    const scene = fallbackScene({ words: transcript({ count: 5 }), beatIndex: 0, ctx: { canvas: PORTRAIT.canvas, safeZone: "none" }, durationSeconds: 4 });
    expect(typeof scene.elements[0]?.in).toBe("number");
  });
});
