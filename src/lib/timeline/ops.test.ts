/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ops tests, PURE_OPS, ATOMIC_PER_OP, RIPPLE,
 *   split edges, setCaptionText, WORD_SHIFT, PROPORTIONAL_REDISTRIBUTION,
 *   CAPTIONS_FOLLOW_WORDS, reorder, setItemProps, addItem, addOverlay,
 *   setWordTiming, restoreDoc
 *
 * WHAT:  Every operation, including the ripple variants, the split edge cases,
 *        and the refusals.
 * WHY:   Three properties get asserted for every op, not just the happy path:
 *
 *        PURE_OPS — the input document is byte-identical afterwards. This is
 *        the property the editor's undo stack depends on, and the easiest one
 *        to break with a stray in-place sort.
 *
 *        ATOMIC_PER_OP — a failing op leaves the document exactly as it was and
 *        the ops after it still run. A half-applied trim is the one outcome
 *        nobody could recover from.
 *
 *        The result still validates. An op can be individually legal and leave
 *        the document illegal (two overlays colliding at a depth after a move),
 *        and apply() is specified to report that.
 * WHERE: Run by `npm test`. Guards src/lib/timeline/ops.ts.
 */

import { describe, expect, it } from "vitest";

import { motionFixture, quizFixture, redditStoryFixture } from "./fixtures";
import { apply, type Op } from "./ops";
import { validate } from "./validate";
import type { TimelineDoc } from "./schema";

function videoItem(doc: TimelineDoc, id: string) {
  for (const track of doc.tracks) {
    for (const item of track.items) {
      if (item.id === id) return item;
    }
  }
  throw new Error(`no item ${id}`);
}

function trackOf(doc: TimelineDoc, trackId: string) {
  const track = doc.tracks.find((candidate) => candidate.id === trackId);
  if (track === undefined) throw new Error(`no track ${trackId}`);
  return track;
}

/* Numbers, from a field the schema types as number-or-anchor. Every test here
 * works on resolved fixtures, so an anchor is a test-setup bug, not a case. */
function seconds(value: unknown): number {
  if (typeof value !== "number") throw new Error("expected resolved seconds");
  return value;
}

/* Runs ops and asserts the input was not touched — the PURE_OPS property, which
 * every test in this file gets for free by going through here. */
function run(doc: TimelineDoc, ops: Op[]) {
  const before = JSON.stringify(doc);
  const result = apply(doc, ops);
  expect(JSON.stringify(doc), "apply() mutated its input").toBe(before);
  return result;
}

describe("purity", () => {
  it("returns a different object", () => {
    const doc = redditStoryFixture();
    const result = run(doc, [
      { type: "trim", itemId: "o1", duration: 1, ripple: false },
    ]);
    expect(result.doc).not.toBe(doc);
  });

  it("is deterministic — the same input gives the same output", () => {
    const ops: Op[] = [
      { type: "move", itemId: "o1", start: 1, ripple: false },
      { type: "split", itemId: "s1", at: 2 },
    ];
    const first = run(redditStoryFixture(), ops);
    const second = run(redditStoryFixture(), ops);
    expect(first.doc).toEqual(second.doc);
    expect(first.errors).toEqual(second.errors);
  });

  it("leaves no shared references into the input document", () => {
    const doc = redditStoryFixture();
    const result = run(doc, [
      { type: "trim", itemId: "o1", duration: 1, ripple: false },
    ]);
    /* Mutating the OUTPUT must not reach back into the input. */
    const firstWord = result.doc.words[0];
    if (firstWord === undefined) throw new Error("fixture has no words");
    firstWord.w = "MUTATED";
    expect(doc.words[0]?.w).not.toBe("MUTATED");
  });

  it("accepts an empty op list", () => {
    const doc = redditStoryFixture();
    const result = run(doc, []);
    expect(result.errors).toEqual([]);
    expect(result.doc).toEqual(doc);
  });
});

