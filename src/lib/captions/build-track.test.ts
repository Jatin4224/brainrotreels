/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: build-track test, RESTYLING_IS_FREE,
 *   BREAK_ON_PUNCTUATION, NEVER_SPLIT_A_HYPHENATED_WORD, NO_ORPHAN_CHUNK,
 *   HOSTILE_LINE, OVERFLOW_IS_A_BUG
 *
 * WHAT:  The grouping rules, the restyle-cannot-move-a-caption guarantee, and
 *        the hostile line the phase asks for.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import type { WordToken } from "@/lib/timeline";
import { captionRangeSeconds } from "@/lib/timeline";
import { buildCaptionTrack, CAPTION_TRACK_ID } from "./build-track";
import { groupWords, PAUSE_BREAK_SECONDS } from "./chunk";
import { captionBox, captionFontPx } from "./safe-zone";
import { CAPTION_STYLES, DEFAULT_CAPTION_STYLE_ID } from "./styles";

/** Evenly spaced words, a third of a second each — ordinary narration pace. */
function wordsFrom(text: string, secondsEach = 0.33): WordToken[] {
  return text.split(" ").map((w, i) => ({
    i,
    w,
    s: Number((i * secondsEach).toFixed(3)),
    e: Number(((i + 1) * secondsEach).toFixed(3)),
  }));
}

const SAMPLE = wordsFrom(
  "So there I was, standing in the rain. My landlord called me. He said the rent was late again.",
);

