/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: validate tests, BAD_DURATION, OUT_OF_RANGE,
 *   BAD_WORD_RANGE, UNKNOWN_ASSET, UNKNOWN_SPEAKER, DUPLICATE_ID, Z_COLLISION,
 *   OUT_OF_BOUNDS, UNRESOLVED_ANCHOR, STALE_RESOLUTION, NEVER_THROWS
 *
 * WHAT:  One test per validation rule, each starting from a valid fixture and
 *        breaking exactly one thing.
 * WHY:   Breaking one thing at a time is what proves the rules are independent.
 *        A test that builds a broken document from scratch passes as soon as
 *        ANY rule fires, so it cannot tell a working rule from a rule that
 *        happens to be shadowed by the schema parse.
 *        Every case also asserts the error PATH, because the path is what the
 *        editor uses to highlight a clip — a correct code on the wrong path is
 *        a rule that works for the render pre-flight and silently fails the UI.
 * WHERE: Run by `npm test`. Guards src/lib/timeline/validate.ts.
 */

import { describe, expect, it } from "vitest";

import {
  FIXTURES_BY_KIND,
  motionFixture,
  redditStoryFixture,
  voiceoverFixture,
} from "./fixtures";
import { PROJECT_KINDS } from "@/lib/types/project";
import { validate } from "./validate";
import type { TimelineDoc } from "./schema";
import type { TimelineErrorCode } from "./errors";

/* Finds the first video item so a test can break it without caring where the
 * fixture put the background track. */
function firstVideoItem(doc: TimelineDoc) {
  const track = doc.tracks.find((candidate) => candidate.id === "bg");
  if (track === undefined || track.type !== "video")
    throw new Error("fixture has no bg track");
  const item = track.items[0];
  if (item === undefined) throw new Error("bg track is empty");
  return item;
}

function captionTrack(doc: TimelineDoc) {
  const track = doc.tracks.find((candidate) => candidate.type === "caption");
  if (track === undefined || track.type !== "caption")
    throw new Error("fixture has no captions");
  return track;
}

function overlayTrack(doc: TimelineDoc) {
  const track = doc.tracks.find((candidate) => candidate.type === "overlay");
  if (track === undefined || track.type !== "overlay")
    throw new Error("fixture has no overlays");
  return track;
}

function codesAndPaths(
  result: ReturnType<typeof validate>,
): Array<[TimelineErrorCode, string]> {
  return result.ok
    ? []
    : result.errors.map((error) => [error.code, error.path]);
}

function expectError(
  result: ReturnType<typeof validate>,
  code: TimelineErrorCode,
  pathFragment: string,
): void {
  expect(result.ok).toBe(false);
  const matches = codesAndPaths(result).filter(
    ([foundCode, path]) => foundCode === code && path.includes(pathFragment),
  );
  expect(
    matches,
    `expected ${code} on a path containing "${pathFragment}", got ${JSON.stringify(codesAndPaths(result))}`,
  ).not.toHaveLength(0);
}

describe("the fixtures are valid", () => {
  it.each(PROJECT_KINDS)("%s validates", (kind) => {
    const result = validate(FIXTURES_BY_KIND[kind]());
    expect(
      result.ok,
      result.ok ? "" : JSON.stringify(result.errors, null, 2),
    ).toBe(true);
  });

  it("returns the PARSED document, with schema defaults applied", () => {
    const result = validate(redditStoryFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    /* `fit`, `muted` and `gain` carry defaults, so the caller gets the
     * normalised form and no two readers can disagree about a missing field. */
    expect(firstVideoItem(result.doc).fit).toBe("cover");
  });
});

describe("it never throws", () => {
  it.each([
    ["null", null],
    ["a string", "not a document"],
    ["a number", 42],
    ["an empty object", {}],
    ["an array", []],
    ["a document with no tracks key", { version: 4, kind: "quiz" }],
  ])("returns errors for %s rather than throwing", (_label, input) => {
    const result = validate(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => error.code === "SCHEMA")).toBe(true);
  });

  it('reports the failing field path, not just "document"', () => {
    const doc = redditStoryFixture();
    const bad = { ...doc, canvas: { ...doc.canvas, fps: 0 } };
    expectError(validate(bad), "SCHEMA", "canvas.fps");
  });
});

