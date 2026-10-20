/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: migrate tests, MIGRATION_PROOF, CHAIN_COMPLETENESS,
 *   legacyV1Fixture, DERIVED_ASSET_MAP, UNMIGRATABLE, TimelineMigrationError
 *
 * WHAT:  Proves a v1 document reaches v4 and then validates, that the chain has
 *        no gaps, and that an un-migratable document reports why.
 * WHY:   CHAIN_COMPLETENESS is the test that will actually catch a future bug.
 *        Bumping TIMELINE_DOC_VERSION without adding a MIGRATIONS entry makes
 *        every stored document unreadable, and nothing else in the suite would
 *        notice — the fixtures are all written at the current version. This
 *        asserts the chain spans 1 to the current version with a step for every
 *        number in between.
 *        The round-trip test asserts on the SHAPE the steps produced, not just
 *        that validate passed: a step that dropped the speakers map would still
 *        validate, because an empty cast is legal.
 * WHERE: Run by `npm test`. Guards src/lib/timeline/migrate.ts.
 */

import { describe, expect, it } from "vitest";

import { legacyV1Fixture } from "./fixtures";
import {
  MIGRATIONS,
  TimelineMigrationError,
  migrate,
  tryMigrate,
} from "./migrate";
import { TIMELINE_DOC_VERSION } from "./schema";
import { validate } from "./validate";

