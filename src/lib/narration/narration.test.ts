/**
 * SOURCE OF TRUTH KEYWORDS: splitBlockIntoLines, splitScriptIntoLines,
 *   narrationTextHash, TEXT_HASH_COVERS_THE_VOICE, SPLIT_ON_SENTENCES,
 *   ABBREVIATIONS_ARE_NOT_ENDS, POSITION_IS_STABLE, narration tests
 *
 * WHAT:  Where a line breaks, and what counts as the same recording.
 *
 * WHY:   Both failures here are AUDIBLE and neither throws. A bad split
 *        produces a speaker saying "Dr" and then, after a pause, "Chen said" —
 *        synthesised as two separate thoughts, which is immediately obvious to
 *        a listener and invisible to every test that only checks types. A bad
 *        cache key hands a customer the previous speaker's audio, with nothing
 *        in the logs to explain why the video is in the wrong voice.
 *
 *        The cache-key tests are written as the two directions, the same shape
 *        as the render cache-key tests, because this is the same class of
 *        mistake Phase 04 shipped: a key describing the INPUT rather than the
 *        OUTPUT.
 * WHERE: Run by `npm test`. Guards src/lib/narration/.
 */

import { describe, expect, it } from "vitest";

import { LINE_MAX_CHARS, LINE_MIN_CHARS } from "@/lib/types/voice";
import { narrationTextHash, normaliseForHash } from "./hash";
import { splitBlockIntoLines, splitScriptIntoLines } from "./split";

describe("splitBlockIntoLines", () => {
  it("leaves a short block as one line", () => {
    /* Splitting what fits would be a provider call per sentence for a block
     * that was always going to be one take. */
    const text = "The reactor reached criticality at noon. Nobody expected it.";
    expect(splitBlockIntoLines(text)).toEqual([text]);
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(splitBlockIntoLines("")).toEqual([]);
    expect(splitBlockIntoLines("   \n  ")).toEqual([]);
  });

  it("normalises whitespace rather than preserving layout", () => {
    /* The text becomes speech — a line break is not a pause, and leaving it in
     * only makes two identical-sounding lines hash differently. */
    expect(splitBlockIntoLines("one\n\n  two")).toEqual(["one two"]);
  });

  it("splits a long block into lines under the cap", () => {
    const sentence = "This is a reasonably long sentence about the reactor. ";
    const block = sentence.repeat(12).trim();

    const lines = splitBlockIntoLines(block);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length, line).toBeLessThanOrEqual(LINE_MAX_CHARS);
    }
    /* Nothing lost: the words are all still there, in order. */
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe(block.replace(/\s+/g, " "));
  });

  /**
   * ABBREVIATIONS_ARE_NOT_ENDS — the naive "split on a dot" rule cuts these in
   * half, and each half is then synthesised as a complete thought. A speaker
   * saying "Dr" and then pausing before "Chen" is immediately audible.
   */
  it("does not split inside a title or an abbreviation", () => {
    const filler = "Padding sentence to push this block past the cap. ".repeat(6);
    const block = `${filler}Dr. Chen said the result held. Prof. Ada agreed.`;

    for (const line of splitBlockIntoLines(block)) {
      expect(line, line).not.toMatch(/\bDr\.?$/);
      expect(line, line).not.toMatch(/\bProf\.?$/);
    }
  });

  it("does not split inside a decimal number", () => {
    const filler = "Padding sentence to push this block past the cap. ".repeat(6);
    const block = `${filler}Costs fell by 4.2 percent last year.`;

    for (const line of splitBlockIntoLines(block)) {
      expect(line, line).not.toMatch(/\b4\.?$/);
    }
    expect(splitBlockIntoLines(block).join(" ")).toContain("4.2 percent");
  });

  it("does not split before a lowercase continuation", () => {
    /* A dot followed by lowercase is far more likely to be an abbreviation
     * than a sentence boundary. */
    const filler = "Padding sentence to push this block past the cap. ".repeat(6);
    const block = `${filler}Measured in kg. per square metre of surface.`;
    expect(splitBlockIntoLines(block).join(" ")).toContain("kg. per square");
  });

  it("treats a run of terminal punctuation as one ending", () => {
    const filler = "Padding sentence to push this block past the cap. ".repeat(6);
    const block = `${filler}Did it really work?! Everyone cheered.`;
    const lines = splitBlockIntoLines(block);
    /* No line is just the stray punctuation. */
    for (const line of lines) {
      expect(line.trim().length).toBeGreaterThan(1);
    }
  });

  it("keeps a short trailing fragment with the line before it", () => {
    /* KEEP_SHORT_FRAGMENTS_TOGETHER — "Yes." is not worth a recording of its
     * own, and alone it is synthesised without the sentence it answers. */
    const filler = "Padding sentence to push this block past the cap. ".repeat(6);
    const lines = splitBlockIntoLines(`${filler}Yes.`);

    const last = lines[lines.length - 1] ?? "";
    expect(last.length).toBeGreaterThanOrEqual(LINE_MIN_CHARS);
    expect(last).toContain("Yes.");
  });

  it("does not split a single sentence that is longer than the cap", () => {
    /* There is no safe place to cut one, and the provider handles a long
     * sentence far better than an arbitrary break would. */
    const long = `${"word ".repeat(100).trim()}.`;
    expect(splitBlockIntoLines(long)).toHaveLength(1);
  });
});

