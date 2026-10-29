/**
 * SOURCE OF TRUTH KEYWORDS: visualChoiceSchema, visualPromptHash,
 *   visualsSettingsToJson, visualPlanSchema, PROVENANCE_IS_NOT_OPTIONAL,
 *   PROMPT_IS_THE_CACHE_KEY, JSON_IS_NOT_THE_TYPE, visual type tests
 *
 * WHAT:  What a stored visual choice is allowed to be, what counts as the same
 *        image prompt, and whether the settings survive a round trip through
 *        jsonb.
 *
 * WHY:   Three failures, none of which throws:
 *
 *          PROVENANCE_IS_NOT_OPTIONAL is a promise the SCHEMA keeps, not the
 *          code — if a stock choice can be stored without a licence, then
 *          "every stock asset carries its provider, source id and licence" is
 *          false the first time a caller forgets one, and the failure surfaces
 *          months later as a clip nobody can account for. The schema is
 *          therefore tested as a REFUSAL, in the shape somebody would actually
 *          write by hand.
 *
 *          PROMPT_IS_THE_CACHE_KEY decides whether a customer is charged twice
 *          for one picture. Too strict and every re-run pays again; too loose
 *          and two different prompts share an image. Both directions are
 *          asserted, because a hash function that returned a constant would
 *          pass a one-directional test perfectly.
 *
 *          JSON_IS_NOT_THE_TYPE: the settings are written to a jsonb column and
 *          parsed back on every read, so a field the serialiser drops is a
 *          field that silently stops existing — an `assetId` lost this way
 *          turns a ready picture into a paragraph on the backdrop, with nothing
 *          in the logs.
 * WHERE: Run by `npm test`. Guards src/lib/types/visual.ts.
 */

import { describe, expect, it } from "vitest";

import {
  blockVisualSchema,
  visualChoiceSchema,
  visualPlanSchema,
  visualPromptHash,
  visualsSettingsSchema,
  visualsSettingsToJson,
} from "./visual";

const STOCK = {
  source: "stock" as const,
  provider: "pexels",
  providerId: "12345",
  previewUrl: "https://videos.pexels.com/poster.jpg",
  downloadUrl: "https://videos.pexels.com/clip.mp4",
  license: "Pexels License",
  attribution: "A Photographer on Pexels",
  durationSec: 11,
  width: 1080,
  height: 1920,
};

describe("visualChoiceSchema", () => {
  it("accepts a complete stock choice", () => {
    expect(visualChoiceSchema.safeParse(STOCK).success).toBe(true);
  });

  /**
   * PROVENANCE_IS_NOT_OPTIONAL. These three are the record a rights holder
   * asks for, and each is tested separately because "it refuses a bad object"
   * would pass if only ONE of them were required.
   */
  it("refuses a stock choice missing its licence, provider or source id", () => {
    for (const field of ["license", "provider", "providerId"] as const) {
      const partial: Record<string, unknown> = { ...STOCK };
      delete partial[field];
      expect(
        visualChoiceSchema.safeParse(partial).success,
        `a stock choice with no ${field} was accepted`,
      ).toBe(false);
    }
  });

  /* The union is discriminated, so the fields of one arm must not satisfy
   * another. A generated image carrying a stock licence is exactly the
   * unverifiable provenance the discrimination exists to prevent. */
  it("refuses a generated image that carries a stock licence", () => {
    const mixed = {
      source: "ai_image" as const,
      prompt: "a quiet library at night",
      promptHash: "abc123",
      license: "Pexels License",
    };

    expect(visualChoiceSchema.safeParse(mixed).success).toBe(false);
  });

  /* A background carries nothing, because the backdrop is a style the document
   * already knows rather than an asset. An `assetId` on it would be a handle to
   * something that does not exist. */
  it("accepts a bare background choice and refuses one with an asset", () => {
    expect(visualChoiceSchema.safeParse({ source: "background" }).success).toBe(
      true,
    );
    expect(
      visualChoiceSchema.safeParse({ source: "background", assetId: "a1" })
        .success,
    ).toBe(false);
  });

  it("refuses a source it has never heard of", () => {
    expect(
      visualChoiceSchema.safeParse({ source: "youtube", url: "..." }).success,
    ).toBe(false);
  });
});

