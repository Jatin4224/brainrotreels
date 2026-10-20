/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: migrate, tryMigrate, MIGRATIONS, MigrationStep,
 *   TimelineMigrationError, MIGRATE_ON_EVERY_READ, STEPWISE_MIGRATION,
 *   v1ToV2, v2ToV3, v3ToV4
 *
 * WHAT:  Upgrades a stored timeline document to the current version, one step
 *        at a time, then validates the result.
 * WHY:   MIGRATE_ON_EVERY_READ, without exception. A project rendered in
 *        January must still render in December, and the alternative — a
 *        one-off backfill — fails the moment a customer's document is restored
 *        from a backup, or arrives from an export, or was written by a release
 *        that got rolled back.
 *
 *        STEPWISE_MIGRATION: each step upgrades by exactly one version and
 *        knows nothing about the others. Writing a v1-straight-to-v4 shortcut
 *        looks like a saving and costs a combinatorial number of paths the
 *        first time v5 lands. The chain is asserted to reach exactly
 *        TIMELINE_DOC_VERSION, so bumping the version without adding a step
 *        fails a test rather than a customer's render.
 *
 *        The steps work on loose JSON rather than typed documents on purpose:
 *        a v1 document is not a TimelineDoc and never will be, so giving each
 *        legacy shape its own full zod schema would mean maintaining four
 *        obsolete schemas forever. The guarantee instead comes from the END of
 *        the chain, where validate() parses the result — so a step that
 *        produces nonsense fails loudly with field-level errors.
 * WHERE: Every read of Timeline.doc, in the service layer and in the editor.
 */

import {
  timelineError,
  type ValidationError,
  type ValidationResult,
} from "./errors";
import { TIMELINE_DOC_VERSION, type TimelineDoc } from "./schema";
import { validate } from "./validate";
import type { JsonObject, JsonValue } from "@/lib/types/json";

/**
 * SOURCE OF TRUTH KEYWORDS: MigrationStep, MIGRATIONS
 *
 * WHAT:  The upgrade chain, keyed by the version each step reads.
 * WHY:   Keyed by SOURCE version rather than held as an array so a document
 *        joins the chain wherever it happens to be, and a gap in the chain is
 *        a missing key rather than an off-by-one in an index.
 * WHERE: runChain() below; the migration test asserts the chain is complete.
 */
export type MigrationStep = (doc: JsonObject) => JsonObject;

export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {
  1: v1ToV2,
  2: v2ToV3,
  3: v3ToV4,
};

/**
 * SOURCE OF TRUTH KEYWORDS: TimelineMigrationError
 *
 * WHAT:  Thrown by migrate() when a document cannot be brought to the current
 *        version, carrying the field-level reasons.
 * WHY:   migrate() has no error channel in its signature — it returns a
 *        document — because every caller needs one on the happy path and
 *        wrapping each read in a result check would bury the common case. The
 *        thrown form still carries `errors`, so a caller that wants them has
 *        them; a caller that wants them WITHOUT a throw uses tryMigrate().
 * WHERE: Caught by the projects service and turned into a tRPC error.
 */
export class TimelineMigrationError extends Error {
  readonly errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    super(errors[0]?.message ?? "This timeline could not be opened.");
    this.name = "TimelineMigrationError";
    this.errors = errors;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: migrate, MIGRATE_ON_EVERY_READ
 *
 * WHAT:  A stored document at the current version, validated.
 * WHY:   Throws rather than returning a sentinel because a document that
 *        cannot be migrated is not a state any screen can render — there is no
 *        partial timeline to show. See TimelineMigrationError.
 * WHERE: Every read of Timeline.doc.
 */
export function migrate(doc: unknown): TimelineDoc {
  const result = tryMigrate(doc);
  if (!result.ok) throw new TimelineMigrationError(result.errors);
  return result.doc;
}

/**
 * SOURCE OF TRUTH KEYWORDS: tryMigrate
 *
 * WHAT:  The non-throwing form: the migrated document, or why it could not be.
 * WHY:   Needed wherever a bad document is an expected outcome rather than an
 *        exception — a bulk re-render skipping one broken project, or an
 *        import telling the customer which file failed.
 * WHERE: migrate(); Phase 04's pre-flight.
 */
export function tryMigrate(doc: unknown): ValidationResult<TimelineDoc> {
  const object = asObject(doc);
  if (object === null) {
    return {
      ok: false,
      errors: [
        timelineError(
          "document",
          "UNMIGRATABLE",
          "This timeline is not a document at all.",
        ),
      ],
    };
  }

  const version = asNumber(object["version"]);
  if (version === null || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      errors: [
        timelineError(
          "version",
          "UNMIGRATABLE",
          "This timeline does not say which version it is.",
        ),
      ],
    };
  }
  if (version > TIMELINE_DOC_VERSION) {
    return {
      ok: false,
      errors: [
        timelineError(
          "version",
          "UNMIGRATABLE",
          `This timeline was made by a newer version of the app (v${version}).`,
        ),
      ],
    };
  }

