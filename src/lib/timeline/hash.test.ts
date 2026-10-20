/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: hashDoc tests, KEY_ORDER_INSENSITIVE, RENDER_REUSE,
 *   CACHE_IRRELEVANT_FIELDS, canonicalize, stableStringify
 *
 * WHAT:  Proves the hash ignores what does not change the picture and notices
 *        everything that does.
 * WHY:   RENDER_REUSE makes this function load-bearing on the bill AND on
 *        correctness, and its two failure modes are opposite. Too sensitive and
 *        every customer pays twice for the same video; too insensitive and a
 *        customer is served someone else's edit. Both halves are asserted here
 *        — the "changes the hash" block is as important as the "does not" one,
 *        and is the half a reviewer is more likely to leave out.
 * WHERE: Run by `npm test`. Guards src/lib/timeline/hash.ts.
 */

import { describe, expect, it } from "vitest";

import { FIXTURES_BY_KIND, quizFixture, redditStoryFixture } from "./fixtures";
import { PROJECT_KINDS } from "@/lib/types/project";
import {
  CACHE_IRRELEVANT_FIELDS,
  canonicalize,
  hashDoc,
  stableStringify,
} from "./hash";
import { apply } from "./ops";
import type { TimelineDoc } from "./schema";

/* Rebuilds every object in the document with its keys in reverse order. JSON
 * objects have no inherent order, so this is the same document — and the hash
 * must say so. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => reverseKeys(entry));
  if (typeof value !== "object" || value === null) return value;

  const source: Record<string, unknown> = { ...value };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).reverse()) {
    out[key] = reverseKeys(source[key]);
  }
  return out;
}

/* The reversal returns `unknown`; this restores the type without pretending the
 * reversal validated anything, which it did not need to. */
function reorderedDoc(doc: TimelineDoc): TimelineDoc {
  const reversed = reverseKeys(doc);
  if (typeof reversed !== "object" || reversed === null)
    throw new Error("reversal failed");
  return Object.assign({}, doc, reversed);
}

describe("shape", () => {
  it("is sixteen lowercase hex characters", () => {
    expect(hashDoc(redditStoryFixture())).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable across calls", () => {
    const doc = redditStoryFixture();
    expect(hashDoc(doc)).toBe(hashDoc(doc));
  });

  it("differs between the fixtures", () => {
    const hashes = PROJECT_KINDS.map((kind) =>
      hashDoc(FIXTURES_BY_KIND[kind]()),
    );
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("what the hash ignores", () => {
  it("is identical for two documents differing only in key order", () => {
    /* KEY_ORDER_INSENSITIVE — the check Phase 04's render reuse rests on. */
    const doc = redditStoryFixture();
    expect(hashDoc(reorderedDoc(doc))).toBe(hashDoc(doc));
  });

  it("ignores a renamed track", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    const track = doc.tracks[0];
    if (track === undefined) throw new Error("no tracks");
    track.label = "Renamed in the editor";
    expect(hashDoc(doc)).toBe(before);
  });

  it("ignores a renamed clip", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    const track = doc.tracks[0];
    if (track === undefined || track.type !== "video")
      throw new Error("no video track");
    const item = track.items[0];
    if (item === undefined) throw new Error("empty track");
    item.label = "Renamed clip";
    expect(hashDoc(doc)).toBe(before);
  });

  it("ignores a field set to undefined versus absent", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    const track = doc.tracks[0];
    if (track === undefined || track.type !== "video")
      throw new Error("no video track");
    const item = track.items[0];
    if (item === undefined) throw new Error("empty track");
    /* A stored document cannot tell the two apart once it is JSON, so neither
     * can the hash. */
    Object.assign(item, { gain: undefined });
    expect(hashDoc(doc)).toBe(before);
  });

  it("ignores float noise below the storage precision", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    const track = doc.tracks[0];
    if (track === undefined || track.type !== "video")
      throw new Error("no video track");
    const item = track.items[0];
    if (item === undefined) throw new Error("empty track");
    item.duration = Number(item.duration) + 1e-12;
    expect(hashDoc(doc)).toBe(before);
  });

  it("names exactly one ignored field today", () => {
    /* Every addition here is a decision to serve a stale video. If this fails,
     * read CACHE_IRRELEVANT_FIELDS' WHY before changing the number. */
    expect(CACHE_IRRELEVANT_FIELDS).toEqual(["label"]);
  });
});

describe("what the hash notices", () => {
  it("notices a changed duration", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    const track = doc.tracks[0];
    if (track === undefined || track.type !== "video")
      throw new Error("no video track");
    const item = track.items[0];
    if (item === undefined) throw new Error("empty track");
    item.duration = Number(item.duration) - 0.5;
    expect(hashDoc(doc)).not.toBe(before);
  });

  it("notices a changed asset", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    doc.assets["bg_loop_07"] = {
      assetId: "ast_other",
      kind: "video",
      license: "owned",
    };
    expect(hashDoc(doc)).not.toBe(before);
  });

  it("notices a changed word", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    const word = doc.words[0];
    if (word === undefined) throw new Error("no words");
    word.w = "Different";
    expect(hashDoc(doc)).not.toBe(before);
  });

  it("notices a changed caption style", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    doc.style.captionStyleId = "clean-lower";
    expect(hashDoc(doc)).not.toBe(before);
  });

  it("notices a changed canvas", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    doc.canvas = { width: 1080, height: 1080, fps: 30 };
    expect(hashDoc(doc)).not.toBe(before);
  });

  it("notices a reordered track, which changes what draws on top", () => {
    const doc = quizFixture();
    const before = hashDoc(doc);
    const result = apply(doc, [
      { type: "reorder", trackId: "questions", itemIds: ["q2", "q1"] },
    ]);
    expect(result.errors).toEqual([]);
    expect(hashDoc(result.doc)).not.toBe(before);
  });

  it("notices the difference between anchored and resolved", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    doc.timing = "anchored";
    expect(hashDoc(doc)).not.toBe(before);
  });

  it("notices a deleted item", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    const result = apply(doc, [
      { type: "delete", itemId: "o2", ripple: false },
    ]);
    expect(hashDoc(result.doc)).not.toBe(before);
  });
});

describe("canonicalize", () => {
  it("drops cache-irrelevant keys at any depth", () => {
    const canonical = canonicalize({
      label: "top",
      nested: { label: "inner", keep: 1 },
      list: [{ label: "in a list", keep: 2 }],
    });
    expect(canonical).toEqual({ nested: { keep: 1 }, list: [{ keep: 2 }] });
  });

  it("rounds numbers to the storage precision", () => {
    expect(canonicalize({ t: 2.2000000000000002 })).toEqual({ t: 2.2 });
  });

  it("maps a non-finite number to zero rather than producing invalid JSON", () => {
    expect(canonicalize({ t: Number.POSITIVE_INFINITY })).toEqual({ t: 0 });
    expect(canonicalize({ t: Number.NaN })).toEqual({ t: 0 });
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toEqual([3, 1, 2]);
  });
});

describe("stableStringify", () => {
  it("sorts object keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("does not sort arrays", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("escapes keys and strings as JSON does", () => {
    expect(stableStringify({ 'a"b': 'c"d' })).toBe('{"a\\"b":"c\\"d"}');
  });

  it("is identical for the same object built two ways", () => {
    const forwards = { a: 1, b: { c: 2, d: 3 } };
    const backwards = { b: { d: 3, c: 2 }, a: 1 };
    expect(stableStringify(forwards)).toBe(stableStringify(backwards));
  });
});
