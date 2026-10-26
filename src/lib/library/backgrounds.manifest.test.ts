/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: manifest tests, LICENCE_IS_NOT_OPTIONAL,
 *   PLACEHOLDER_LICENSES, DUPLICATE_KEY_IS_A_FORK, MANIFEST_IS_EMPTY_ON_PURPOSE,
 *   LICENSE_TERMS_ARE_NOT_A_CATEGORY, libraryAssetId
 *
 * WHAT:  Tests for the background manifest's discipline — the schema that
 *        decides whether a catalogue row is allowed to exist.
 *
 * WHY:   This is the one place the product's largest non-technical risk is
 *        enforceable by a machine. `Asset.license` defaults to `"owned"`, which
 *        is true of a customer's upload and a lie about a licensed loop, so the
 *        tests that matter here are the REFUSALS: a row that cannot state where
 *        it came from and what its licence permits must not be importable.
 *        Happy paths are asserted once; the rest is hostile input.
 *
 *        The drift test against the timeline document's own licence enum is
 *        here rather than in the timeline module because this is the side that
 *        would silently diverge: a category added to a document schema and not
 *        here produces a manifest that cannot express it, and the symptom is a
 *        validation failure at generate time rather than at import time.
 * WHERE: Run by `npm test`. Guards src/lib/library/backgrounds.manifest.ts and
 *        the schemas in src/lib/types/background.ts.
 */

import { describe, expect, it } from "vitest";

import { assertKeySegment } from "@/lib/adapters/storage/keys";
import { assetRefSchema } from "@/lib/timeline";
import {
  LICENSE_KINDS,
  backgroundManifestEntrySchema,
  backgroundManifestSchema,
  isPlaceholderLicense,
  libraryAssetId,
  licenseCategoryForSource,
  licenseTermsSchema,
} from "@/lib/types/background";
import {
  BACKGROUND_MANIFEST,
  findManifestEntry,
  manifestEntriesFor,
} from "./backgrounds.manifest";

/* A row that would really be acceptable, used as the base for every refusal so
 * each test changes exactly one thing. */
const VALID = {
  key: "calm-abstract-waves",
  title: "Calm abstract waves",
  kind: "background",
  contentType: "video/mp4",
  sourceUrl: "https://assets.example.com/loops/calm-abstract-waves.mp4",
  license:
    "CC0 1.0 Universal — public domain dedication, permits commercial use and end-user publication with no attribution.",
  minPlan: "free",
} as const;