describe("splitScriptIntoLines", () => {
  it("numbers positions across the whole script, not per block", () => {
    /* POSITION_IS_STABLE — per-block numbering makes two blocks' line 0
     * collide, and the order then depends on something else being carried. */
    const lines = splitScriptIntoLines([
      { id: "b1", narrationText: "First block." },
      { id: "b2", narrationText: "Second block." },
      { id: "b3", narrationText: "Third block." },
    ]);

    expect(lines.map((line) => line.position)).toEqual([0, 1, 2]);
    expect(lines.map((line) => line.blockId)).toEqual(["b1", "b2", "b3"]);
  });

  it("produces the same positions for the same script every time", () => {
    /* The phase requires stability across regeneration — it is what makes a
     * textHash cache hit land on the right line rather than merely on a line
     * with the right words. */
    const blocks = [
      { id: "b1", narrationText: "A sentence here. And another one after it." },
      { id: "b2", narrationText: "More narration follows." },
    ];
    expect(splitScriptIntoLines(blocks)).toEqual(splitScriptIntoLines(blocks));
  });

  it("carries the speaker tag onto every line from its block", () => {
    const lines = splitScriptIntoLines([
      { id: "b1", narrationText: "Hello there.", speakerTag: "OP" },
      { id: "b2", narrationText: "Hello back.", speakerTag: "A" },
    ]);
    expect(lines.map((line) => line.speakerTag)).toEqual(["OP", "A"]);
  });

  it("defaults a missing speaker tag rather than leaving it empty", () => {
    /* An empty tag gives validateAssignments nothing to report against, and
     * the single-narrator case is every project until Phase 12. */
    const lines = splitScriptIntoLines([
      { id: "b1", narrationText: "No tag here." },
      { id: "b2", narrationText: "Nor here.", speakerTag: "   " },
      { id: "b3", narrationText: "Nor here either.", speakerTag: null },
    ]);
    for (const line of lines) {
      expect(line.speakerTag).toBe("narrator");
    }
  });

  it("skips blocks with no text without disturbing the numbering", () => {
    const lines = splitScriptIntoLines([
      { id: "b1", narrationText: "Real content." },
      { id: "b2", narrationText: "   " },
      { id: "b3", narrationText: "More content." },
    ]);
    expect(lines.map((line) => line.position)).toEqual([0, 1]);
    expect(lines.map((line) => line.blockId)).toEqual(["b1", "b3"]);
  });
});

describe("narrationTextHash", () => {
  it("is stable for identical inputs", () => {
    /* The whole premise of the cache. If this were ever false, every
     * regeneration would re-synthesise everything and nothing would say why. */
    expect(narrationTextHash("hello there", "v1")).toBe(
      narrationTextHash("hello there", "v1"),
    );
  });

  /**
   * TEXT_HASH_COVERS_THE_VOICE — the failure this exists to prevent. Without
   * the voice in the key, changing the cast hands the customer the previous
   * speaker's audio, and nothing errors because the cache hit is a real row
   * with real audio behind it.
   */
  it("differs when the voice differs, so a recast is not served stale audio", () => {
    expect(narrationTextHash("same words", "voice-a")).not.toBe(
      narrationTextHash("same words", "voice-b"),
    );
  });

  it("differs when the text differs", () => {
    expect(narrationTextHash("one", "v1")).not.toBe(
      narrationTextHash("two", "v1"),
    );
  });

  it("ignores whitespace changes, so reflowing a line is free", () => {
    expect(narrationTextHash("hello   there", "v1")).toBe(
      narrationTextHash(" hello there ", "v1"),
    );
    expect(narrationTextHash("hello\nthere", "v1")).toBe(
      narrationTextHash("hello there", "v1"),
    );
  });

  it("does NOT ignore case or punctuation, which change the delivery", () => {
    /* A cache that collapsed these would return "stop." for "Stop!". */
    expect(narrationTextHash("stop.", "v1")).not.toBe(
      narrationTextHash("Stop!", "v1"),
    );
    expect(narrationTextHash("really", "v1")).not.toBe(
      narrationTextHash("Really", "v1"),
    );
  });

  it("cannot be collided by shifting the boundary between text and voice", () => {
    /* A separator-free concatenation is the classic way to make two different
     * inputs hash the same. */
    expect(narrationTextHash("ab", "c")).not.toBe(narrationTextHash("a", "bc"));
  });

  it("hashes an unassigned voice stably", () => {
    /* Those lines are never synthesised, but the row still has to be written
     * and compared before the cast is chosen. */
    expect(narrationTextHash("words", null)).toBe(
      narrationTextHash("words", undefined),
    );
    expect(narrationTextHash("words", null)).toBe(narrationTextHash("words", ""));
    expect(narrationTextHash("words", null)).not.toBe(
      narrationTextHash("words", "v1"),
    );
  });

  it("is short and safe in a column and an index", () => {
    const hash = narrationTextHash("some narration", "voice-1");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("normaliseForHash", () => {
  it("strips invisible characters that would cause a silent cache miss", () => {
    /* These survive a copy-paste and are invisible in an editor, so two lines
     * that look identical would otherwise hash differently. */
    expect(normaliseForHash("a\u0000b\u007fc")).toBe("a b c");
  });
});