describe("the migration chain is complete", () => {
  it("has a step for every version below the current one", () => {
    const expected = Array.from(
      { length: TIMELINE_DOC_VERSION - 1 },
      (_unused, index) => index + 1,
    );
    expect(
      Object.keys(MIGRATIONS)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(expected);
  });

  it("has no step that reads the current version", () => {
    /* A step keyed at the current version would run forever on a fresh
     * document — the loop advances by one and would never reach the end. */
    expect(MIGRATIONS[TIMELINE_DOC_VERSION]).toBeUndefined();
  });
});

describe("a v1 document migrates to v4 and validates", () => {
  it("reaches the current version", () => {
    const migrated = migrate(legacyV1Fixture());
    expect(migrated.version).toBe(TIMELINE_DOC_VERSION);
  });

  it("validates once migrated", () => {
    const result = tryMigrate(legacyV1Fixture());
    expect(
      result.ok,
      result.ok ? "" : JSON.stringify(result.errors, null, 2),
    ).toBe(true);
  });

  it("folds the flat frame fields into canvas", () => {
    const migrated = migrate(legacyV1Fixture());
    expect(migrated.canvas).toEqual({ width: 1080, height: 1920, fps: 30 });
  });

  it("rewrites word tokens to the short keys and adds indices", () => {
    const migrated = migrate(legacyV1Fixture());
    expect(migrated.words[0]).toEqual({
      i: 0,
      w: "AITA",
      s: 0,
      e: 0.32,
      speaker: "A",
    });
    expect(migrated.words.map((token) => token.i)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("gives the document a style block", () => {
    const migrated = migrate(legacyV1Fixture());
    expect(migrated.style).toEqual({
      paletteId: "default",
      captionStyleId: "default",
      safeZone: "none",
    });
  });

  it("builds the asset map from the ids already on the items", () => {
    /* DERIVED_ASSET_MAP — v1 had no asset list, so the handles are collected
     * from the items and keyed by themselves. */
    const migrated = migrate(legacyV1Fixture());
    expect(Object.keys(migrated.assets).sort()).toEqual([
      "bg_loop_01",
      "narration_old",
    ]);
    expect(migrated.assets["bg_loop_01"]).toEqual({
      assetId: "bg_loop_01",
      kind: "video",
      license: "unknown",
    });
  });

  it("records an unknown licence rather than assuming one is cleared", () => {
    const migrated = migrate(legacyV1Fixture());
    for (const asset of Object.values(migrated.assets)) {
      expect(asset.license).toBe("unknown");
    }
  });

  it("corrects the kind of an asset found on an audio track", () => {
    const migrated = migrate(legacyV1Fixture());
    expect(migrated.assets["narration_old"]?.kind).toBe("audio");
  });

  it("recovers the cast from the ids the items and words reference", () => {
    const migrated = migrate(legacyV1Fixture());
    expect(Object.keys(migrated.speakers)).toEqual(["A"]);
  });

  it("renames a scene item’s `kind` to `render`", () => {
    const migrated = migrate(legacyV1Fixture());
    const track = migrated.tracks.find(
      (candidate) => candidate.type === "scene",
    );
    expect(track?.type).toBe("scene");
    if (track === undefined || track.type !== "scene") return;
    expect(track.items[0]?.render).toBe("redditCard");
    expect("kind" in (track.items[0] ?? {})).toBe(false);
  });

  it("gives video items the media render kind", () => {
    const migrated = migrate(legacyV1Fixture());
    const track = migrated.tracks.find((candidate) => candidate.id === "bg");
    if (track === undefined || track.type !== "video")
      throw new Error("no bg track");
    expect(track.items[0]?.render).toBe("media");
  });

  it("marks the document anchored, since v3 stored them before resolution", () => {
    expect(migrate(legacyV1Fixture()).timing).toBe("anchored");
  });

  it("does not mutate the document it was given", () => {
    const original = legacyV1Fixture();
    const snapshot = JSON.stringify(original);
    migrate(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("a document already at the current version passes through", () => {
  it("migrates to itself", () => {
    const migrated = migrate(legacyV1Fixture());
    const again = migrate(migrated);
    expect(again).toEqual(migrated);
  });
});

describe("what cannot be migrated", () => {
  it.each([
    ["null", null],
    ["a string", "nope"],
    ["an array", []],
  ])("reports UNMIGRATABLE for %s", (_label, input) => {
    const result = tryMigrate(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("UNMIGRATABLE");
  });

  it("reports UNMIGRATABLE when the version is missing", () => {
    const result = tryMigrate({ kind: "quiz", tracks: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("UNMIGRATABLE");
    expect(result.errors[0]?.path).toBe("version");
  });

  it("refuses a document from a newer release rather than guessing", () => {
    const result = tryMigrate({
      ...legacyV1Fixture(),
      version: TIMELINE_DOC_VERSION + 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("UNMIGRATABLE");
    expect(result.errors[0]?.message).toContain("newer version");
  });

  it("returns validation errors when a migrated document is still broken", () => {
    const broken = legacyV1Fixture();
    const tracks = broken["tracks"];
    if (!Array.isArray(tracks)) throw new Error("fixture shape changed");
    const first = tracks[0];
    if (typeof first !== "object" || first === null || Array.isArray(first)) {
      throw new Error("fixture shape changed");
    }
    /* A legal v1 field with an illegal value: the chain carries it through and
     * validate() is what refuses it, with a field-level error. */
    const items = first["items"];
    if (!Array.isArray(items)) throw new Error("fixture shape changed");
    const item = items[0];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("fixture shape changed");
    }
    item["duration"] = -5;

    const result = tryMigrate(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.code === "BAD_DURATION")).toBe(
      true,
    );
  });
});

describe("migrate throws where tryMigrate reports", () => {
  it("throws a TimelineMigrationError carrying the errors", () => {
    let thrown: unknown = null;
    try {
      migrate("not a document");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TimelineMigrationError);
    if (!(thrown instanceof TimelineMigrationError)) return;
    expect(thrown.errors[0]?.code).toBe("UNMIGRATABLE");
    expect(thrown.message.length).toBeGreaterThan(0);
  });

  it("does not throw for a document that migrates", () => {
    expect(() => migrate(legacyV1Fixture())).not.toThrow();
  });
});

describe("the migrated document is a real timeline", () => {
  it("passes validate() directly, not only through tryMigrate", () => {
    const migrated = migrate(legacyV1Fixture());
    expect(validate(migrated).ok).toBe(true);
  });
});