describe("background manifest schema", () => {
  it("accepts a row that states its licence in full", () => {
    const parsed = backgroundManifestEntrySchema.safeParse(VALID);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  /* LICENCE_IS_NOT_OPTIONAL. The column default is the single most likely
   * wrong value, because it is what a row gets when nobody fills the field. */
  it("refuses the schema default as a licence", () => {
    expect(
      backgroundManifestEntrySchema.safeParse({ ...VALID, license: "owned" })
        .success,
    ).toBe(false);
  });

  it("refuses every placeholder somebody types when they have not checked", () => {
    for (const value of [
      "owned",
      "unknown",
      "none",
      "N/A",
      "TBD",
      "todo",
      "placeholder",
      "FREE",
      "fair use",
    ]) {
      expect(isPlaceholderLicense(value), value).toBe(true);
      expect(
        backgroundManifestEntrySchema.safeParse({ ...VALID, license: value })
          .success,
        value,
      ).toBe(false);
    }
  });

  /* A one-word answer cannot name an instrument AND a permission, which is
   * what the field is for. "CC0" is the tempting case: it is a real licence
   * and it does not say what it permits. */
  it("refuses a licence too short to say anything", () => {
    for (const value of ["", "CC0", "mine", "ours"]) {
      expect(licenseTermsSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("refuses a key that is not lower-case hyphenated", () => {
    for (const key of ["Calm Waves", "calm_waves", "calm--", "ca", "CALM"]) {
      expect(
        backgroundManifestEntrySchema.safeParse({ ...VALID, key }).success,
        key,
      ).toBe(false);
    }
  });

  it("refuses a kind the library has no shelf for", () => {
    for (const kind of ["upload", "render_output", "audio_tts", "image"]) {
      expect(
        backgroundManifestEntrySchema.safeParse({ ...VALID, kind }).success,
        kind,
      ).toBe(false);
    }
  });

  it("accepts the audio kinds, which follow the same discipline", () => {
    for (const kind of ["audio_music", "sfx"]) {
      expect(
        backgroundManifestEntrySchema.safeParse({
          ...VALID,
          kind,
          contentType: "audio/mpeg",
        }).success,
        kind,
      ).toBe(true);
    }
  });

  it("refuses an unknown field rather than ignoring it", () => {
    expect(
      backgroundManifestEntrySchema.safeParse({ ...VALID, licenseKind: "stock" })
        .success,
    ).toBe(false);
  });

  it("refuses a source that is not a URL", () => {
    expect(
      backgroundManifestEntrySchema.safeParse({
        ...VALID,
        sourceUrl: "loops/calm.mp4",
      }).success,
    ).toBe(false);
  });

  /* DUPLICATE_KEY_IS_A_FORK — two rows sharing a key would upsert the same
   * asset twice with different bytes, and which won would be array order. */
  it("refuses two rows sharing a key", () => {
    const parsed = backgroundManifestSchema.safeParse([
      VALID,
      { ...VALID, title: "A different title" },
    ]);
    expect(parsed.success).toBe(false);
  });

  it("accepts two rows with different keys", () => {
    expect(
      backgroundManifestSchema.safeParse([
        VALID,
        { ...VALID, key: "calm-abstract-rain" },
      ]).success,
    ).toBe(true);
  });
});

describe("licence categories", () => {
  /* LICENSE_TERMS_ARE_NOT_A_CATEGORY. The document's enum and this module's
   * must stay identical: a category the document accepts and this file cannot
   * produce is a gap, and the reverse is a document that fails validation at
   * generate time. */
  it("matches the timeline document's own licence union", () => {
    const docShape = assetRefSchema.safeParse({
      assetId: "ast_1",
      kind: "video",
      license: "licensed",
    });
    expect(docShape.success).toBe(true);

    for (const kind of LICENSE_KINDS) {
      expect(
        assetRefSchema.safeParse({
          assetId: "ast_1",
          kind: "video",
          license: kind,
        }).success,
        kind,
      ).toBe(true);
    }

    /* And nothing outside it. */
    expect(
      assetRefSchema.safeParse({
        assetId: "ast_1",
        kind: "video",
        license: "cc0",
      }).success,
    ).toBe(false);
  });

  it("derives the category from the source and never from the prose", () => {
    expect(licenseCategoryForSource("library")).toBe("licensed");
    expect(licenseCategoryForSource("upload")).toBe("owned");
    expect(licenseCategoryForSource("generated")).toBe("generated");
    expect(licenseCategoryForSource("stock")).toBe("stock");
  });

  /* `source` is a String column, so a value this build does not recognise is
   * reachable. `unknown` is refusable later; `owned` would be a claim nobody
   * checked. */
  it("falls back to unknown rather than owned for an unrecognised source", () => {
    expect(licenseCategoryForSource("whatever")).toBe("unknown");
    expect(licenseCategoryForSource("")).toBe("unknown");
  });
});

describe("library asset ids", () => {
  /* The id becomes a path segment, so it has to survive the traversal guard —
   * otherwise a legal manifest key produces a row whose objects cannot be
   * written at all. */
  it("produces a usable storage key segment", () => {
    expect(() =>
      assertKeySegment(libraryAssetId(VALID.key), "assetId"),
    ).not.toThrow();
    expect(libraryAssetId(VALID.key)).toBe("lib-calm-abstract-waves");
  });

  it("cannot be mistaken for a cuid", () => {
    expect(libraryAssetId("x").startsWith("lib-")).toBe(true);
  });
});

describe("the shipped manifest", () => {
  /**
   * MANIFEST_IS_EMPTY_ON_PURPOSE. This asserts a DECISION, not an
   * implementation: the catalogue stays empty until the gameplay-footage
   * licensing position is settled by the owner, because a plausible-looking
   * licence string nobody has verified is the one kind of fiction this product
   * cannot afford.
   *
   * When that decision is made and rows are added, this test should be
   * DELETED — not edited to expect a count. Its replacement is the parse
   * below, which already holds every row to the discipline above.
   */
  it("is empty until the licensing position is settled", () => {
    expect(BACKGROUND_MANIFEST).toHaveLength(0);
  });

  it("parses — every row, against the full schema", () => {
    expect(backgroundManifestSchema.safeParse(BACKGROUND_MANIFEST).success).toBe(
      true,
    );
  });

  it("reports an unknown key rather than silently matching nothing", () => {
    const result = manifestEntriesFor(["no-such-loop"]);
    expect(result.entries).toHaveLength(0);
    expect(result.unknownKeys).toEqual(["no-such-loop"]);
  });

  it("returns the whole catalogue when no keys are named", () => {
    expect(manifestEntriesFor().entries).toBe(BACKGROUND_MANIFEST);
    expect(manifestEntriesFor([]).entries).toBe(BACKGROUND_MANIFEST);
  });

  it("finds nothing by key in an empty catalogue", () => {
    expect(findManifestEntry(VALID.key)).toBeUndefined();
  });
});