describe("groupWords", () => {
  it("covers every word exactly once, in order", () => {
    const chunks = groupWords(SAMPLE, 4);
    const covered: number[] = [];
    for (const chunk of chunks) {
      for (let i = chunk.startWord; i <= chunk.endWord; i += 1) covered.push(i);
    }
    expect(covered).toEqual(SAMPLE.map((_, i) => i));
  });

  it("never exceeds the word limit except to keep a hyphenated word whole", () => {
    for (const limit of [2, 3, 4]) {
      for (const chunk of groupWords(SAMPLE, limit)) {
        expect(chunk.endWord - chunk.startWord + 1).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("breaks after punctuation rather than running into the next sentence", () => {
    const chunks = groupWords(SAMPLE, 4);
    for (const chunk of chunks) {
      /* No word INSIDE a chunk may end a sentence — only its last word may. */
      for (let i = chunk.startWord; i < chunk.endWord; i += 1) {
        expect([i, SAMPLE[i]?.w.endsWith(".")]).toEqual([i, false]);
      }
    }
  });

  it("keeps a hyphenated word together even past the limit", () => {
    const words = wordsFrom("it was a well- known problem for everyone");
    const chunks = groupWords(words, 2);
    /* Index 3 is `well-` and 4 is `known`; no chunk boundary may fall
     * between them, so one chunk holds both — even though the limit is two
     * and that chunk ends up holding three. */
    expect(chunks.some((chunk) => chunk.endWord === 3)).toBe(false);
    const holder = chunks.find(
      (chunk) => chunk.startWord <= 3 && chunk.endWord >= 4,
    );
    expect(holder).toBeDefined();
  });

  it("breaks on a long pause even with no punctuation", () => {
    const words = wordsFrom("and then nothing happened at all");
    /* A beat after `then`. */
    const third = words[2];
    const second = words[1];
    if (third === undefined || second === undefined) throw new Error("fixture");
    const gap = PAUSE_BREAK_SECONDS + 0.2;
    for (let i = 2; i < words.length; i += 1) {
      const word = words[i];
      if (word === undefined) continue;
      word.s = Number((word.s + gap).toFixed(3));
      word.e = Number((word.e + gap).toFixed(3));
    }

    const chunks = groupWords(words, 4);
    expect(chunks[0]?.endWord).toBe(1);
    expect(chunks[0]?.hardBreak).toBe(true);
  });

  it("does not leave a single word alone at the end", () => {
    /* Nine words, no punctuation, four per card: 4 + 4 + 1 without the
     * rebalance. */
    const words = wordsFrom("one two three four five six seven eight nine");
    const chunks = groupWords(words, 4);
    const last = chunks[chunks.length - 1];
    expect(last).toBeDefined();
    expect((last?.endWord ?? 0) - (last?.startWord ?? 0) + 1).toBeGreaterThan(1);
  });

  it("returns nothing for no words rather than one empty caption", () => {
    expect(groupWords([], 3)).toEqual([]);
  });
});

describe("buildCaptionTrack", () => {
  it("produces a caption track the timeline schema recognises", () => {
    const track = buildCaptionTrack(SAMPLE, DEFAULT_CAPTION_STYLE_ID);
    expect(track.type).toBe("caption");
    expect(track.id).toBe(CAPTION_TRACK_ID);
    expect(track.styleId).toBe(DEFAULT_CAPTION_STYLE_ID);
    expect(track.items.length).toBeGreaterThan(0);
  });

  it("writes word ranges and never a time", () => {
    const track = buildCaptionTrack(SAMPLE, DEFAULT_CAPTION_STYLE_ID);
    for (const item of track.items) {
      expect(item.start).toBeUndefined();
      expect(item.duration).toBeUndefined();
      expect(Number.isInteger(item.startWord)).toBe(true);
      expect(item.endWord).toBeGreaterThanOrEqual(item.startWord);
    }
  });

  /**
   * SOURCE OF TRUTH KEYWORDS: RESTYLING_IS_FREE
   *
   * The phase's "changing the style changes the look and provably not the
   * timing". Proved over the WHOLE library rather than two styles, because
   * the thing that would break it is one style doing something clever.
   */
  it("cannot change a word's timing, in any style in the library", () => {
    const before = SAMPLE.map((word) => ({ ...word }));

    for (const style of Object.values(CAPTION_STYLES)) {
      const track = buildCaptionTrack(SAMPLE, style.id);
      for (const item of track.items) {
        const range = captionRangeSeconds(item.startWord, item.endWord, SAMPLE);
        expect(range).not.toBeNull();
        expect(range?.start).toBe(SAMPLE[item.startWord]?.s);
        expect(range?.end).toBe(SAMPLE[item.endWord]?.e);
      }
    }

    /* And the words themselves are untouched — a style that cased or trimmed
     * them in place would pass every assertion above. */
    expect(SAMPLE).toEqual(before);
  });

  it("changes only the grouping when the words-per-card changes", () => {
    const two = buildCaptionTrack(SAMPLE, DEFAULT_CAPTION_STYLE_ID, {
      maxWords: 2,
    });
    const four = buildCaptionTrack(SAMPLE, DEFAULT_CAPTION_STYLE_ID, {
      maxWords: 4,
    });
    expect(two.items.length).toBeGreaterThan(four.items.length);
    /* Every word is still covered by both. */
    for (const track of [two, four]) {
      const last = track.items[track.items.length - 1];
      expect(track.items[0]?.startWord).toBe(0);
      expect(last?.endWord).toBe(SAMPLE.length - 1);
    }
  });

  it("falls back to the default style rather than failing on an unknown id", () => {
    const track = buildCaptionTrack(SAMPLE, "a-style-from-the-future");
    expect(track.styleId).toBe(DEFAULT_CAPTION_STYLE_ID);
    expect(track.items.length).toBeGreaterThan(0);
  });

  it("puts the caption where the band asks", () => {
    const top = buildCaptionTrack(SAMPLE, DEFAULT_CAPTION_STYLE_ID, {
      position: "top",
    });
    const bottom = buildCaptionTrack(SAMPLE, DEFAULT_CAPTION_STYLE_ID, {
      position: "bottom",
    });
    expect(top.items[0]?.position?.y).toBeLessThan(
      bottom.items[0]?.position?.y ?? 1,
    );
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: HOSTILE_LINE, OVERFLOW_IS_A_BUG
 *
 * The phase's step 10: "Test with a deliberately hostile line." Very long
 * words, very fast speech, the largest style in the library, the tightest
 * safe zone.
 */
describe("a deliberately hostile line", () => {
  const HOSTILE = wordsFrom(
    "ANTIDISESTABLISHMENTARIANISM Rindfleischetikettierungsueberwachungsaufgabenuebertragungsgesetz " +
      "pneumonoultramicroscopicsilicovolcanoconiosis supercalifragilisticexpialidocious",
    0.12,
  );

  const CANVAS = { width: 1080, height: 1920, fps: 30 };

  it("still groups every word exactly once at speaking speed", () => {
    const chunks = groupWords(HOSTILE, 4);
    const covered = chunks.flatMap((chunk) =>
      Array.from(
        { length: chunk.endWord - chunk.startWord + 1 },
        (_, n) => chunk.startWord + n,
      ),
    );
    expect(covered).toEqual(HOSTILE.map((_, i) => i));
  });

  it("keeps the caption box inside the safe zone for every platform and style", () => {
    for (const style of Object.values(CAPTION_STYLES)) {
      const fontPx = captionFontPx(style, CANVAS);
      /* Three wrapped lines of the biggest style — more than any real
       * caption, which is the point. */
      const blockHeight = fontPx * style.lineHeight * 3;

      for (const safeZone of ["tiktok", "reels", "shorts", "none"] as const) {
        const box = captionBox({
          canvas: CANVAS,
          safeZone,
          band: style.position,
          blockHeight,
        });

        expect(box.left).toBeGreaterThan(0);
        expect(box.left + box.width).toBeLessThanOrEqual(CANVAS.width);
        expect(box.top).toBeGreaterThan(0);
        expect(box.top + box.height).toBeLessThanOrEqual(CANVAS.height);

        /* The whole text block, not merely its centre, is inside the zone. */
        const blockTop = box.centerY - blockHeight / 2;
        const blockBottom = box.centerY + blockHeight / 2;
        if (blockHeight < box.height) {
          expect(blockTop).toBeGreaterThanOrEqual(box.top - 0.5);
          expect(blockBottom).toBeLessThanOrEqual(box.top + box.height + 0.5);
        } else {
          /* Taller than the zone: centred, so the overflow is symmetric and
           * the middle of the caption is still on screen. */
          expect(box.centerY).toBeCloseTo(box.top + box.height / 2, 5);
        }
      }
    }
  });

  it("clamps a band that asks to sit under the platform's own UI", () => {
    const box = captionBox({
      canvas: CANVAS,
      safeZone: "tiktok",
      /* 0.97 — right at the bottom edge, which is where TikTok's own caption
       * and button rail live. */
      band: 0.97,
      blockHeight: 120,
    });
    expect(box.centerY).toBeLessThanOrEqual(box.top + box.height - 60);
  });
});
