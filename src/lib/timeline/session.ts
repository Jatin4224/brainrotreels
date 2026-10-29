/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: EditorSession, openSession, editSession,
 *   undoSession, redoSession, confirmSession, pendingOps, isDirty,
 *   TIMELINE_UNDO_DEPTH, TIMELINE_MAX_OPS_PER_SAVE, SNAPSHOT_UNDO,
 *   SERVER_IS_THE_TRUTH, QUEUE_SURVIVES_A_FLIGHT, ISOMORPHIC_PURE_MODULE
 *
 * WHAT:  The editor's whole state machine as pure functions: what is on screen,
 *        what has not been saved yet, and the undo and redo stacks.
 *
 * WHY:   It lives here rather than inside the React hook because every rule in
 *        it is testable without a browser, and because the phase's hardest
 *        requirement — "undo restores a document whose hash matches the
 *        pre-edit hash exactly" — is a property of this file and is asserted
 *        against it directly. A reducer tangled into useState is a reducer
 *        nothing can prove.
 *
 *        ISOMORPHIC_PURE_MODULE: no React, no fetch, no clock. The hook owns
 *        the debounce timer and the mutation; this owns the answers.
 *
 *        SNAPSHOT_UNDO. The undo stack holds DOCUMENTS, not inverse ops. That
 *        is the only way to make the restored document identical rather than
 *        merely equivalent: `split` and `delete` have no faithful inverse — an
 *        inverted delete has to invent the item's array position, and array
 *        position is what decides which of two clips draws on top
 *        (STACKING_ORDER in ops.ts). Fifty documents is a few megabytes of
 *        browser memory for a three-minute project, which is the cheaper half
 *        of that trade by a wide margin.
 *
 *        An undo therefore posts a `restoreDoc` op rather than an inverse —
 *        see WHOLE_DOCUMENT_IS_STILL_AN_OP in ops.ts for why that op exists at
 *        all. A normal edit still posts its own trim or split, so what the
 *        server replays for an ordinary gesture is exactly what the browser
 *        ran.
 *
 *        SERVER_IS_THE_TRUTH. confirmSession() does not trust the local
 *        document: it takes the document the server returned and re-applies
 *        whatever is still queued on top of it. A browser whose local apply()
 *        somehow diverged converges on the next save instead of drifting for a
 *        whole session.
 *
 *        QUEUE_SURVIVES_A_FLIGHT: ops produced WHILE a save is in flight are
 *        not lost and not sent twice. The caller sends a prefix, and
 *        confirmSession drops exactly that prefix — so typing through a save
 *        is a normal thing to do rather than a race.
 *
 * WHERE: Driven by the editor's use-timeline-editor hook. Re-exported from
 *        src/lib/timeline.
 */

import { apply, type Op } from "./ops";
import type { TimelineDoc } from "./schema";
import type { ValidationError } from "./errors";
import { cloneDoc } from "./time";

/**
 * SOURCE OF TRUTH KEYWORDS: TIMELINE_UNDO_DEPTH, TIMELINE_MAX_OPS_PER_SAVE
 *
 * WHAT:  How far back undo reaches, and how many ops one save may carry.
 * WHY:   Fifty is the phase's own figure for undo. The save cap matches the
 *        `.max(50)` on the applyOps input: the two are the same number because
 *        a queue that could outgrow what one request accepts would need a
 *        second round-trip nobody wrote.
 * WHERE: editSession's stack trim; pendingOps' slice; the applyOps input.
 */
export const TIMELINE_UNDO_DEPTH = 50;

export const TIMELINE_MAX_OPS_PER_SAVE = 50;

/**
 * SOURCE OF TRUTH KEYWORDS: EditorSession
 *
 * WHAT:  Everything the editor knows, at one instant.
 * WHY:   `doc` is what the screen draws; `savedDoc` and `revision` are what the
 *        server last confirmed. Keeping both is what makes a dirty check
 *        possible without hashing on every keystroke, and what gives
 *        confirmSession something to rebase onto.
 * WHERE: Held in one useState by the editor hook; produced by every function
 *        below.
 */
export interface EditorSession {
  readonly doc: TimelineDoc;
  readonly savedDoc: TimelineDoc;
  /** The Timeline.revision `savedDoc` came from. */
  readonly revision: number;
  /** Ops applied locally and not yet confirmed by the server, in order. */
  readonly queue: readonly Op[];
  readonly past: readonly TimelineDoc[];
  readonly future: readonly TimelineDoc[];
  /** Problems reported by the most recent edit. Cleared by the next one. */
  readonly errors: readonly ValidationError[];
}