describe("timing rules", () => {
  it("rejects a zero duration", () => {
    const doc = redditStoryFixture();
    firstVideoItem(doc).duration = 0;
    expectError(validate(doc), "BAD_DURATION", "duration");
  });

  it("rejects a negative duration", () => {
    const doc = redditStoryFixture();
    firstVideoItem(doc).duration = -4;
    expectError(validate(doc), "BAD_DURATION", "duration");
  });

  it("rejects a negative start", () => {
    const doc = redditStoryFixture();
    firstVideoItem(doc).start = -1;
    expectError(validate(doc), "BAD_DURATION", "start");
  });

  it("rejects an overlay that runs past the end of the video", () => {
    const doc = redditStoryFixture();
    const overlay = overlayTrack(doc).items[0];
    if (overlay === undefined) throw new Error("no overlay");
    overlay.start = 0;
    overlay.duration = 9999;
    expectError(validate(doc), "OUT_OF_RANGE", "duration");
  });

  it("rejects an overlay that starts after the video ends", () => {
    const doc = redditStoryFixture();
    const overlay = overlayTrack(doc).items[0];
    if (overlay === undefined) throw new Error("no overlay");
    overlay.start = 9999;
    overlay.duration = 0.5;
    expect(validate(doc).ok).toBe(false);
  });

  it("does not apply the range rule to a document with no spine", () => {
    /* VIDEO_LENGTH_RULE's fallback: a motion piece has no video or audio lane,
     * so the length comes from the scenes and the rule is vacuous. */
    const result = validate(motionFixture());
    expect(result.ok).toBe(true);
  });

  it("tolerates float drift at the boundary", () => {
    const doc = redditStoryFixture();
    const item = firstVideoItem(doc);
    /* An item ending a tenth of a millisecond past the spine is not an error —
     * see TIME_EPSILON. */
    item.duration = Number(item.duration) + 0.0001;
    expect(validate(doc).ok).toBe(true);
  });
});

describe("word anchors", () => {
  it("accepts an anchored document", () => {
    expect(validate(voiceoverFixture()).ok).toBe(true);
  });

  it("rejects an anchor in a document marked resolved", () => {
    const doc = voiceoverFixture();
    doc.timing = "resolved";
    expectError(validate(doc), "UNRESOLVED_ANCHOR", "start");
  });

  it("rejects an anchor naming a word that is not in the script", () => {
    const doc = voiceoverFixture();
    const track = doc.tracks.find((candidate) => candidate.id === "broll");
    if (track === undefined || track.type !== "video")
      throw new Error("no broll");
    const item = track.items[1];
    if (item === undefined) throw new Error("no second shot");
    item.start = { word: "rutabaga" };
    expectError(validate(doc), "ANCHOR_NOT_FOUND", "start");
  });

  it("rejects a wordIndex past the end of the script", () => {
    const doc = voiceoverFixture();
    const track = overlayTrack(doc);
    const item = track.items[0];
    if (item === undefined) throw new Error("no overlay");
    item.start = { wordIndex: 9999 };
    expectError(validate(doc), "ANCHOR_NOT_FOUND", "start");
  });
});