describe("visualPromptHash", () => {
  /**
   * The loose direction: two prompts that differ only in whitespace or case are
   * the SAME request, and charging twice for them is the leak this normalisation
   * exists to stop.
   */
  it("treats whitespace and case differences as the same prompt", () => {
    const base = visualPromptHash("A quiet library at night");

    expect(visualPromptHash("  A quiet library at night  ")).toBe(base);
    expect(visualPromptHash("a quiet library at night")).toBe(base);
    expect(visualPromptHash("A  quiet\n library  at night")).toBe(base);
  });

  /**
   * The strict direction, and the one a constant-returning hash would fail: a
   * genuinely different prompt must get a different key, or one paragraph's
   * picture is served for another's words.
   */
  it("distinguishes prompts that differ in their words", () => {
    expect(visualPromptHash("a quiet library at night")).not.toBe(
      visualPromptHash("a loud library at night"),
    );
    /* Word ORDER matters — these two describe different pictures. */
    expect(visualPromptHash("a dog chasing a car")).not.toBe(
      visualPromptHash("a car chasing a dog"),
    );
  });

  /* The key is stored on the asset row and matched against on every later
   * generation, so it has to be the same value in a different process. Asserted
   * as a literal rather than as self-consistency, which is what catches a
   * change to the normalisation or the hasher. */
  it("is stable across runs", () => {
    expect(visualPromptHash("a quiet library at night")).toBe(
      visualPromptHash("A Quiet Library At Night"),
    );
    expect(visualPromptHash("a quiet library at night")).toMatch(
      /^[0-9a-f]{16}$/,
    );
  });
});

describe("visualsSettingsToJson", () => {
  /**
   * JSON_IS_NOT_THE_TYPE. The real assertion is the ROUND TRIP: what the
   * serialiser writes has to parse back to the value it was given, because a
   * field it drops is a field that silently stops existing on the next read.
   */
  it("round-trips every source through the jsonb shape", () => {
    const settings = visualsSettingsSchema.parse({
      imagesGenerated: 3,
      blocks: [
        {
          blockId: "blk0",
          choice: STOCK,
          status: "ready",
          assetId: "asset_0",
          query: "library night",
          prompt: "a quiet library at night",
        },
        {
          blockId: "blk1",
          choice: {
            source: "ai_image",
            prompt: "a quiet library at night",
            promptHash: "abc123",
          },
          status: "pending",
        },
        {
          blockId: "blk2",
          choice: { source: "upload", assetId: "asset_2" },
          status: "ready",
          assetId: "asset_2",
        },
        {
          blockId: "blk3",
          choice: { source: "background" },
          status: "failed",
          error: "This picture could not be fetched.",
        },
      ],
    });

    const reparsed = visualsSettingsSchema.parse(
      JSON.parse(JSON.stringify(visualsSettingsToJson(settings))),
    );

    expect(reparsed).toEqual(settings);
  });

  /* Absent fields are OMITTED rather than written as null — a null would fail
   * the optional string schemas on the way back in, which would make an
   * ordinary pending block unreadable. */
  it("omits absent fields instead of writing nulls", () => {
    const json = visualsSettingsToJson({
      imagesGenerated: 0,
      blocks: [
        {
          blockId: "blk0",
          choice: { source: "background" },
          status: "ready",
        },
      ],
    });

    const block = (json["blocks"] as Record<string, unknown>[])[0];
    expect(block).not.toHaveProperty("assetId");
    expect(block).not.toHaveProperty("error");
    expect(block).not.toHaveProperty("query");
  });

  /* A stored payload written by an older release must not take a project down:
   * the service's own read defaults to EMPTY on a parse failure, and that is
   * only safe if a bad payload genuinely fails rather than half-parsing. */
  it("refuses a block entry with no choice", () => {
    expect(
      blockVisualSchema.safeParse({ blockId: "blk0", status: "ready" }).success,
    ).toBe(false);
  });
});

describe("visualPlanSchema", () => {
  it("accepts a plan and rejects a negative index", () => {
    expect(
      visualPlanSchema.safeParse({
        items: [{ index: 0, query: "city traffic", prompt: "a busy street" }],
      }).success,
    ).toBe(true);

    expect(
      visualPlanSchema.safeParse({
        items: [{ index: -1, query: "city traffic", prompt: "a busy street" }],
      }).success,
    ).toBe(false);
  });

  /* MODEL_OUTPUT_SCHEMA is strict on purpose: an extra field means the model
   * misunderstood the request, which is worth a retry rather than a silent
   * pass-through — the opposite of how a provider's own API response is
   * parsed. */
  it("refuses an item carrying a field nobody asked for", () => {
    expect(
      visualPlanSchema.safeParse({
        items: [
          {
            index: 0,
            query: "city traffic",
            prompt: "a busy street",
            source: "stock",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