/**
 * SOURCE OF TRUTH KEYWORDS: openSession
 *
 * WHAT:  A fresh session around a loaded document.
 * WHY:   Also the reload path: answering a `conflict` means opening a new
 *        session on the server's document, which discards the stacks on
 *        purpose — an undo stack whose documents predate somebody else's edit
 *        would quietly reintroduce it.
 * WHERE: The hook, when the document query first resolves and after a reload.
 */
export function openSession(
  doc: TimelineDoc,
  revision: number,
): EditorSession {
  return {
    doc,
    savedDoc: doc,
    revision,
    queue: [],
    past: [],
    future: [],
    errors: [],
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: editSession, ONE_GESTURE_ONE_UNDO
 *
 * WHAT:  Runs ops through apply(), pushes the previous document onto the undo
 *        stack and queues the ops for the next save.
 * WHY:   ONE_GESTURE_ONE_UNDO — the ops of a single gesture are passed
 *        together and cost ONE undo step, because "delete this scene and its
 *        captions" is one thing a person did and two things the document
 *        needed. That is why this takes a list rather than one op.
 *
 *        An edit that produced nothing but errors is NOT pushed onto the
 *        stack: apply() returns the document unchanged in that case, and an
 *        undo step that restores the state it was already in reads as a broken
 *        undo button. The errors are still surfaced.
 *
 *        The redo stack is cleared, which is the universal rule — a branch
 *        taken after an undo makes the abandoned branch unreachable, and
 *        keeping it would let a redo land a document the user never saw.
 * WHERE: Every gesture in the editor.
 */
export function editSession(
  session: EditorSession,
  ops: readonly Op[],
): EditorSession {
  if (ops.length === 0) return session;

  const result = apply(session.doc, ops);

  /* Nothing moved — report the problem and leave the history alone. */
  if (failedOpCount(result.errors) === ops.length) {
    return { ...session, errors: result.errors };
  }

  return {
    ...session,
    doc: result.doc,
    queue: [...session.queue, ...ops],
    past: trimPast([...session.past, session.doc]),
    future: [],
    errors: result.errors,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: failedOpCount, OP_PATHS_ARE_THE_CONTRACT
 *
 * WHAT:  How many of the submitted ops were refused.
 * WHY:   OP_PATHS_ARE_THE_CONTRACT. apply() reports a refused op under the
 *        dotted path `ops.<index>` and an invariant the RESULT breaks under
 *        the document's own path, so the prefix is what tells a refused edit
 *        apart from an edit that happened and left the document in a state the
 *        renderer will refuse. Counting all errors instead would
 *        make a successful trim that pushed a clip past the end look like a
 *        failed trim, and skip its undo step.
 *
 *        Deduplicated by index because one refused op can report several
 *        fields (`ops.0.start` and `ops.0.duration`).
 * WHERE: editSession's decision to push an undo step.
 */
function failedOpCount(errors: readonly ValidationError[]): number {
  const indexes = new Set<string>();
  for (const error of errors) {
    const match = /^ops\.(\d+)(\.|$)/.exec(error.path);
    if (match?.[1] !== undefined) indexes.add(match[1]);
  }
  return indexes.size;
}

/**
 * SOURCE OF TRUTH KEYWORDS: undoSession, redoSession, SNAPSHOT_UNDO,
 *   UNDO_POSTS_A_RESTORE
 *
 * WHAT:  Steps the document back or forward through the stacks.
 * WHY:   UNDO_POSTS_A_RESTORE. The queue is REPLACED by a single `restoreDoc`
 *        rather than having the undone ops removed from it, and the difference
 *        matters whenever a save already went out: the ops being undone may
 *        already be in the server's document, where shortening a local queue
 *        would change nothing. One restore is correct in both cases, which is
 *        worth more than the smaller payload of the case where the queue could
 *        have been trimmed.
 *
 *        Returns the session unchanged when the stack is empty, so the caller
 *        can bind a key to it without guarding first.
 * WHERE: Ctrl+Z / Ctrl+Shift+Z in the editor.
 */
export function undoSession(session: EditorSession): EditorSession {
  const previous = session.past.at(-1);
  if (previous === undefined) return session;

  return {
    ...session,
    doc: previous,
    queue: [restoreDocOp(previous)],
    past: session.past.slice(0, -1),
    future: trimFuture([session.doc, ...session.future]),
    errors: [],
  };
}

export function redoSession(session: EditorSession): EditorSession {
  const next = session.future[0];
  if (next === undefined) return session;

  return {
    ...session,
    doc: next,
    queue: [restoreDocOp(next)],
    past: trimPast([...session.past, session.doc]),
    future: session.future.slice(1),
    errors: [],
  };
}

export function canUndo(session: EditorSession): boolean {
  return session.past.length > 0;
}

export function canRedo(session: EditorSession): boolean {
  return session.future.length > 0;
}

/**
 * SOURCE OF TRUTH KEYWORDS: restoreDocOp, restoreDoc
 *
 * WHAT:  The op that replaces the whole document with this one.
 * WHY:   Built here rather than at each call site so the clone is not
 *         forgotten: an op is replayed, and an op holding a live reference to
 *         the session's document would be mutated by the next edit.
 * WHERE: undoSession, redoSession, and the revision restore in
 *        src/trpc/routers/timeline.ts.
 */
export function restoreDocOp(doc: TimelineDoc): Op {
  return { type: "restoreDoc", doc: cloneDoc(doc) };
}

/**
 * SOURCE OF TRUTH KEYWORDS: pendingOps, TIMELINE_MAX_OPS_PER_SAVE
 *
 * WHAT:  The ops to post next, oldest first, capped at what one request takes.
 * WHY:   A prefix rather than the whole queue, because the cap is a contract on
 *        the input and a session can out-edit a slow network. The caller sends
 *        this, then hands the COUNT back to confirmSession — which is what
 *        makes the drop exact rather than "clear the queue and hope nothing
 *        arrived meanwhile".
 * WHERE: The hook's autosave; its manual save.
 */
export function pendingOps(session: EditorSession): readonly Op[] {
  return session.queue.slice(0, TIMELINE_MAX_OPS_PER_SAVE);
}

export function isDirty(session: EditorSession): boolean {
  return session.queue.length > 0;
}

/**
 * SOURCE OF TRUTH KEYWORDS: confirmSession, SERVER_IS_THE_TRUTH,
 *   QUEUE_SURVIVES_A_FLIGHT
 *
 * WHAT:  Folds an accepted save back into the session.
 * WHY:   Takes the server's document as the new baseline and re-applies
 *        whatever is still queued on top of it — SERVER_IS_THE_TRUTH. The
 *        alternative, keeping the local document and only bumping the
 *        revision, would hide a divergence between the browser's apply() and
 *        the server's for as long as the session lasted, which is exactly the
 *        failure this architecture exists to make impossible.
 *
 *        `sentCount` is dropped from the FRONT of the queue rather than the
 *        queue being emptied: ops made while the request was in flight are
 *        still unsaved and must survive — QUEUE_SURVIVES_A_FLIGHT.
 *
 *        The undo stack is untouched. Saving is not an edit, and a save that
 *        reset history would make Ctrl+Z stop working every time the autosave
 *        fired.
 * WHERE: The hook's applyOps mutation, on success.
 */
export function confirmSession(
  session: EditorSession,
  serverDoc: TimelineDoc,
  serverRevision: number,
  sentCount: number,
): EditorSession {
  const queue = session.queue.slice(sentCount);
  const replayed = queue.length === 0 ? null : apply(serverDoc, queue);

  return {
    ...session,
    doc: replayed === null ? serverDoc : replayed.doc,
    savedDoc: serverDoc,
    revision: serverRevision,
    queue,
    errors: replayed === null ? [] : replayed.errors,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: trimPast, trimFuture, TIMELINE_UNDO_DEPTH
 *
 * WHAT:  Caps each stack at the undo depth, dropping from the far end.
 * WHY:   Two functions because the far end is at a DIFFERENT end of each
 *        array. `past` grows by pushing, so its newest step is last and its
 *        oldest — the one a person is least likely to want back — is first.
 *        `future` grows by unshifting, so its NEXT redo is first and the
 *        furthest-forward state is last. Trimming both the same way would
 *        throw away the redo step about to be used, which is the kind of bug
 *        that only shows up after fifty edits.
 *
 *        An uncapped stack on a long session is a memory leak with a document
 *        in it, which is the only reason either exists.
 * WHERE: editSession, undoSession, redoSession.
 */
function trimPast(stack: readonly TimelineDoc[]): readonly TimelineDoc[] {
  return stack.length <= TIMELINE_UNDO_DEPTH
    ? stack
    : stack.slice(stack.length - TIMELINE_UNDO_DEPTH);
}

function trimFuture(stack: readonly TimelineDoc[]): readonly TimelineDoc[] {
  return stack.length <= TIMELINE_UNDO_DEPTH
    ? stack
    : stack.slice(0, TIMELINE_UNDO_DEPTH);
}
