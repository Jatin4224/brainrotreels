/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: footage types test, generateFootageSchema,
 *   DURATION_IS_A_CLOSED_SET, THE_PROMPT_IS_THE_ONLY_FREE_FIELD,
 *   footagePromptHash, PROMPT_IS_THE_CACHE_KEY
 *
 * WHAT:  That a generation request cannot ask for a length we do not sell or a
 *        field we do not offer, and that the prompt hash normalises the way
 *        the cache depends on.
 *
 * WHY:   DURATION_IS_A_CLOSED_SET is the assertion that keeps the feature
 *        affordable, and it is worth a test because the obvious "improvement"
 *        is a number with a maximum. Generated video is billed per second, so
 *        a free-form duration is a sixty-second request costing more than
 *        everything else a customer has ever done — and the price is quoted on
 *        a button from a closed set of two.
 *
 *        THE_PROMPT_IS_THE_ONLY_FREE_FIELD. A schema that silently accepted a
 *        `model` or an `aspect` would let a caller pick a model whose terms
 *        nobody has read, which is the one thing this phase is gated on.
 *        Strict parsing is what makes that impossible rather than merely
 *        undocumented.
 *
 *        PROMPT_IS_THE_CACHE_KEY: the hash is what decides whether the most
 *        expensive call in the product happens twice. If it stopped
 *        normalising whitespace and case, two spellings of one prompt would
 *        each be charged.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FOOTAGE_DURATION,
  FOOTAGE_DURATIONS,
  FOOTAGE_PROMPT_MAX,
  estimateFootageSchema,
  generateFootageSchema,
} from "./footage";
import { footagePromptHash } from "@/services/footage.service";

const valid = {
  organizationId: "org_1",
  prompt: "Slow aerial push over a misty pine forest",
  durationSec: 5,
};

describe("a generation request", () => {
  it("accepts the lengths this product sells", () => {
    for (const durationSec of FOOTAGE_DURATIONS) {
      expect(
        generateFootageSchema.safeParse({ ...valid, durationSec }).success,
        `${durationSec}s`,
      ).toBe(true);
    }
  });

  it("refuses a length we do not sell", () => {
    /* DURATION_IS_A_CLOSED_SET — a per-second price and a free-form duration
     * is how one request costs more than a customer's whole month. */
    for (const durationSec of [1, 4, 6, 15, 60, 0, -5, 5.5]) {
      expect(
        generateFootageSchema.safeParse({ ...valid, durationSec }).success,
        `${durationSec}s`,
      ).toBe(false);
    }
  });

  it("defaults to the cheapest option", () => {
    /* A screen should default to spending the least. */
    expect(DEFAULT_FOOTAGE_DURATION).toBe(Math.min(...FOOTAGE_DURATIONS));
  });

  it("refuses a prompt that is empty or a mis-click", () => {
    expect(generateFootageSchema.safeParse({ ...valid, prompt: "" }).success).toBe(
      false,
    );
    expect(
      generateFootageSchema.safeParse({ ...valid, prompt: "  " }).success,
    ).toBe(false);
    expect(generateFootageSchema.safeParse({ ...valid, prompt: "a" }).success).toBe(
      false,
    );
  });

  it("refuses a prompt longer than a classifier should be sent", () => {
    const tooLong = "x".repeat(FOOTAGE_PROMPT_MAX + 1);
    expect(
      generateFootageSchema.safeParse({ ...valid, prompt: tooLong }).success,
    ).toBe(false);
  });

  it("trims the prompt, so the hash and the record agree", () => {
    const parsed = generateFootageSchema.safeParse({
      ...valid,
      prompt: "  a misty forest  ",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.prompt).toBe("a misty forest");
  });

  it("offers no way to choose a model or an aspect", () => {
    /**
     * THE_PROMPT_IS_THE_ONLY_FREE_FIELD, asserted on the PARSED value rather
     * than on the parse succeeding, because Zod strips unknown keys by default
     * — so the question is not whether the request is refused but whether the
     * field reaches anything. Which model is permissible is settled per
     * deployment, on legal advice; a caller that could name one would be
     * choosing terms nobody read.
     */
    const parsed = generateFootageSchema.safeParse({
      ...valid,
      model: "something-else",
      aspect: "16:9",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual(valid);
  });
});

describe("the cost query", () => {
  it("takes a length and no prompt", () => {
    /* The price depends only on the length. Asking for a prompt would imply
     * otherwise, and a screen would send one. */
    const parsed = estimateFootageSchema.safeParse({
      organizationId: "org_1",
      durationSec: 10,
      prompt: "ignored",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({ organizationId: "org_1", durationSec: 10 });
  });
});

describe("the prompt hash", () => {
  it("ignores case, padding and repeated whitespace", () => {
    /* PROMPT_IS_THE_CACHE_KEY — two spellings of one prompt must not be
     * charged twice. */
    const base = footagePromptHash("A misty pine forest");
    expect(footagePromptHash("a misty pine forest")).toBe(base);
    expect(footagePromptHash("  A MISTY PINE FOREST  ")).toBe(base);
    expect(footagePromptHash("A  misty\tpine\nforest")).toBe(base);
  });

  it("separates genuinely different prompts", () => {
    expect(footagePromptHash("a misty pine forest")).not.toBe(
      footagePromptHash("a misty oak forest"),
    );
  });
});
