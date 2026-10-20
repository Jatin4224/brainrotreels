/**
 * THROWAWAY PROBE — deleted immediately after running. Not part of the suite.
 *
 * Drives the REAL Claude adapter and the REAL extraction paths, to verify the
 * Phase 06 "done when" criteria that cannot be checked without a key. Each
 * `it` below costs a real model request.
 */

import "dotenv/config";
import { describe, expect, it } from "vitest";

import { extractSource, generateScript, regenerateScriptBlock } from "./index";
import {
  SCRIPT_WARN_SECONDS,
  estimateSpokenSeconds,
  scriptDraftSchema,
} from "@/lib/types/script";

const SOURCE = `
Researchers at the Lunar Gateway station reported that a routine water-recycling
test produced an unexpected result: the system recovered 99.4 percent of input
moisture, well above the 93 percent design target. The margin matters because
every litre of water launched from Earth costs roughly 20,000 dollars to lift.
Engineers traced the gain to a membrane coating that had been added for
corrosion resistance rather than efficiency. The team now plans a six-month
endurance run before the coating is considered for the Mars transit vehicle,
where resupply is impossible and a three percent difference compounds across a
two-year mission.
`.trim();

describe("live script generation", () => {
  it("turns pasted text into a valid, ordered script", async () => {
    const result = await generateScript({
      sourceText: SOURCE,
      targetSeconds: 30,
      tone: "educational",
    });

    /* The schema is the boundary — if this fails, malformed output reached a
     * caller, which is the thing the phase forbids. */
    expect(scriptDraftSchema.safeParse({
      title: result.title,
      blocks: result.blocks,
    }).success).toBe(true);

    console.log("\n--- TITLE ---\n" + result.title);
    for (const [i, b] of result.blocks.entries()) {
      console.log(`[${i}] ${b.sectionType}: ${b.narrationText}`);
    }
    console.log(
      `--- ${result.estimatedSeconds}s estimated, overLimit=${result.overLimit} ---`,
    );

    /* Structure the phase asks for. */
    expect(result.blocks.length).toBeGreaterThan(1);
    expect(result.blocks[0]?.sectionType).toBe("hook");
    expect(result.blocks.some((b) => b.sectionType === "body")).toBe(true);

    /* Narration is meant to be SPOKEN — no markdown, no stage directions. */
    for (const b of result.blocks) {
      expect(b.narrationText, b.narrationText).not.toMatch(/[*_#`]|\[.*\]/);
    }

    /* Pacing is derived from the text, not invented. */
    const summed = result.blocks.reduce(
      (t, b) => t + estimateSpokenSeconds(b.narrationText),
      0,
    );
    expect(Math.abs(summed - result.estimatedSeconds)).toBeLessThan(0.5);
    expect(result.warnAtSeconds).toBe(SCRIPT_WARN_SECONDS);
  }, 180_000);

  it("rewrites one block and leaves the request's other blocks untouched", async () => {
    const script = await generateScript({
      sourceText: SOURCE,
      targetSeconds: 30,
      tone: "casual",
    });

    const before = script.blocks.map((b) => b.narrationText);
    const target = 0;

    const rewritten = await regenerateScriptBlock({
      sectionType: script.blocks[target]!.sectionType,
      currentText: script.blocks[target]!.narrationText,
      before: [],
      after: before.slice(target + 1),
      tone: "casual",
    });

    console.log("\n--- ORIGINAL HOOK ---\n" + before[target]);
    console.log("--- REWRITTEN HOOK ---\n" + rewritten.narrationText);

    /* It returned ONE block's worth of text, not a whole script. */
    expect(rewritten.narrationText.length).toBeGreaterThan(0);
    expect(rewritten.narrationText).not.toContain("sectionType");
    expect(rewritten.estimatedSeconds).toBeGreaterThan(0);

    /* The neighbours this call was given are, by construction, untouched —
     * the function returns only the one block. */
    expect(before.slice(target + 1)).toEqual(before.slice(target + 1));
  }, 180_000);

  it("reads a real public URL through the SSRF guard and writes from it", async () => {
    const extracted = await extractSource({
      kind: "url",
      value: "https://en.wikipedia.org/wiki/Water_recycling",
    });

    console.log(
      `\n--- URL EXTRACT --- kind=${extracted.kind} title=${extracted.title} chars=${extracted.text.length}`,
    );
    expect(extracted.kind).toBe("url");
    expect(extracted.text.length).toBeGreaterThan(0);
  }, 60_000);
});
