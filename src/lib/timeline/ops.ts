/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: apply, Op, opSchema, trim, split, move, deleteItem,
 *   reorder, setCaptionText, setItemProps, addItem, addOverlay, RIPPLE,
 *   PURE_OPS, ATOMIC_PER_OP, ITEM_SCHEMA_BY_TRACK, itemPatchSchema,
 *   CAPTIONS_FOLLOW_WORDS, findItem
 *
 * WHAT:  Every edit that can be made to a timeline, as data, plus apply() which
 *        runs a list of them and returns a new document.
 * WHY:   PURE_OPS. This is the module the editor imports in Phase 15 and the
 *        same one the server runs — one implementation, because two would drift
 *        inside a month and the symptom would be an editor preview that does
 *        not match the paid render.
 *
 *        Ops are DATA, not method calls: a zod-validated union. That is what
 *        lets the editor send them over tRPC, keep an undo stack of them, and
 *        replay them against a newer revision when two people edited at once.
 *
 *        ATOMIC_PER_OP: each op either applies completely or not at all. An op
 *        that fails records an error and leaves the document as it was BEFORE
 *        that op, and the remaining ops still run. A half-applied trim —
 *        duration changed, ripple not — is the one outcome nobody could
 *        recover from.
 *
 *        CAPTIONS_FOLLOW_WORDS: trim, split and move refuse caption items, on
 *        purpose. A caption's timing is derived from the words it covers (see
 *        WORD_RANGE_NOT_TEXT in schema.ts), so "make this caption longer" is
 *        not a thing you can do to the caption — you change its word range, or
 *        you change the words. setCaptionText does the latter and shifts every
 *        caption after it, which is the only reason this file knows about
 *        doc.words at all.
 * WHERE: Imported by the timeline editor (Phase 15) and by any generator that
 *        post-processes its own output. Re-exported from src/lib/timeline.
 */

import { z } from "zod";

import { jsonValueSchema } from "@/lib/types/json";
import { timelineError, type ValidationError } from "./errors";
import {
  audioItemSchema,
  captionItemSchema,
  normalizedBoxSchema,
  overlayItemSchema,
  renderKindSchema,
  sceneItemSchema,
  sceneSpecSchema,
  videoItemSchema,
  type TimelineDoc,
  type Track,
  type TrackItem,
  type WordToken,
} from "./schema";
import { TIME_EPSILON, cloneDoc, isSeconds, roundSeconds } from "./time";
import { validate } from "./validate";

/**
 * SOURCE OF TRUTH KEYWORDS: itemPatchSchema, ItemPatch, setItemProps
 *
 * WHAT:  The fields setItemProps is allowed to change.
 * WHY:   An allow-list, not a free-form patch. `id`, `start` and `duration` are
 *        deliberately absent: moving an item in time goes through move/trim so
 *        ripple is considered, and changing an id would orphan every op in the
 *        undo stack that named it. Each key here is a presentation knob, which
 *        is why one op can serve all five item variants — the patched item is
 *        re-parsed against its own schema afterwards, so a `gain` on a caption
 *        is rejected rather than stored.
 * WHERE: The `setItemProps` op; the editor's properties panel.
 */