describe("word tokens", () => {
  it("rejects an index that disagrees with its position", () => {
    const doc = redditStoryFixture();
    const token = doc.words[3];
    if (token === undefined) throw new Error("fixture is too short");
    token.i = 7;
    expectError(validate(doc), "BAD_WORD_TOKEN", "words.3.i");
  });

  it("rejects a word that ends before it starts", () => {
    const doc = redditStoryFixture();
    const token = doc.words[2];
    if (token === undefined) throw new Error("fixture is too short");
    token.e = token.s - 0.5;
    expectError(validate(doc), "BAD_WORD_TOKEN", "words.2.e");
  });

  it("rejects words that run backwards", () => {
    const doc = redditStoryFixture();
    const token = doc.words[4];
    if (token === undefined) throw new Error("fixture is too short");
    token.s = 0;
    token.e = 0.1;
    expectError(validate(doc), "BAD_WORD_TOKEN", "words.4.s");
  });
});

describe("caption word ranges", () => {
  it("rejects a range that points past the script", () => {
    const doc = redditStoryFixture();
    const caption = captionTrack(doc).items[0];
    if (caption === undefined) throw new Error("no caption");
    caption.endWord = 9999;
    expectError(validate(doc), "BAD_WORD_RANGE", "startWord");
  });

  it("rejects an inverted range", () => {
    const doc = redditStoryFixture();
    const caption = captionTrack(doc).items[0];
    if (caption === undefined) throw new Error("no caption");
    caption.startWord = 5;
    caption.endWord = 2;
    expectError(validate(doc), "BAD_WORD_RANGE", "endWord");
  });

  it("rejects a cached start that no longer matches the range", () => {
    const doc = redditStoryFixture();
    const caption = captionTrack(doc).items[0];
    if (caption === undefined) throw new Error("no caption");
    caption.start = 12.5;
    expectError(validate(doc), "STALE_RESOLUTION", "start");
  });

  it("rejects a cached duration that no longer matches the range", () => {
    const doc = redditStoryFixture();
    const caption = captionTrack(doc).items[0];
    if (caption === undefined) throw new Error("no caption");
    const first = doc.words[caption.startWord];
    if (first === undefined) throw new Error("no word");
    caption.start = first.s;
    caption.duration = 99;
    expectError(validate(doc), "STALE_RESOLUTION", "duration");
  });
});

describe("references", () => {
  it("rejects an item pointing at an asset the document does not list", () => {
    const doc = redditStoryFixture();
    firstVideoItem(doc).assetId = "bg_loop_99";
    expectError(validate(doc), "UNKNOWN_ASSET", "assetId");
  });

  it("rejects a scene element pointing at an unlisted asset", () => {
    const doc = redditStoryFixture();
    const track = doc.tracks.find((candidate) => candidate.type === "scene");
    if (track === undefined || track.type !== "scene")
      throw new Error("no scene track");
    const item = track.items[0];
    if (item === undefined) throw new Error("no scene item");
    const element = item.scene.elements[0];
    if (element === undefined) throw new Error("no element");
    element.assetId = "ghost_image";
    expectError(validate(doc), "UNKNOWN_ASSET", "scene.elements.0.assetId");
  });

  it("rejects an item voiced by a speaker not in the cast", () => {
    const doc = redditStoryFixture();
    const track = doc.tracks.find((candidate) => candidate.id === "narration");
    if (track === undefined || track.type !== "audio")
      throw new Error("no narration");
    const item = track.items[0];
    if (item === undefined) throw new Error("no narration item");
    item.speaker = "Z";
    expectError(validate(doc), "UNKNOWN_SPEAKER", "speaker");
  });

  it("rejects a word attributed to a speaker not in the cast", () => {
    const doc = redditStoryFixture();
    const token = doc.words[0];
    if (token === undefined) throw new Error("no words");
    token.speaker = "Q";
    expectError(validate(doc), "UNKNOWN_SPEAKER", "words.0.speaker");
  });
});