  const chained = runChain(object, version);
  if (!chained.ok) return chained;

  return validate(chained.doc);
}

/* Walks the chain from the document's own version up to the current one. Each
 * iteration must advance, which is what makes a missing step a clear error
 * rather than a hang. */
function runChain(doc: JsonObject, from: number): ValidationResult<JsonObject> {
  let current = doc;
  for (let version = from; version < TIMELINE_DOC_VERSION; version += 1) {
    const step = MIGRATIONS[version];
    if (step === undefined) {
      return {
        ok: false,
        errors: [
          timelineError(
            "version",
            "UNMIGRATABLE",
            `No way to upgrade a v${version} timeline. This is a bug in the migration chain.`,
          ),
        ],
      };
    }
    current = step(current);
  }
  return { ok: true, doc: current };
}

/**
 * SOURCE OF TRUTH KEYWORDS: v1ToV2
 *
 * WHAT:  Folds v1's flat `width` / `height` / `fps` into a `canvas` object.
 * WHY:   v1 described the frame with three root fields, which meant every
 *        consumer that wanted the aspect ratio read three places and the
 *        editor had nowhere to put a second canvas. They move together or not
 *        at all, so they became an object.
 * WHERE: MIGRATIONS[1].
 */
function v1ToV2(doc: JsonObject): JsonObject {
  const next: JsonObject = { ...doc, version: 2 };
  const width = asNumber(doc["width"]) ?? 1080;
  const height = asNumber(doc["height"]) ?? 1920;
  const fps = asNumber(doc["fps"]) ?? 30;

  next["canvas"] = { width, height, fps };
  delete next["width"];
  delete next["height"];
  delete next["fps"];
  return next;
}

/**
 * SOURCE OF TRUTH KEYWORDS: v2ToV3
 *
 * WHAT:  Rewrites word tokens from `{ text, start, end }` to `{ i, w, s, e }`
 *        and gives the document a `style` block.
 * WHY:   The short keys are not golf: a sixty-second script is around 180
 *        tokens, and the long form roughly doubled the stored size of the one
 *        field that is read on every frame. `i` is added here because v2 had no
 *        word indices at all — anchors addressed words by text, which is why
 *        `{ word }` anchors still exist and are still only safe for a unique
 *        word.
 *        The style defaults match what v2 hard-coded in the renderer, so a v2
 *        document keeps rendering the way its customer last saw it.
 * WHERE: MIGRATIONS[2].
 */
function v2ToV3(doc: JsonObject): JsonObject {
  const next: JsonObject = { ...doc, version: 3 };

  const words = asArray(doc["words"]) ?? [];
  next["words"] = words.map((entry, index) => {
    const token = asObject(entry);
    if (token === null) return { i: index, w: "", s: 0, e: 0 };
    const rewritten: JsonObject = {
      i: index,
      w: asString(token["text"]) ?? asString(token["w"]) ?? "",
      s: asNumber(token["start"]) ?? asNumber(token["s"]) ?? 0,
      e: asNumber(token["end"]) ?? asNumber(token["e"]) ?? 0,
    };
    const speaker = asString(token["speaker"]);
    if (speaker !== null) rewritten["speaker"] = speaker;
    return rewritten;
  });

  if (asObject(doc["style"]) === null) {
    next["style"] = {
      paletteId: "default",
      captionStyleId: "default",
      safeZone: "none",
    };
  }
  return next;
}

