/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ValidationError, TimelineErrorCode,
 *   TIMELINE_ERROR_CODES, timelineError, FIELD_LEVEL_ERRORS, ValidationResult
 *
 * WHAT:  The error vocabulary the timeline module returns instead of throwing.
 * WHY:   FIELD_LEVEL_ERRORS. Every consumer needs to attach a problem to a
 *        place: the editor highlights a clip, the generator retries one line,
 *        the render refuses with a reason a human can act on. A thrown Error
 *        collapses all of that into a string, so nothing here throws — the
 *        functions return errors carrying the dotted `path` of what is wrong.
 *        The codes are a closed union so a consumer can branch on one without
 *        matching on message text.
 * WHERE: Returned by validate() and apply(); surfaced by the editor (Phase 15)
 *        and the render pre-flight (Phase 04).
 */

/**
 * SOURCE OF TRUTH KEYWORDS: TIMELINE_ERROR_CODES, TimelineErrorCode
 *
 * WHAT:  Every way a timeline document or an edit to one can be wrong.
 * WHY:   Named per RULE, not per field, so the editor can say "this clip is
 *        outside the video" without parsing a sentence.
 * WHERE: ValidationError.code.
 */
export const TIMELINE_ERROR_CODES = [
  /* The document did not parse against timelineDocSchema at all. */
  "SCHEMA",
  /* A duration that is zero or negative, or a negative start. */
  "BAD_DURATION",
  /* An item that starts or ends outside the video's length. */
  "OUT_OF_RANGE",
  /* A caption whose word range is empty, inverted, or points past doc.words. */
  "BAD_WORD_RANGE",
  /* doc.words[n].i disagrees with n, or a token ends before it starts. */
  "BAD_WORD_TOKEN",
  /* An assetId that is not a key of doc.assets. */
  "UNKNOWN_ASSET",
  /* A speaker that is not a key of doc.speakers. */
  "UNKNOWN_SPEAKER",
  /* Two items, or two tracks, sharing an id. */
  "DUPLICATE_ID",
  /* Two overlapping overlays claiming the same z. */
  "Z_COLLISION",
  /* A box or position outside the 0..1 canvas. */
  "OUT_OF_BOUNDS",
  /* A word anchor surviving in a document whose `timing` says 'resolved'. */
  "UNRESOLVED_ANCHOR",
  /* An anchor that points at a word the document does not contain. */
  "ANCHOR_NOT_FOUND",
  /* A cached start/duration on a caption that disagrees with its word range. */
  "STALE_RESOLUTION",
  /* An op naming an item, track or index that does not exist. */
  "NOT_FOUND",
  /* An op whose arguments are self-contradictory (splitting outside the clip). */
  "BAD_OPERATION",
  /* migrate() was handed something it has no path from. */
  "UNMIGRATABLE",
] as const;

export type TimelineErrorCode = (typeof TIMELINE_ERROR_CODES)[number];

/**
 * SOURCE OF TRUTH KEYWORDS: ValidationError
 *
 * WHAT:  One problem, located.
 * WHY:   `path` is the dotted route into the document
 *        (`tracks.2.items.0.duration`) so the editor can map it back to a clip
 *        without a second lookup table. `message` is user-facing copy, not a
 *        developer note — these reach the screen.
 * WHERE: validate(), apply(), and the UI that renders them.
 */
export interface ValidationError {
  path: string;
  code: TimelineErrorCode;
  message: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: ValidationResult, DISCRIMINATED_RESULT
 *
 * WHAT:  validate()'s return: a parsed document, or the reasons it is not one.
 * WHY:   Discriminated on `ok` so a caller that forgets to check cannot reach
 *        `.doc` — the compiler refuses. That is the whole reason this module
 *        returns instead of throwing.
 * WHERE: validate() in validate.ts.
 */
export type ValidationResult<T> =
  { ok: true; doc: T } | { ok: false; errors: ValidationError[] };

/**
 * SOURCE OF TRUTH KEYWORDS: timelineError
 *
 * WHAT:  Builds a ValidationError.
 * WHY:   Three positional arguments in a fixed order, used a hundred times
 *        across validate.ts — a helper keeps the rule readable at the callsite
 *        instead of burying it in object literals.
 * WHERE: validate.ts, ops.ts, migrate.ts, anchors.ts.
 */
export function timelineError(
  path: string,
  code: TimelineErrorCode,
  message: string,
): ValidationError {
  return { path, code, message };
}