export const itemPatchSchema = z
  .object({
    label: z.string().trim().max(200).optional(),
    fit: z.enum(["cover", "contain", "fill"]).optional(),
    loop: z.boolean().optional(),
    muted: z.boolean().optional(),
    gain: z.number().min(0).max(4).optional(),
    duck: z.boolean().optional(),
    speaker: z.string().trim().min(1).max(120).optional(),
    assetId: z.string().trim().min(1).max(120).optional(),
    render: renderKindSchema.optional(),
    scene: sceneSpecSchema.optional(),
    box: normalizedBoxSchema.optional(),
    position: z
      .object({ x: z.number().finite().optional(), y: z.number().finite() })
      .strict()
      .optional(),
    z: z.number().int().optional(),
    text: z.string().optional(),
    props: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

export type ItemPatch = z.infer<typeof itemPatchSchema>;

/* Shared by the ops that can close or open a gap behind them. */
const rippleShape = { ripple: z.boolean().default(false) };

/**
 * SOURCE OF TRUTH KEYWORDS: opSchema, Op
 *
 * WHAT:  The nine edits, discriminated by `type`.
 * WHY:   Validated with zod rather than typed only in TypeScript because these
 *        arrive from a browser in Phase 15. The editor is not a trusted caller.
 * WHERE: apply(); the Phase 15 mutation input.
 */
export const opSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("trim"),
      itemId: z.string().min(1),
      /* Both optional: trimming the head, the tail, or both. */
      start: z.number().finite().optional(),
      duration: z.number().finite().optional(),
      ...rippleShape,
    })
    .strict(),
  z
    .object({
      type: z.literal("split"),
      itemId: z.string().min(1),
      /* Absolute seconds, not an offset into the clip — the editor knows where
       * the playhead is, not where the clip thinks it starts. */
      at: z.number().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal("move"),
      itemId: z.string().min(1),
      start: z.number().finite(),
      ...rippleShape,
    })
    .strict(),
  z
    .object({
      type: z.literal("delete"),
      itemId: z.string().min(1),
      ...rippleShape,
    })
    .strict(),
  z
    .object({
      type: z.literal("reorder"),
      trackId: z.string().min(1),
      itemIds: z.array(z.string().min(1)),
    })
    .strict(),
  z
    .object({
      type: z.literal("setCaptionText"),
      itemId: z.string().min(1),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("setItemProps"),
      itemId: z.string().min(1),
      props: itemPatchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("addItem"),
      trackId: z.string().min(1),
      /* Parsed against the target track's own item schema inside the op, which
       * is the only place that knows which variant is legal here. */
      item: z.record(z.string(), jsonValueSchema),
      ...rippleShape,
    })
    .strict(),
  z
    .object({
      type: z.literal("addOverlay"),
      trackId: z.string().min(1),
      item: z.record(z.string(), jsonValueSchema),
    })
    .strict(),
]);

export type Op = z.infer<typeof opSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: ITEM_SCHEMA_BY_TRACK
 *
 * WHAT:  Which item schema belongs on which track.
 * WHY:   Lets addItem and setItemProps re-parse an item without a switch each
 *        — and makes "an audio clip on a caption track" impossible to store
 *        rather than merely unlikely.
 * WHERE: addItem, addOverlay, setItemProps below.
 */
const ITEM_SCHEMA_BY_TRACK = {
  video: videoItemSchema,
  scene: sceneItemSchema,
  audio: audioItemSchema,
  caption: captionItemSchema,
  overlay: overlayItemSchema,
} as const;

/**
 * SOURCE OF TRUTH KEYWORDS: apply, PURE_OPS, ATOMIC_PER_OP
 *
 * WHAT:  Runs ops in order and returns the resulting document plus every
 *        problem found — both the ops that could not be applied and any
 *        invariant the result breaks.
 * WHY:   Returns the document even when there are errors, because the editor
 *        needs something to render: four of five ops succeeding and the fifth
 *        reporting "that clip is outside the video" is a usable screen, and
 *        throwing it all away would lose the four.
 *        The input is never mutated — each op works on a fresh clone and a
 *        failed op's clone is discarded, which is what ATOMIC_PER_OP means
 *        here.
 * WHERE: The editor's every keystroke; the Phase 15 save mutation.
 */
export function apply(
  doc: TimelineDoc,
  ops: readonly Op[],
): {
  doc: TimelineDoc;
  errors: ValidationError[];
} {
  let current = doc;
  const errors: ValidationError[] = [];

  ops.forEach((op, index) => {
    const attempt = cloneDoc(current);
    const opErrors = runOp(attempt, op, `ops.${index}`);
    if (opErrors.length > 0) {
      errors.push(...opErrors);
      return;
    }
    current = attempt;
  });

  /* The result is re-validated as a whole: a legal op can still produce an
   * illegal document (two overlays colliding at a depth after a move), and the
   * editor must hear about that from the same call. */
  const validated = validate(current);
  if (!validated.ok)
    return { doc: current, errors: [...errors, ...validated.errors] };
  return { doc: validated.doc, errors };
}

/* Dispatch. Every handler mutates `doc` — which is always a private clone — and
 * returns the errors that stop the op from counting. */