/**
 * SOURCE OF TRUTH KEYWORDS: v3ToV4, ASSET_HANDLE_INDIRECTION, DERIVED_ASSET_MAP
 *
 * WHAT:  Adds the `assets` and `speakers` maps, the `render` discriminator on
 *        items, and `timing`.
 * WHY:   DERIVED_ASSET_MAP. v3 items held a bare asset id and the document had
 *        no list of what it used — so nothing could answer "may this be
 *        published?" without loading every row. v4 collects them into
 *        `doc.assets`, and this step builds that map from the ids already on
 *        the items, keyed by the id itself so the items need no rewriting. The
 *        licence is recorded as `unknown`, which is honest: v3 never captured
 *        one, and the publish check in Phase 10 must treat it as unclear rather
 *        than assume it is cleared.
 *        Speakers are recovered the same way, from the ids the items and words
 *        already reference, so a v3 two-voice story keeps both voices.
 *        `timing` is 'anchored' because v3 documents were stored before
 *        resolution — resolveWordAnchors() will say otherwise if they were not.
 * WHERE: MIGRATIONS[3].
 */
function v3ToV4(doc: JsonObject): JsonObject {
  const next: JsonObject = { ...doc, version: 4 };
  const assets: JsonObject = { ...(asObject(doc["assets"]) ?? {}) };
  const speakers: JsonObject = { ...(asObject(doc["speakers"]) ?? {}) };

  const noteAsset = (id: string | null): void => {
    if (id === null || Object.hasOwn(assets, id)) return;
    assets[id] = { assetId: id, kind: "video", license: "unknown" };
  };
  const noteSpeaker = (id: string | null): void => {
    if (id === null || Object.hasOwn(speakers, id)) return;
    speakers[id] = {};
  };

  for (const entry of asArray(doc["words"]) ?? []) {
    noteSpeaker(asString(asObject(entry)?.["speaker"]));
  }

  next["tracks"] = (asArray(doc["tracks"]) ?? []).map((trackEntry) => {
    const track = asObject(trackEntry);
    if (track === null) return trackEntry;

    const type = asString(track["type"]);
    const items = (asArray(track["items"]) ?? []).map((itemEntry) => {
      const item = asObject(itemEntry);
      if (item === null) return itemEntry;

      const upgraded: JsonObject = { ...item };
      noteAsset(asString(item["assetId"]));
      noteSpeaker(asString(item["speaker"]));

      /* `kind` was v3's name for what a scene drew; v4 calls it `render` and
       * shares the vocabulary with video and overlay items. */
      if (type === "scene" && asString(item["render"]) === null) {
        upgraded["render"] = asString(item["kind"]) ?? "motion";
        delete upgraded["kind"];
      }
      if (
        (type === "video" || type === "overlay") &&
        asString(item["render"]) === null
      ) {
        upgraded["render"] = "media";
      }
      return upgraded;
    });

    return { ...track, items };
  });

  /* An audio asset recorded as video above would fail nothing in validate,
   * but it would mislead every later reader — so the kinds are corrected from
   * the track each id was found on. */
  for (const trackEntry of asArray(next["tracks"]) ?? []) {
    const track = asObject(trackEntry);
    if (track === null || asString(track["type"]) !== "audio") continue;
    for (const itemEntry of asArray(track["items"]) ?? []) {
      const id = asString(asObject(itemEntry)?.["assetId"]);
      if (id === null) continue;
      const existing = asObject(assets[id]);
      if (existing !== null) assets[id] = { ...existing, kind: "audio" };
    }
  }

  next["assets"] = assets;
  next["speakers"] = speakers;
  if (asString(doc["timing"]) === null) next["timing"] = "anchored";
  return next;
}

/* Narrow readers for untrusted JSON. Each returns null rather than throwing, so
 * a malformed legacy field degrades to its default instead of taking down the
 * whole migration — the final validate() is what decides whether the result is
 * usable. */
function asObject(value: JsonValue | unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const record: Record<string, unknown> = { ...value };
  const out: JsonObject = {};
  for (const key of Object.keys(record)) {
    const entry = record[key];
    if (isJsonValue(entry)) out[key] = entry;
  }
  return out;
}

function asArray(value: JsonValue | undefined): JsonValue[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return true;
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry));
  if (type !== "object") return false;
  return Object.values({ ...value }).every((entry) => isJsonValue(entry));
}
