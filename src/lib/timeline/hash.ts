/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: hashDoc, canonicalize, CACHE_IRRELEVANT_FIELDS,
 *   FNV_1A_64, RENDER_REUSE, docHash, stableStringify
 *
 * WHAT:  A stable fingerprint of a timeline document: identical output for two
 *        documents that would render identically, different output for two that
 *        would not.
 * WHY:   RENDER_REUSE. Phase 04 skips a paid Lambda render when a document's
 *        hash matches one already rendered, so this function is directly
 *        load-bearing on both the bill and on correctness. Two properties
 *        matter and they pull in opposite directions:
 *
 *        It must IGNORE what does not change the picture — key order (JSON
 *        objects have none), absent-versus-undefined fields, float noise from
 *        a chain of additions, and the editor-only `label` on tracks and items.
 *        Renaming a track must not cost a customer a second render.
 *
 *        It must NOT ignore anything that does. That is why the exclusion list
 *        is a short, named constant rather than a heuristic: every future
 *        addition to it is a decision to serve a stale video, and should read
 *        like one.
 *
 *        FNV_1A_64 rather than SHA-256 because this module is pure and
 *        isomorphic — `node:crypto` is banned here and WebCrypto's digest is
 *        async, which would make hashDoc impossible to call from a render path.
 *        This is a cache key, not a security boundary; collision resistance
 *        against an adversary is not a requirement, and a 64-bit space is far
 *        past what a workspace's render history can populate.
 * WHERE: Phase 04's render reuse, and the editor's dirty check.
 */

import { roundSeconds } from "./time";
import type { TimelineDoc } from "./schema";

/**
 * SOURCE OF TRUTH KEYWORDS: CACHE_IRRELEVANT_FIELDS
 *
 * WHAT:  Property names dropped before hashing, at any depth.
 * WHY:   `label` is the editor's name for a track or clip. It is shown in the
 *        timeline panel and nowhere in the output frame. Read the file's WHY
 *        before adding to this list.
 * WHERE: canonicalize() below.
 */
export const CACHE_IRRELEVANT_FIELDS: readonly string[] = ["label"];

/* FNV-1a, 64-bit. The constants are the algorithm's, not arbitrary. */
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * SOURCE OF TRUTH KEYWORDS: hashDoc, docHash
 *
 * WHAT:  Sixteen lowercase hex characters identifying this document's output.
 * WHY:   Hex rather than base64url so the value is safe in a filename, a URL
 *        and a Postgres column without ever being escaped.
 * WHERE: Stored as the render's `docHash` in Phase 04.
 */
export function hashDoc(doc: TimelineDoc): string {
  return hashValue(doc);
}

/**
 * SOURCE OF TRUTH KEYWORDS: hashValue, SAME_HASH_FOR_ANY_SHAPE
 *
 * WHAT:  The same stable digest, over any JSON-shaped value rather than a
 *        document.
 *
 * WHY:   Phase 09 needs to hash something that is NOT a timeline document. Its
 *        idempotency key is `projectId + docHash`, but on a first run there is
 *        no document — building one is the point of the run — so what gets
 *        hashed is the INPUT shape the run would consume: the project's kind,
 *        aspect and settings, plus its script and narration state
 *        (IDEMPOTENCY_IS_PROJECT_PLUS_SHAPE in src/services/pipeline.service.ts).
 *
 *        SAME_HASH_FOR_ANY_SHAPE: this is the function `hashDoc` has always
 *        been, with its argument widened, rather than a second hasher. A
 *        `JSON.stringify` at the callsite was the alternative and it is the
 *        exact bug this module exists to prevent — key order would change the
 *        hash, so adding a settings field would invalidate every key and a
 *        double-click would start two runs.
 * WHERE: hashDoc above, and src/services/pipeline.service.ts.
 */
export function hashValue(value: unknown): string {
  return fnv1a64(stableStringify(canonicalize(value)));
}

/**
 * SOURCE OF TRUTH KEYWORDS: canonicalize, CanonicalValue
 *
 * WHAT:  Rewrites the document into the form that gets hashed: cache-irrelevant
 *        keys dropped, undefined dropped, numbers rounded.
 * WHY:   Separated from the stringify step so a test can assert on the shape
 *        rather than on a hash, which is what makes a change to this policy
 *        reviewable.
 *        Rounding uses the same roundSeconds as the ops, so a duration the
 *        editor wrote and a duration a split computed hash alike.
 * WHERE: hashDoc(); its own test.
 */
type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export function canonicalize(value: unknown): CanonicalValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? roundSeconds(value) : 0;
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));

  if (typeof value === "object") {
    const source: Record<string, unknown> = { ...value };
    const out: { [key: string]: CanonicalValue } = {};
    for (const key of Object.keys(source)) {
      if (CACHE_IRRELEVANT_FIELDS.includes(key)) continue;
      const entry = source[key];
      /* An absent field and a field set to undefined describe the same
       * document — JSON cannot tell them apart once stored, so neither can
       * the hash. */
      if (entry === undefined) continue;
      out[key] = canonicalize(entry);
    }
    return out;
  }

  /* Functions, symbols and bigints cannot appear in a parsed document; mapping
   * them to null keeps this total rather than throwing from a cache key. */
  return null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: stableStringify, KEY_ORDER_INSENSITIVE
 *
 * WHAT:  JSON with every object's keys emitted in sorted order.
 * WHY:   KEY_ORDER_INSENSITIVE. `JSON.stringify` preserves insertion order, so
 *        the same document round-tripped through a different code path would
 *        otherwise produce a different hash and a needless re-render. Array
 *        order is NOT sorted — it is meaningful everywhere in a timeline.
 * WHERE: hashDoc().
 */
export function stableStringify(value: CanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const entry = value[key];
    if (entry === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${stableStringify(entry)}`);
  }
  return `{${parts.join(",")}}`;
}

/* Hashes the UTF-16 code units rather than UTF-8 bytes. The input is produced
 * by this module, so the encoding only has to be consistent with itself — and
 * avoiding TextEncoder keeps the file free of platform globals. */
function fnv1a64(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}