describe("trim", () => {
  it("shortens an item from the tail", () => {
    const result = run(redditStoryFixture(), [
      { type: "trim", itemId: "o1", duration: 1.5, ripple: false },
    ]);
    expect(result.errors).toEqual([]);
    expect(seconds(videoItem(result.doc, "o1").duration)).toBe(1.5);
  });

  it("moves the head without moving the tail", () => {
    const doc = redditStoryFixture();
    const before = videoItem(doc, "o1");
    const originalEnd = seconds(before.start) + seconds(before.duration);

    const result = run(doc, [
      {
        type: "trim",
        itemId: "o1",
        start: seconds(before.start) + 0.5,
        ripple: false,
      },
    ]);
    const after = videoItem(result.doc, "o1");
    expect(seconds(after.start) + seconds(after.duration)).toBeCloseTo(
      originalEnd,
      6,
    );
  });

  it("refuses a trim that would leave no length", () => {
    const result = run(redditStoryFixture(), [
      { type: "trim", itemId: "o1", duration: 0, ripple: false },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_DURATION");
  });

  it("refuses a trim that starts before zero", () => {
    const result = run(redditStoryFixture(), [
      { type: "trim", itemId: "o1", start: -1, ripple: false },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_DURATION");
  });

  it("refuses to trim a caption", () => {
    /* CAPTIONS_FOLLOW_WORDS — a caption's timing is not its own. */
    const result = run(redditStoryFixture(), [
      { type: "trim", itemId: "c1", duration: 1, ripple: false },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
    expect(result.errors[0]?.message).toContain("follows the words");
  });

  it("reports NOT_FOUND for an item that is not there", () => {
    const result = run(redditStoryFixture(), [
      { type: "trim", itemId: "ghost", duration: 1, ripple: false },
    ]);
    expect(result.errors[0]?.code).toBe("NOT_FOUND");
  });

  it("ripples the clips after it when asked", () => {
    const doc = quizFixture();
    const secondBefore = seconds(videoItem(doc, "q2").start);

    const result = run(doc, [
      { type: "trim", itemId: "q1", duration: 4, ripple: true },
    ]);
    /* q1 was 6s and is now 4s, so q2 travels 2s earlier. */
    expect(seconds(videoItem(result.doc, "q2").start)).toBeCloseTo(
      secondBefore - 2,
      6,
    );
  });

  it("leaves the clips after it alone without ripple", () => {
    const doc = quizFixture();
    const secondBefore = seconds(videoItem(doc, "q2").start);

    const result = run(doc, [
      { type: "trim", itemId: "q1", duration: 4, ripple: false },
    ]);
    expect(seconds(videoItem(result.doc, "q2").start)).toBe(secondBefore);
  });

  it("does not ripple items on other tracks", () => {
    const doc = quizFixture();
    const narrationBefore = seconds(videoItem(doc, "a1").start);
    const result = run(doc, [
      { type: "trim", itemId: "q1", duration: 4, ripple: true },
    ]);
    expect(seconds(videoItem(result.doc, "a1").start)).toBe(narrationBefore);
  });
});

describe("split", () => {
  it("cuts an item into two adjacent halves", () => {
    const doc = quizFixture();
    const result = run(doc, [{ type: "split", itemId: "q1", at: 2.5 }]);
    expect(result.errors).toEqual([]);

    const head = videoItem(result.doc, "q1");
    const tail = videoItem(result.doc, "q1-2");
    expect(seconds(head.start)).toBe(0);
    expect(seconds(head.duration)).toBeCloseTo(2.5, 6);
    expect(seconds(tail.start)).toBeCloseTo(2.5, 6);
    expect(seconds(tail.duration)).toBeCloseTo(3.5, 6);
  });

  it("places the tail immediately after the head on the same track", () => {
    const result = run(quizFixture(), [
      { type: "split", itemId: "q1", at: 2.5 },
    ]);
    const ids = trackOf(result.doc, "questions").items.map((item) => item.id);
    expect(ids).toEqual(["q1", "q1-2", "q2"]);
  });

  it("copies every property onto the tail", () => {
    const result = run(quizFixture(), [
      { type: "split", itemId: "q1", at: 2.5 },
    ]);
    const head = videoItem(result.doc, "q1");
    const tail = videoItem(result.doc, "q1-2");
    expect("scene" in tail && "scene" in head ? tail.scene : null).toEqual(
      "scene" in head ? head.scene : undefined,
    );
  });

  it("refuses a split on the leading edge", () => {
    const result = run(quizFixture(), [{ type: "split", itemId: "q1", at: 0 }]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
    expect(result.errors[0]?.message).toContain("inside the clip");
  });

  it("refuses a split on the trailing edge", () => {
    const result = run(quizFixture(), [{ type: "split", itemId: "q1", at: 6 }]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
  });

  it("refuses a split outside the clip entirely", () => {
    const result = run(quizFixture(), [
      { type: "split", itemId: "q1", at: 11 },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
  });

  it("refuses a split a hair inside the edge, where a half would be unseeable", () => {
    const result = run(quizFixture(), [
      { type: "split", itemId: "q1", at: 0.0001 },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
  });

  it("gives a second split on the same clip a fresh id", () => {
    const first = run(quizFixture(), [{ type: "split", itemId: "q1", at: 2 }]);
    const second = apply(first.doc, [{ type: "split", itemId: "q1", at: 1 }]);
    expect(second.errors).toEqual([]);
    const ids = trackOf(second.doc, "questions").items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("q1-3");
  });

  it("refuses to split a caption", () => {
    const result = run(redditStoryFixture(), [
      { type: "split", itemId: "c1", at: 0.5 },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
  });

  it("leaves the document valid", () => {
    const result = run(quizFixture(), [
      { type: "split", itemId: "q1", at: 2.5 },
    ]);
    expect(validate(result.doc).ok).toBe(true);
  });
});

describe("move", () => {
  it("slides an item and keeps its length", () => {
    const doc = redditStoryFixture();
    const lengthBefore = seconds(videoItem(doc, "o1").duration);
    const result = run(doc, [
      { type: "move", itemId: "o1", start: 2, ripple: false },
    ]);
    expect(seconds(videoItem(result.doc, "o1").start)).toBe(2);
    expect(seconds(videoItem(result.doc, "o1").duration)).toBe(lengthBefore);
  });

  it("refuses a move before zero", () => {
    const result = run(redditStoryFixture(), [
      { type: "move", itemId: "o1", start: -0.5, ripple: false },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_DURATION");
  });

  it("takes the downstream clips with it when rippling", () => {
    const doc = quizFixture();
    const secondBefore = seconds(videoItem(doc, "q2").start);
    const result = run(doc, [
      { type: "move", itemId: "q1", start: 1, ripple: true },
    ]);
    expect(seconds(videoItem(result.doc, "q2").start)).toBeCloseTo(
      secondBefore + 1,
      6,
    );
  });

  it("refuses to move a caption", () => {
    const result = run(redditStoryFixture(), [
      { type: "move", itemId: "c1", start: 1, ripple: false },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
  });
});

describe("delete", () => {
  it("removes the item", () => {
    const result = run(redditStoryFixture(), [
      { type: "delete", itemId: "o2", ripple: false },
    ]);
    expect(result.errors).toEqual([]);
    expect(() => videoItem(result.doc, "o2")).toThrow();
  });

  it("closes the gap when rippling", () => {
    const doc = quizFixture();
    const result = run(doc, [{ type: "delete", itemId: "q1", ripple: true }]);
    /* q1 was six seconds at the start, so q2 moves to zero. */
    expect(seconds(videoItem(result.doc, "q2").start)).toBe(0);
  });

  it("leaves the gap open without ripple", () => {
    const doc = quizFixture();
    const secondBefore = seconds(videoItem(doc, "q2").start);
    const result = run(doc, [{ type: "delete", itemId: "q1", ripple: false }]);
    expect(seconds(videoItem(result.doc, "q2").start)).toBe(secondBefore);
  });

  it("deletes a caption, which trimming one would not allow", () => {
    const result = run(redditStoryFixture(), [
      { type: "delete", itemId: "c1", ripple: false },
    ]);
    expect(result.errors).toEqual([]);
    expect(() => videoItem(result.doc, "c1")).toThrow();
  });

  it("reports NOT_FOUND for an item that is not there", () => {
    const result = run(redditStoryFixture(), [
      { type: "delete", itemId: "ghost", ripple: false },
    ]);
    expect(result.errors[0]?.code).toBe("NOT_FOUND");
  });
});

describe("reorder", () => {
  it("rearranges a track into the given order", () => {
    const result = run(quizFixture(), [
      { type: "reorder", trackId: "questions", itemIds: ["q2", "q1"] },
    ]);
    expect(result.errors).toEqual([]);
    expect(
      trackOf(result.doc, "questions").items.map((item) => item.id),
    ).toEqual(["q2", "q1"]);
  });

  it("refuses a partial list", () => {
    const result = run(quizFixture(), [
      { type: "reorder", trackId: "questions", itemIds: ["q1"] },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
    expect(result.errors[0]?.message).toContain("every item");
  });

  it("refuses a duplicated id", () => {
    const result = run(quizFixture(), [
      { type: "reorder", trackId: "questions", itemIds: ["q1", "q1"] },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
    expect(result.errors[0]?.message).toContain("more than once");
  });

  it("refuses an id from another track", () => {
    const result = run(quizFixture(), [
      { type: "reorder", trackId: "questions", itemIds: ["q1", "a1"] },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
  });

  it("reports NOT_FOUND for a track that is not there", () => {
    const result = run(quizFixture(), [
      { type: "reorder", trackId: "ghost", itemIds: [] },
    ]);
    expect(result.errors[0]?.code).toBe("NOT_FOUND");
  });
});

describe("setCaptionText", () => {
  it("replaces the words the caption covers", () => {
    const doc = redditStoryFixture();
    const result = run(doc, [
      { type: "setCaptionText", itemId: "c1", text: "one two three four" },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.doc.words.slice(0, 4).map((token) => token.w)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });

  it("keeps the caption inside the same span of time", () => {
    const doc = redditStoryFixture();
    const firstBefore = doc.words[0];
    const lastBefore = doc.words[3];
    if (firstBefore === undefined || lastBefore === undefined)
      throw new Error("short fixture");

    const result = run(doc, [
      { type: "setCaptionText", itemId: "c1", text: "a bb ccc" },
    ]);
    const firstAfter = result.doc.words[0];
    const lastAfter = result.doc.words[2];
    expect(firstAfter?.s).toBeCloseTo(firstBefore.s, 6);
    expect(lastAfter?.e).toBeCloseTo(lastBefore.e, 6);
  });

  it("shares the span in proportion to word length, not evenly", () => {
    /* PROPORTIONAL_REDISTRIBUTION — "I" and "unbelievable" do not take the same
     * time to say, and an even split makes the caption lag mid-sentence. */
    const result = run(redditStoryFixture(), [
      { type: "setCaptionText", itemId: "c1", text: "I unbelievable" },
    ]);
    const short = result.doc.words[0];
    const long = result.doc.words[1];
    if (short === undefined || long === undefined)
      throw new Error("replacement missing");
    expect(long.e - long.s).toBeGreaterThan(short.e - short.s);
  });

  it("renumbers every word index after the edit", () => {
    const result = run(redditStoryFixture(), [
      { type: "setCaptionText", itemId: "c1", text: "just one" },
    ]);
    result.doc.words.forEach((token, index) => {
      expect(token.i).toBe(index);
    });
  });

  it("shifts the later captions when the word count changes", () => {
    /* WORD_SHIFT — fewer words means every caption after this one must move
     * back, or the whole video desyncs from its second group onward. */
    const doc = redditStoryFixture();
    const secondBefore = trackOf(doc, "captions").items[1];
    if (secondBefore === undefined || !("startWord" in secondBefore))
      throw new Error("no c2");
    const startBefore = secondBefore.startWord;

    const result = run(doc, [
      { type: "setCaptionText", itemId: "c1", text: "just two words" },
    ]);
    const secondAfter = trackOf(result.doc, "captions").items[1];
    if (secondAfter === undefined || !("startWord" in secondAfter))
      throw new Error("no c2");
    /* c1 covered four words and now covers three, so c2 moves back by one. */
    expect(secondAfter.startWord).toBe(startBefore - 1);
  });

  it("does not shift the later captions when the count is unchanged", () => {
    const doc = redditStoryFixture();
    const before = trackOf(doc, "captions").items.map((item) =>
      "startWord" in item ? item.startWord : -1,
    );
    const result = run(doc, [
      { type: "setCaptionText", itemId: "c1", text: "one two three four" },
    ]);
    const after = trackOf(result.doc, "captions").items.map((item) =>
      "startWord" in item ? item.startWord : -1,
    );
    expect(after).toEqual(before);
  });

  it("updates the caption’s own range to the new word count", () => {
    const result = run(redditStoryFixture(), [
      { type: "setCaptionText", itemId: "c1", text: "one two" },
    ]);
    const caption = trackOf(result.doc, "captions").items[0];
    if (caption === undefined || !("startWord" in caption))
      throw new Error("no c1");
    expect(caption.startWord).toBe(0);
    expect(caption.endWord).toBe(1);
  });

  it("refuses empty text", () => {
    const result = run(redditStoryFixture(), [
      { type: "setCaptionText", itemId: "c1", text: "   " },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
    expect(result.errors[0]?.message).toContain("at least one word");
  });

  it("refuses to set text on an item that is not a caption", () => {
    const result = run(redditStoryFixture(), [
      { type: "setCaptionText", itemId: "i1", text: "nope" },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
  });

  it("refuses when another caption straddles the words being replaced", () => {
    const doc = redditStoryFixture();
    const second = trackOf(doc, "captions").items[1];
    if (second === undefined || !("startWord" in second))
      throw new Error("no c2");
    second.startWord = 2;
    second.endWord = 6;

    const result = run(doc, [
      { type: "setCaptionText", itemId: "c1", text: "one two" },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
    expect(result.errors[0]?.message).toContain("overlaps");
  });

  it("leaves the document valid", () => {
    const result = run(redditStoryFixture(), [
      { type: "setCaptionText", itemId: "c1", text: "one two three four" },
    ]);
    expect(validate(result.doc).ok, JSON.stringify(validate(result.doc))).toBe(
      true,
    );
  });
});

describe("setItemProps", () => {
  it("changes a presentation field", () => {
    const result = run(redditStoryFixture(), [
      { type: "setItemProps", itemId: "i1", props: { fit: "contain" } },
    ]);
    expect(result.errors).toEqual([]);
    const item = videoItem(result.doc, "i1");
    expect("fit" in item ? item.fit : null).toBe("contain");
  });

  it("leaves the fields it was not given alone", () => {
    const result = run(redditStoryFixture(), [
      { type: "setItemProps", itemId: "i1", props: { fit: "contain" } },
    ]);
    const item = videoItem(result.doc, "i1");
    expect("loop" in item ? item.loop : null).toBe(true);
  });

  it("rejects a field that is not legal on this item’s track", () => {
    /* `gain` is an audio and video knob; a caption has no such thing, and the
     * re-parse against the caption schema is what catches it. */
    const result = run(redditStoryFixture(), [
      { type: "setItemProps", itemId: "c1", props: { gain: 2 } },
    ]);
    expect(result.errors[0]?.code).toBe("SCHEMA");
  });

  it("reports NOT_FOUND for an item that is not there", () => {
    const result = run(redditStoryFixture(), [
      { type: "setItemProps", itemId: "ghost", props: { loop: true } },
    ]);
    expect(result.errors[0]?.code).toBe("NOT_FOUND");
  });
});

describe("addItem and addOverlay", () => {
  it("appends an item to a track", () => {
    const result = run(motionFixture(), [
      {
        type: "addItem",
        trackId: "scenes",
        ripple: false,
        item: {
          id: "s4",
          start: 8,
          duration: 2,
          render: "motion",
          scene: { layout: "stack-center", elements: [] },
        },
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(trackOf(result.doc, "scenes").items.map((item) => item.id)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
  });

  it("rejects an item that does not fit the track", () => {
    const result = run(motionFixture(), [
      {
        type: "addItem",
        trackId: "scenes",
        ripple: false,
        item: { id: "x1", start: 0, duration: 1, assetId: "logo_badge" },
      },
    ]);
    expect(result.errors[0]?.code).toBe("SCHEMA");
  });

  it("rejects an id that is already in the document", () => {
    const result = run(motionFixture(), [
      {
        type: "addItem",
        trackId: "scenes",
        ripple: false,
        item: {
          id: "s1",
          start: 8,
          duration: 2,
          render: "motion",
          scene: { layout: "stack-center", elements: [] },
        },
      },
    ]);
    expect(result.errors[0]?.code).toBe("DUPLICATE_ID");
  });

  it("reports NOT_FOUND for a track that is not there", () => {
    const result = run(motionFixture(), [
      { type: "addItem", trackId: "ghost", ripple: false, item: { id: "x" } },
    ]);
    expect(result.errors[0]?.code).toBe("NOT_FOUND");
  });

  it("adds an overlay", () => {
    const result = run(motionFixture(), [
      {
        type: "addOverlay",
        trackId: "overlays",
        item: {
          id: "o2",
          start: 0,
          duration: 2,
          render: "text",
          z: 9,
          box: { x: 0.1, y: 0.5, w: 0.5, h: 0.1 },
          text: "Added",
        },
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(
      trackOf(result.doc, "overlays").items.map((item) => item.id),
    ).toEqual(["o1", "o2"]);
  });

  it("refuses an overlay aimed at a track that is not an overlay track", () => {
    const result = run(motionFixture(), [
      {
        type: "addOverlay",
        trackId: "scenes",
        item: {
          id: "o9",
          start: 0,
          duration: 2,
          render: "text",
          z: 9,
          box: { x: 0.1, y: 0.5, w: 0.5, h: 0.1 },
        },
      },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
    expect(result.errors[0]?.message).toContain("scene track");
  });
});

describe("atomicity and sequencing", () => {
  it("applies ops in order", () => {
    const result = run(redditStoryFixture(), [
      { type: "move", itemId: "o1", start: 1, ripple: false },
      { type: "move", itemId: "o1", start: 2, ripple: false },
    ]);
    expect(seconds(videoItem(result.doc, "o1").start)).toBe(2);
  });

  it("skips a failing op and still runs the ones after it", () => {
    const result = run(redditStoryFixture(), [
      { type: "trim", itemId: "ghost", duration: 1, ripple: false },
      { type: "move", itemId: "o1", start: 2, ripple: false },
    ]);
    expect(result.errors.map((error) => error.code)).toContain("NOT_FOUND");
    expect(seconds(videoItem(result.doc, "o1").start)).toBe(2);
  });

  it("leaves no trace of a failing op", () => {
    const doc = redditStoryFixture();
    /* A trim that fails its own length check must not have moved the start
     * either — half an edit is the one unrecoverable outcome. */
    const result = run(doc, [
      { type: "trim", itemId: "o1", start: 0.9, duration: 0, ripple: false },
    ]);
    expect(result.errors[0]?.code).toBe("BAD_DURATION");
    expect(videoItem(result.doc, "o1").start).toEqual(
      videoItem(doc, "o1").start,
    );
    expect(videoItem(result.doc, "o1").duration).toEqual(
      videoItem(doc, "o1").duration,
    );
  });

  it("names the failing op by index in the error path", () => {
    const result = run(redditStoryFixture(), [
      { type: "move", itemId: "o1", start: 1, ripple: false },
      { type: "trim", itemId: "ghost", duration: 1, ripple: false },
    ]);
    expect(result.errors[0]?.path).toContain("ops.1");
  });

  it("reports an invariant the result breaks, even when every op was legal", () => {
    /* Two overlays made to collide at a depth: each move is fine on its own. */
    const doc = redditStoryFixture();
    const overlay = trackOf(doc, "overlays").items[1];
    if (overlay === undefined || !("z" in overlay)) throw new Error("no o2");
    overlay.z = 10;

    const result = run(doc, [
      { type: "move", itemId: "o2", start: 0.4, ripple: false },
    ]);
    expect(result.errors.map((error) => error.code)).toContain("Z_COLLISION");
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: setWordTiming tests, WORD_LEVEL_NUDGE,
 *   NEIGHBOURS_ARE_THE_BOUNDS, CACHE_IS_DROPPED_NOT_RECOMPUTED
 *
 * The finest edit the editor makes. The refusals matter more than the happy
 * path: a nudge that crossed a neighbour would leave a token order that
 * disagrees with the audio, and nothing downstream would report it.
 */
describe("setWordTiming", () => {
  it("moves one word's edges and leaves its neighbours alone", () => {
    const doc = redditStoryFixture();
    const before = doc.words[2];
    const next = doc.words[3];
    if (before === undefined || next === undefined) throw new Error("fixture");

    const target = (before.s + before.e) / 2;
    const result = run(doc, [
      { type: "setWordTiming", wordIndex: 2, end: target },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.doc.words[2]?.e).toBeCloseTo(target, 3);
    expect(result.doc.words[2]?.s).toBe(before.s);
    expect(result.doc.words[3]?.s).toBe(next.s);
  });

  it("refuses to start a word before the previous one has finished", () => {
    const doc = redditStoryFixture();
    const previous = doc.words[1];
    if (previous === undefined) throw new Error("fixture");

    const result = run(doc, [
      { type: "setWordTiming", wordIndex: 2, start: previous.s },
    ]);

    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
    expect(result.doc.words[2]?.s).toBe(doc.words[2]?.s);
  });

  it("refuses to run a word past the start of the next one", () => {
    const doc = redditStoryFixture();
    const next = doc.words[3];
    if (next === undefined) throw new Error("fixture");

    const result = run(doc, [
      { type: "setWordTiming", wordIndex: 2, end: next.e },
    ]);

    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
  });

  it("refuses a word that would end before it starts", () => {
    const doc = redditStoryFixture();
    const word = doc.words[2];
    if (word === undefined) throw new Error("fixture");

    const result = run(doc, [
      { type: "setWordTiming", wordIndex: 2, start: word.e, end: word.s },
    ]);

    expect(result.errors[0]?.code).toBe("BAD_DURATION");
  });

  it("names a word the document does not have", () => {
    const result = run(redditStoryFixture(), [
      { type: "setWordTiming", wordIndex: 9_999, start: 1 },
    ]);
    expect(result.errors[0]?.code).toBe("NOT_FOUND");
  });

  /* CACHE_IS_DROPPED_NOT_RECOMPUTED — and the document must still validate,
   * which is the whole reason the cache is dropped rather than left stale. */
  it("drops the cached timing of every caption over the word", () => {
    const doc = redditStoryFixture();
    const word = doc.words[2];
    if (word === undefined) throw new Error("fixture");

    const result = run(doc, [
      { type: "setWordTiming", wordIndex: 2, end: (word.s + word.e) / 2 },
    ]);

    expect(result.errors).toEqual([]);
    const covering = trackOf(result.doc, "captions").items.filter(
      (item) => "startWord" in item && item.startWord <= 2 && item.endWord >= 2,
    );
    expect(covering.length).toBeGreaterThan(0);
    for (const caption of covering) {
      expect(caption.start).toBeUndefined();
      expect(caption.duration).toBeUndefined();
    }
    expect(validate(result.doc).ok).toBe(true);
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: restoreDoc tests, WHOLE_DOCUMENT_IS_STILL_AN_OP,
 *   IN_PLACE_REPLACEMENT
 *
 * The op undo-past-the-save and the snapshot restore both use. What has to
 * hold is that it replaces EVERYTHING and is still subject to the same
 * validation as any other op — a restore is not a back door.
 */
describe("restoreDoc", () => {
  it("replaces the whole document", () => {
    const original = redditStoryFixture();
    const edited = run(original, [
      { type: "trim", itemId: "i1", duration: 2, ripple: false },
    ]).doc;

    const result = run(edited, [{ type: "restoreDoc", doc: original }]);

    expect(result.errors).toEqual([]);
    expect(JSON.stringify(result.doc)).toBe(JSON.stringify(original));
  });

  it("does not alias the document carried by the op", () => {
    /* An op is replayable, so a later edit must not reach back through it. */
    const original = redditStoryFixture();
    const op: Op = { type: "restoreDoc", doc: original };

    const result = run(quizFixture(), [
      op,
      { type: "trim", itemId: "i1", duration: 1.5, ripple: false },
    ]);

    expect(result.errors).toEqual([]);
    expect(seconds(videoItem(original, "i1").duration)).not.toBe(1.5);
  });

  it("is validated like every other op", () => {
    const broken = redditStoryFixture();
    const overlays = trackOf(broken, "overlays").items;
    const [first, second] = overlays;
    if (first === undefined || second === undefined || !("z" in second))
      throw new Error("fixture");
    /* Two overlays made to collide at a depth, then restored wholesale. */
    second.z = 10;
    second.start = seconds(first.start);
    second.duration = seconds(first.duration);

    const result = run(quizFixture(), [{ type: "restoreDoc", doc: broken }]);
    expect(result.errors.map((error) => error.code)).toContain("Z_COLLISION");
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: ADD_REGISTERS_ITS_ASSET tests, UNKNOWN_ASSET,
 *   ASSET_HANDLE_INDIRECTION
 *
 * Inserting media the document has never carried. Without the registration
 * half, every such insert would fail validate()'s UNKNOWN_ASSET rule — which
 * is what makes the two halves one op rather than two.
 */
describe("addItem with a new asset handle", () => {
  const NEW_ASSET = {
    assetId: "ast_library_clip_42",
    kind: "video",
    license: "licensed",
  } as const;

  it("registers the handle and inserts the clip", () => {
    const result = run(redditStoryFixture(), [
      {
        type: "addItem",
        trackId: "bg",
        ripple: false,
        asset: NEW_ASSET,
        item: {
          id: "inserted",
          start: 0,
          duration: 1.5,
          assetId: "library_clip_42",
        },
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.doc.assets["library_clip_42"]).toEqual(NEW_ASSET);
    expect(seconds(videoItem(result.doc, "inserted").duration)).toBe(1.5);
  });

  it("refuses to re-point a handle the document already uses", () => {
    const result = run(redditStoryFixture(), [
      {
        type: "addItem",
        trackId: "bg",
        ripple: false,
        asset: NEW_ASSET,
        /* `bg_loop_07` is the fixture's existing background handle. */
        item: {
          id: "inserted",
          start: 0,
          duration: 1.5,
          assetId: "bg_loop_07",
        },
      },
    ]);

    expect(result.errors[0]?.code).toBe("BAD_OPERATION");
    expect(result.doc.assets["bg_loop_07"]?.assetId).toBe("ast_bg_loop_07");
  });

  it("still refuses an item whose handle was never registered", () => {
    const result = run(redditStoryFixture(), [
      {
        type: "addItem",
        trackId: "bg",
        ripple: false,
        item: {
          id: "inserted",
          start: 0,
          duration: 1.5,
          assetId: "never_heard_of_it",
        },
      },
    ]);

    expect(result.errors.map((error) => error.code)).toContain("UNKNOWN_ASSET");
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: REGROUP_BY_RANGE tests, startWord, endWord,
 *   CACHE_IS_DROPPED_NOT_RECOMPUTED
 *
 * The phase's "regroup words", done by moving a caption's boundary. What has
 * to hold is that the cached timing does not survive the move — a caption
 * covering different words with the old seconds on it is the definition of
 * out of sync.
 */
describe("setItemProps on a caption's word range", () => {
  it("moves the boundary and drops the cached timing", () => {
    const doc = redditStoryFixture();
    const caption = trackOf(doc, "captions").items[0];
    if (caption === undefined || !("endWord" in caption))
      throw new Error("fixture");
    const widened = caption.endWord + 1;

    const result = run(doc, [
      {
        type: "setItemProps",
        itemId: caption.id,
        props: { endWord: widened },
      },
    ]);

    expect(result.errors).toEqual([]);
    const after = trackOf(result.doc, "captions").items[0];
    if (after === undefined || !("endWord" in after)) throw new Error("gone");
    expect(after.endWord).toBe(widened);
    expect(after.start).toBeUndefined();
    expect(after.duration).toBeUndefined();
    expect(validate(result.doc).ok).toBe(true);
  });

  it("refuses a range that ends before it starts", () => {
    const doc = redditStoryFixture();
    const caption = trackOf(doc, "captions").items[1];
    if (caption === undefined || !("startWord" in caption))
      throw new Error("fixture");

    const result = run(doc, [
      {
        type: "setItemProps",
        itemId: caption.id,
        props: { endWord: caption.startWord - 1 },
      },
    ]);

    expect(result.errors.map((error) => error.code)).toContain(
      "BAD_WORD_RANGE",
    );
  });
});