describe("identity", () => {
  it("rejects two items sharing an id, even on different tracks", () => {
    const doc = redditStoryFixture();
    const overlay = overlayTrack(doc).items[0];
    if (overlay === undefined) throw new Error("no overlay");
    overlay.id = firstVideoItem(doc).id;
    expectError(validate(doc), "DUPLICATE_ID", "id");
  });

  it("rejects two tracks sharing an id", () => {
    const doc = redditStoryFixture();
    const second = doc.tracks[1];
    const first = doc.tracks[0];
    if (second === undefined || first === undefined)
      throw new Error("fixture has too few tracks");
    second.id = first.id;
    expectError(validate(doc), "DUPLICATE_ID", "tracks.1.id");
  });
});

describe("overlay depth", () => {
  it("rejects two overlapping overlays at the same depth", () => {
    const doc = redditStoryFixture();
    const items = overlayTrack(doc).items;
    const [first, second] = items;
    if (first === undefined || second === undefined)
      throw new Error("need two overlays");
    second.z = first.z;
    second.start = Number(first.start);
    second.duration = Number(first.duration);
    expectError(validate(doc), "Z_COLLISION", "z");
  });

  it("allows two overlays to share a depth when they never share a moment", () => {
    const doc = redditStoryFixture();
    const items = overlayTrack(doc).items;
    const [first, second] = items;
    if (first === undefined || second === undefined)
      throw new Error("need two overlays");
    first.start = 0;
    first.duration = 1;
    second.z = first.z;
    second.start = 1;
    second.duration = 1;
    expect(validate(doc).ok).toBe(true);
  });
});

describe("canvas bounds", () => {
  it("rejects a box that runs off the right edge", () => {
    const doc = redditStoryFixture();
    const overlay = overlayTrack(doc).items[0];
    if (overlay === undefined) throw new Error("no overlay");
    overlay.box = { x: 0.8, y: 0.1, w: 0.4, h: 0.1 };
    expectError(validate(doc), "OUT_OF_BOUNDS", "box");
  });

  it("rejects a negative box origin", () => {
    const doc = redditStoryFixture();
    const overlay = overlayTrack(doc).items[0];
    if (overlay === undefined) throw new Error("no overlay");
    overlay.box = { x: -0.2, y: 0.1, w: 0.4, h: 0.1 };
    expectError(validate(doc), "OUT_OF_BOUNDS", "box");
  });

  it("rejects a zero-width box", () => {
    const doc = redditStoryFixture();
    const overlay = overlayTrack(doc).items[0];
    if (overlay === undefined) throw new Error("no overlay");
    overlay.box = { x: 0.1, y: 0.1, w: 0, h: 0.1 };
    expectError(validate(doc), "OUT_OF_BOUNDS", "box");
  });

  it("rejects a caption positioned off the canvas", () => {
    const doc = redditStoryFixture();
    const caption = captionTrack(doc).items[0];
    if (caption === undefined) throw new Error("no caption");
    caption.position = { y: 1.4 };
    expectError(validate(doc), "OUT_OF_BOUNDS", "position.y");
  });

  it("accepts a box that reaches exactly the edge", () => {
    const doc = redditStoryFixture();
    const overlay = overlayTrack(doc).items[0];
    if (overlay === undefined) throw new Error("no overlay");
    overlay.box = { x: 0, y: 0, w: 1, h: 1 };
    expect(validate(doc).ok).toBe(true);
  });
});

describe("error independence", () => {
  it("reports a broken word list once, not once per caption that reads it", () => {
    const doc = redditStoryFixture();
    const token = doc.words[1];
    if (token === undefined) throw new Error("fixture is too short");
    token.i = 99;

    const result = validate(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const rangeErrors = result.errors.filter(
      (error) => error.code === "BAD_WORD_RANGE",
    );
    expect(rangeErrors).toEqual([]);
  });

  it("collects several independent problems in one pass", () => {
    const doc = redditStoryFixture();
    firstVideoItem(doc).duration = 0;
    firstVideoItem(doc).assetId = "missing_asset";

    const result = validate(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = new Set(result.errors.map((error) => error.code));
    expect(codes.has("BAD_DURATION")).toBe(true);
    expect(codes.has("UNKNOWN_ASSET")).toBe(true);
  });
});