function runOp(doc: TimelineDoc, op: Op, path: string): ValidationError[] {
  switch (op.type) {
    case "trim":
      return opTrim(doc, op, path);
    case "split":
      return opSplit(doc, op, path);
    case "move":
      return opMove(doc, op, path);
    case "delete":
      return opDelete(doc, op, path);
    case "reorder":
      return opReorder(doc, op, path);
    case "setCaptionText":
      return opSetCaptionText(doc, op, path);
    case "setItemProps":
      return opSetItemProps(doc, op, path);
    case "addItem":
      return opAddItem(doc, op, path, null);
    case "addOverlay":
      return opAddItem(
        doc,
        { ...op, type: "addItem", ripple: false },
        path,
        "overlay",
      );
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: findItem, ItemLocation, GLOBAL_ITEM_IDS
 *
 * WHAT:  Locates an item by id anywhere in the document.
 * WHY:   Ops name an item and nothing else, which is what makes them
 *         replayable against a document whose tracks have since been
 *         reordered. Item ids are unique document-wide and validate() enforces
 *         it — see GLOBAL_ITEM_IDS there.
 * WHERE: Every op that addresses an existing item.
 */
interface ItemLocation {
  track: Track;
  itemIndex: number;
  item: TrackItem;
}

function findItem(doc: TimelineDoc, itemId: string): ItemLocation | null {
  for (const track of doc.tracks) {
    const items = listItems(track);
    const itemIndex = items.findIndex((candidate) => candidate.id === itemId);
    if (itemIndex === -1) continue;
    const item = items[itemIndex];
    if (item === undefined) continue;
    return { track, itemIndex, item };
  }
  return null;
}

function findTrack(doc: TimelineDoc, trackId: string): Track | null {
  return doc.tracks.find((track) => track.id === trackId) ?? null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: TimedItem, requireTimed, CAPTIONS_FOLLOW_WORDS
 *
 * WHAT:  Narrows an item to one whose start and duration are absolute seconds,
 *        rejecting captions and un-resolved anchors.
 * WHY:   Two refusals, for two different reasons, in the one place every
 *        time-editing op passes through.
 *        Captions: CAPTIONS_FOLLOW_WORDS — see this file's header.
 *        Anchors: the editor writes absolute times by definition
 *        (architecture.md's invariant), so an op arriving against an anchored
 *        document means the pipeline skipped resolveWordAnchors. Shifting an
 *        anchor by 0.4s is not a meaningful request.
 * WHERE: trim, split, move.
 */
interface TimedItem {
  id: string;
  start: number;
  duration: number;
}

function requireTimed(
  location: ItemLocation,
  path: string,
  verb: string,
):
  | { ok: true; item: TrackItem & TimedItem }
  | { ok: false; errors: ValidationError[] } {
  const { item, track } = location;

  if (track.type === "caption") {
    return {
      ok: false,
      errors: [
        timelineError(
          path,
          "BAD_OPERATION",
          `A caption cannot be ${verb} directly — it follows the words it covers.`,
        ),
      ],
    };
  }
  if (item.start === undefined || item.duration === undefined) {
    return {
      ok: false,
      errors: [
        timelineError(path, "BAD_OPERATION", "This item has no time to edit."),
      ],
    };
  }
  if (!isSeconds(item.start) || !isSeconds(item.duration)) {
    return {
      ok: false,
      errors: [
        timelineError(
          path,
          "BAD_OPERATION",
          "This timeline still points at words rather than times. Resolve it before editing.",
        ),
      ],
    };
  }

  return {
    ok: true,
    item: Object.assign(item, { start: item.start, duration: item.duration }),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: trim, opTrim
 *
 * WHAT:  Changes an item's start and/or length in place, optionally rippling.
 * WHY:   `start` moves the item's head WITHOUT moving its tail — trimming, not
 *        sliding — so the duration is reduced by the same amount the start
 *        grew. That is what an editor's edge drag means, and conflating it with
 *        move is the single most common way a hand-rolled timeline gets edits
 *        wrong.
 * WHERE: apply(); the editor's clip edges.
 */
function opTrim(
  doc: TimelineDoc,
  op: Extract<Op, { type: "trim" }>,
  path: string,
): ValidationError[] {
  const location = findItem(doc, op.itemId);
  if (location === null) return [notFound(path, op.itemId)];

  const timed = requireTimed(location, path, "trimmed");
  if (!timed.ok) return timed.errors;

  const item = timed.item;
  const originalEnd = item.start + item.duration;
  let start = item.start;
  let duration = item.duration;

  if (op.start !== undefined) {
    const headDelta = op.start - item.start;
    start = op.start;
    duration = roundSeconds(duration - headDelta);
  }
  if (op.duration !== undefined) {
    duration = op.duration;
  }

  if (start < -TIME_EPSILON) {
    return [
      timelineError(
        `${path}.start`,
        "BAD_DURATION",
        "A clip cannot start before zero.",
      ),
    ];
  }
  if (duration <= TIME_EPSILON) {
    return [
      timelineError(
        `${path}.duration`,
        "BAD_DURATION",
        "A trim cannot leave a clip with no length.",
      ),
    ];
  }

  item.start = roundSeconds(start);
  item.duration = roundSeconds(duration);

  if (op.ripple) {
    rippleFrom(
      location.track,
      originalEnd,
      roundSeconds(item.start + item.duration - originalEnd),
      op.itemId,
    );
  }
  return [];
}

/**
 * SOURCE OF TRUTH KEYWORDS: split, opSplit, SPLIT_ID_SUFFIX
 *
 * WHAT:  Cuts one item into two adjacent items at an absolute time.
 * WHY:   The cut must be strictly INSIDE the clip: splitting at either edge
 *        would produce a zero-length half, which validate() then rejects — so
 *        it is refused here, where the error can say why.
 *        The second half is a full copy carrying every property, with a
 *        suffixed id. Deriving the id rather than minting a random one keeps
 *        this function pure and the result reproducible, which matters because
 *        the same op list is replayed on the server.
 * WHERE: apply(); the editor's blade tool.
 */
function opSplit(
  doc: TimelineDoc,
  op: Extract<Op, { type: "split" }>,
  path: string,
): ValidationError[] {
  const location = findItem(doc, op.itemId);
  if (location === null) return [notFound(path, op.itemId)];

  const timed = requireTimed(location, path, "split");
  if (!timed.ok) return timed.errors;

  const item = timed.item;
  const end = item.start + item.duration;
  if (op.at <= item.start + TIME_EPSILON || op.at >= end - TIME_EPSILON) {
    return [
      timelineError(
        `${path}.at`,
        "BAD_OPERATION",
        "A split has to land inside the clip, not on its edge.",
      ),
    ];
  }

  const tailStart = roundSeconds(op.at);
  const tailDuration = roundSeconds(end - op.at);
  const tailId = nextSplitId(doc, item.id);

  const tail = cloneDoc(item);
  tail.id = tailId;
  tail.start = tailStart;
  tail.duration = tailDuration;

  item.duration = roundSeconds(op.at - item.start);

  return insertItem(location.track, tail, location.itemIndex + 1, path);
}

/* `a1` becomes `a1-2`, then `a1-3`. Derived, so a replay produces the same ids;
 * the loop is what keeps a second split on the same clip from colliding. */
function nextSplitId(doc: TimelineDoc, baseId: string): string {
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${baseId}-${suffix}`;
    if (findItem(doc, candidate) === null) return candidate;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: move, opMove, RIPPLE
 *
 * WHAT:  Slides an item to a new start, keeping its length.
 * WHY:   With `ripple`, everything that began after this item's old end travels
 *        by the same distance — the downstream clips keep their relationship to
 *        it, which is what makes inserting a beat into a finished video one
 *        gesture instead of twenty.
 * WHERE: apply(); dragging a clip.
 */
function opMove(
  doc: TimelineDoc,
  op: Extract<Op, { type: "move" }>,
  path: string,
): ValidationError[] {
  const location = findItem(doc, op.itemId);
  if (location === null) return [notFound(path, op.itemId)];

  const timed = requireTimed(location, path, "moved");
  if (!timed.ok) return timed.errors;

  const item = timed.item;
  if (op.start < -TIME_EPSILON) {
    return [
      timelineError(
        `${path}.start`,
        "BAD_DURATION",
        "A clip cannot start before zero.",
      ),
    ];
  }

  const originalEnd = item.start + item.duration;
  const delta = roundSeconds(op.start - item.start);
  item.start = roundSeconds(op.start);

  if (op.ripple) rippleFrom(location.track, originalEnd, delta, op.itemId);
  return [];
}

/**
 * SOURCE OF TRUTH KEYWORDS: deleteItem, opDelete
 *
 * WHAT:  Removes an item, optionally closing the gap it leaves.
 * WHY:   Deleting a caption IS allowed, unlike trimming one — removing a
 *        caption group does not contradict the words, it just stops showing
 *        them. Ripple is ignored for captions because their timing is not
 *        theirs to shift.
 * WHERE: apply().
 */
function opDelete(
  doc: TimelineDoc,
  op: Extract<Op, { type: "delete" }>,
  path: string,
): ValidationError[] {
  const location = findItem(doc, op.itemId);
  if (location === null) return [notFound(path, op.itemId)];

  const { track, itemIndex, item } = location;
  const start = item.start;
  const duration = item.duration;
  /* A caption has no gap of its own to close, and an anchored item has no
   * number to close it with — in both cases the removal still happens, only
   * the ripple is skipped. */
  const gap =
    track.type !== "caption" &&
    start !== undefined &&
    duration !== undefined &&
    isSeconds(start) &&
    isSeconds(duration)
      ? { end: start + duration, length: duration }
      : null;

  removeItemAt(track, itemIndex);

  if (op.ripple && gap !== null)
    rippleFrom(track, gap.end, -gap.length, op.itemId);
  return [];
}

/**
 * SOURCE OF TRUTH KEYWORDS: rippleFrom, RIPPLE
 *
 * WHAT:  Shifts every item on one track that began at or after `fromEnd` by
 *        `delta` seconds.
 * WHY:   Scoped to the track, never the document. Rippling globally would drag
 *        the music bed and every caption along with a background clip, which is
 *        never what the gesture meant.
 *        Items are clamped at zero rather than pushed negative, so a ripple
 *        that over-reaches produces a stacked start the user can see instead of
 *        a document validate() refuses to save.
 * WHERE: trim, move, delete.
 */
function rippleFrom(
  track: Track,
  fromEnd: number,
  delta: number,
  exceptItemId: string,
): void {
  if (Math.abs(delta) <= TIME_EPSILON) return;

  for (const candidate of listItems(track)) {
    if (candidate.id === exceptItemId) continue;
    const start = candidate.start;
    if (start === undefined || !isSeconds(start)) continue;
    if (start < fromEnd - TIME_EPSILON) continue;
    candidate.start = roundSeconds(Math.max(0, start + delta));
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: reorder, opReorder, STACKING_ORDER
 *
 * WHAT:  Rearranges a track's items into the given id order.
 * WHY:   STACKING_ORDER. Array position is what decides which of two items at
 *        the same moment draws on top within a lane (`z` only separates
 *        overlays), so this is a visual edit, not bookkeeping.
 *        Every id must be named: a partial list would leave the unnamed items
 *        in an order the caller did not choose and cannot predict.
 * WHERE: apply(); dragging rows in the editor.
 */
function opReorder(
  doc: TimelineDoc,
  op: Extract<Op, { type: "reorder" }>,
  path: string,
): ValidationError[] {
  const track = findTrack(doc, op.trackId);
  if (track === null) {
    return [
      timelineError(
        `${path}.trackId`,
        "NOT_FOUND",
        `There is no track "${op.trackId}".`,
      ),
    ];
  }

  const existing = listItems(track).map((item) => item.id);
  const requested = new Set(op.itemIds);
  if (requested.size !== op.itemIds.length) {
    return [
      timelineError(
        `${path}.itemIds`,
        "BAD_OPERATION",
        "The same item is listed more than once.",
      ),
    ];
  }
  if (
    op.itemIds.length !== existing.length ||
    !existing.every((id) => requested.has(id))
  ) {
    return [
      timelineError(
        `${path}.itemIds`,
        "BAD_OPERATION",
        "A reorder has to list every item on the track exactly once.",
      ),
    ];
  }

  const position = new Map(
    op.itemIds.map((id, index): [string, number] => [id, index]),
  );
  sortItemsInPlace(
    track,
    (left, right) => indexOf(position, left) - indexOf(position, right),
  );
  return [];
}

function indexOf(position: Map<string, number>, item: TrackItem): number {
  return position.get(item.id) ?? 0;
}

/**
 * SOURCE OF TRUTH KEYWORDS: setCaptionText, opSetCaptionText, WORD_SHIFT,
 *   PROPORTIONAL_REDISTRIBUTION
 *
 * WHAT:  Replaces the words a caption covers with new text, re-timing them
 *        across the same span and shifting every later caption's word range.
 * WHY:   This is the only op that touches doc.words, and it has to, because a
 *        caption holds no text of its own (WORD_RANGE_NOT_TEXT). Three
 *        consequences the obvious implementation misses:
 *
 *        PROPORTIONAL_REDISTRIBUTION — the replacement words share the original
 *        span in proportion to their length, not evenly. "I" and
 *        "unbelievable" do not take the same time to say, and an even split
 *        makes the caption visibly lag its audio mid-sentence.
 *
 *        WORD_SHIFT — a different number of words renumbers every token after
 *        the range, so every LATER caption's startWord and endWord move with
 *        it. Skipping that is how an edit near the top of a script desyncs the
 *        whole video.
 *
 *        A caption whose range STRADDLES the edited one is refused rather than
 *        guessed at: there is no correct answer, and captions are not supposed
 *        to overlap in word space.
 * WHERE: apply(); the editor's caption field.
 */
function opSetCaptionText(
  doc: TimelineDoc,
  op: Extract<Op, { type: "setCaptionText" }>,
  path: string,
): ValidationError[] {
  const location = findItem(doc, op.itemId);
  if (location === null) return [notFound(path, op.itemId)];

  const caption = location.item;
  if (location.track.type !== "caption" || !("startWord" in caption)) {
    return [
      timelineError(
        `${path}.itemId`,
        "BAD_OPERATION",
        "Only a caption has text to set.",
      ),
    ];
  }

  const tokens = op.text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (tokens.length === 0) {
    return [
      timelineError(
        `${path}.text`,
        "BAD_OPERATION",
        "A caption needs at least one word. Delete it instead.",
      ),
    ];
  }

  const first = doc.words[caption.startWord];
  const last = doc.words[caption.endWord];
  if (
    first === undefined ||
    last === undefined ||
    caption.endWord < caption.startWord
  ) {
    return [
      timelineError(
        `${path}.itemId`,
        "BAD_WORD_RANGE",
        "This caption does not cover a range of words that exists.",
      ),
    ];
  }

  const oldCount = caption.endWord - caption.startWord + 1;
  const delta = tokens.length - oldCount;

  /* Refuse before mutating anything — see the straddle note in the WHY. */
  for (const ref of allCaptions(doc)) {
    if (ref.id === caption.id) continue;
    const straddles =
      (ref.startWord < caption.startWord && ref.endWord >= caption.startWord) ||
      (ref.startWord <= caption.endWord && ref.endWord > caption.endWord);
    if (straddles) {
      return [
        timelineError(
          `${path}.itemId`,
          "BAD_OPERATION",
          "Another caption overlaps these words, so there is no safe way to re-time them.",
        ),
      ];
    }
  }

  const speaker = first.speaker;
  const replacements = redistribute(tokens, first.s, last.e, speaker);
  doc.words.splice(caption.startWord, oldCount, ...replacements);
  /* `i` is the anchor index and must match the position — see BAD_WORD_TOKEN. */
  doc.words.forEach((token, index) => {
    token.i = index;
  });

  caption.endWord = caption.startWord + tokens.length - 1;
  /* The cached pair is derived and now stale; resolveWordAnchors rewrites it. */
  delete caption.start;
  delete caption.duration;

  if (delta !== 0) {
    for (const ref of allCaptions(doc)) {
      if (ref.id === caption.id) continue;
      if (ref.startWord > caption.endWord - delta) {
        ref.startWord += delta;
        ref.endWord += delta;
      }
    }
  }
  return [];
}

/* Every caption item in the document, as mutable references. */
function allCaptions(doc: TimelineDoc): Array<{
  id: string;
  startWord: number;
  endWord: number;
}> {
  const out: Array<{ id: string; startWord: number; endWord: number }> = [];
  for (const track of doc.tracks) {
    if (track.type !== "caption") continue;
    for (const item of track.items) out.push(item);
  }
  return out;
}

/* Splits [start, end] across the tokens in proportion to their length. See
 * PROPORTIONAL_REDISTRIBUTION. */
function redistribute(
  tokens: readonly string[],
  start: number,
  end: number,
  speaker: string | undefined,
): WordToken[] {
  const span = Math.max(end - start, 0);
  const totalLength = tokens.reduce((sum, token) => sum + token.length, 0);
  const out: WordToken[] = [];
  let cursor = start;

  tokens.forEach((token, index) => {
    const share =
      totalLength > 0 ? token.length / totalLength : 1 / tokens.length;
    const isLast = index === tokens.length - 1;
    /* The last token lands exactly on `end` rather than on an accumulation of
     * rounded shares, so the caption's span is preserved to the microsecond. */
    const tokenEnd = isLast ? end : roundSeconds(cursor + span * share);
    const word: WordToken = {
      i: index,
      w: token,
      s: roundSeconds(cursor),
      e: tokenEnd,
    };
    if (speaker !== undefined) word.speaker = speaker;
    out.push(word);
    cursor = tokenEnd;
  });

  return out;
}

/**
 * SOURCE OF TRUTH KEYWORDS: setItemProps, opSetItemProps, ALLOW_LIST_PATCH
 *
 * WHAT:  Applies a presentation patch to one item.
 * WHY:   The patched result is re-parsed against the item schema for its own
 *        track, so a field that is legal on some item but not this one is
 *        rejected with the schema's own message rather than stored and
 *        discovered at render time. See itemPatchSchema for what is off limits.
 * WHERE: apply(); the editor's properties panel.
 */
function opSetItemProps(
  doc: TimelineDoc,
  op: Extract<Op, { type: "setItemProps" }>,
  path: string,
): ValidationError[] {
  const location = findItem(doc, op.itemId);
  if (location === null) return [notFound(path, op.itemId)];

  const merged: Record<string, unknown> = { ...location.item };
  for (const [key, value] of Object.entries(op.props)) {
    if (value === undefined) continue;
    merged[key] = value;
  }

  const schema = ITEM_SCHEMA_BY_TRACK[location.track.type];
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) =>
      timelineError(
        `${path}.props.${issue.path.join(".")}`,
        "SCHEMA",
        issue.message,
      ),
    );
  }

  return replaceItem(location.track, location.itemIndex, parsed.data, path);
}

/**
 * SOURCE OF TRUTH KEYWORDS: addItem, opAddItem, addOverlay
 *
 * WHAT:  Appends a new item to a track after parsing it against that track's
 *        item schema.
 * WHY:   One handler serves both ops. `addOverlay` exists as a separate op
 *        because the editor's "add overlay" gesture is a distinct, nameable
 *        intent in an undo stack — not because it does anything different —
 *        and it pins the track type so a mis-targeted trackId is an error
 *        rather than a text badge on the audio lane.
 * WHERE: apply().
 */
function opAddItem(
  doc: TimelineDoc,
  op: Extract<Op, { type: "addItem" }>,
  path: string,
  requiredTrackType: Track["type"] | null,
): ValidationError[] {
  const track = findTrack(doc, op.trackId);
  if (track === null) {
    return [
      timelineError(
        `${path}.trackId`,
        "NOT_FOUND",
        `There is no track "${op.trackId}".`,
      ),
    ];
  }
  if (requiredTrackType !== null && track.type !== requiredTrackType) {
    return [
      timelineError(
        `${path}.trackId`,
        "BAD_OPERATION",
        `"${op.trackId}" is a ${track.type} track, so an overlay cannot go on it.`,
      ),
    ];
  }

  const parsed = ITEM_SCHEMA_BY_TRACK[track.type].safeParse(op.item);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) =>
      timelineError(
        `${path}.item.${issue.path.join(".")}`,
        "SCHEMA",
        issue.message,
      ),
    );
  }
  if (findItem(doc, parsed.data.id) !== null) {
    return [
      timelineError(
        `${path}.item.id`,
        "DUPLICATE_ID",
        `Something in this timeline is already called "${parsed.data.id}".`,
      ),
    ];
  }

  return insertItem(track, parsed.data, track.items.length, path);
}

/**
 * SOURCE OF TRUTH KEYWORDS: insertItem, replaceItem, TRACK_VARIANT_NARROWING
 *
 * WHAT:  Writes an item into a track's array at an index, or over one.
 * WHY:   TRACK_VARIANT_NARROWING. `track.items` is a union of five array types,
 *        and pushing into it needs the track narrowed first — so the switch is
 *        written once, here, instead of in each of the four ops that add or
 *        replace an item. A type assertion would have been shorter and would
 *        have let a scene item onto the audio lane.
 * WHERE: split, setItemProps, addItem.
 */
function insertItem(
  track: Track,
  item: TrackItem,
  index: number,
  path: string,
): ValidationError[] {
  return writeItem(track, item, index, 0, path);
}

function replaceItem(
  track: Track,
  index: number,
  item: TrackItem,
  path: string,
): ValidationError[] {
  return writeItem(track, item, index, 1, path);
}

function writeItem(
  track: Track,
  item: TrackItem,
  index: number,
  deleteCount: number,
  path: string,
): ValidationError[] {
  const mismatch = (): ValidationError[] => [
    timelineError(
      path,
      "BAD_OPERATION",
      `That item does not belong on a ${track.type} track.`,
    ),
  ];

  switch (track.type) {
    case "video": {
      const parsed = videoItemSchema.safeParse(item);
      if (!parsed.success) return mismatch();
      track.items.splice(index, deleteCount, parsed.data);
      return [];
    }
    case "scene": {
      const parsed = sceneItemSchema.safeParse(item);
      if (!parsed.success) return mismatch();
      track.items.splice(index, deleteCount, parsed.data);
      return [];
    }
    case "audio": {
      const parsed = audioItemSchema.safeParse(item);
      if (!parsed.success) return mismatch();
      track.items.splice(index, deleteCount, parsed.data);
      return [];
    }
    case "caption": {
      const parsed = captionItemSchema.safeParse(item);
      if (!parsed.success) return mismatch();
      track.items.splice(index, deleteCount, parsed.data);
      return [];
    }
    case "overlay": {
      const parsed = overlayItemSchema.safeParse(item);
      if (!parsed.success) return mismatch();
      track.items.splice(index, deleteCount, parsed.data);
      return [];
    }
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: removeItemAt, sortItemsInPlace, listItems,
 *   TRACK_VARIANT_NARROWING
 *
 * WHAT:  The three array operations that need a track narrowed before they can
 *        run: removing by index, sorting in place, and reading the items as one
 *        flat list.
 * WHY:   `Track['items']` is a union of five array types, so a mutating method
 *        called on it has five incompatible signatures and the compiler refuses
 *        — correctly, since nothing stops a scene item being written into the
 *        audio lane. Narrowing once per operation here keeps the ops readable
 *        and keeps the assertion count at zero. See writeItem for the same
 *        reason on the writing side.
 * WHERE: opDelete, opReorder, findItem.
 */
function removeItemAt(track: Track, index: number): void {
  switch (track.type) {
    case "video":
      track.items.splice(index, 1);
      return;
    case "scene":
      track.items.splice(index, 1);
      return;
    case "audio":
      track.items.splice(index, 1);
      return;
    case "caption":
      track.items.splice(index, 1);
      return;
    case "overlay":
      track.items.splice(index, 1);
      return;
  }
}

function sortItemsInPlace(
  track: Track,
  compare: (left: TrackItem, right: TrackItem) => number,
): void {
  switch (track.type) {
    case "video":
      track.items.sort(compare);
      return;
    case "scene":
      track.items.sort(compare);
      return;
    case "audio":
      track.items.sort(compare);
      return;
    case "caption":
      track.items.sort(compare);
      return;
    case "overlay":
      track.items.sort(compare);
      return;
  }
}

/* A track's items as one list. Reading through this keeps every caller off the
 * union-typed array methods. */
function listItems(track: Track): readonly TrackItem[] {
  return track.items;
}

function notFound(path: string, itemId: string): ValidationError {
  return timelineError(
    `${path}.itemId`,
    "NOT_FOUND",
    `There is no item "${itemId}" to edit.`,
  );
}
