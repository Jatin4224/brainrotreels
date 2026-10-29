/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: session tests, SNAPSHOT_UNDO, UNDO_HASH_IS_EXACT,
 *   SERVER_IS_THE_TRUTH, QUEUE_SURVIVES_A_FLIGHT, BROWSER_EQUALS_SERVER,
 *   TIMELINE_UNDO_DEPTH, restoreDoc
 *
 * WHAT:  The editor's state machine, and the one property the whole phase
 *        rests on: that the browser and the server produce the same document
 *        from the same ops.
 *
 * WHY:   Three of the phase's done-when boxes are claims about THIS file, so
 *        they are asserted here rather than left to a click-through:
 *
 *        UNDO_HASH_IS_EXACT — "undo restores a document whose hash matches the
 *        pre-edit hash exactly". Hashed with hashDoc, which is the same
 *        function Phase 04 uses to decide whether a render can be reused: a
 *        document that hashes equal is a document that renders identically,
 *        which is the strongest form of this claim available.
 *
 *        BROWSER_EQUALS_SERVER — "trim, split and ripple produce the same
 *        result in the browser as the server produces for the same
 *        operations". The browser path is editSession; the server path is the
 *        apply() call inside applyOpsToTimeline. Both are run over one fixture
 *        and compared, because the claim is only worth as much as the test
 *        that one implementation is genuinely reached from both sides.
 *
 *        QUEUE_SURVIVES_A_FLIGHT — editing while a save is in flight is the
 *        normal case, not an edge case, and losing those ops would be a silent
 *        data loss nobody would report as a bug.
 * WHERE: Run by `npm test`. Guards src/lib/timeline/session.ts.
 */

import { describe, expect, it } from "vitest";

import { redditStoryFixture } from "./fixtures";
import { apply, type Op } from "./ops";
import { hashDoc } from "./hash";
import {
  TIMELINE_MAX_OPS_PER_SAVE,
  TIMELINE_UNDO_DEPTH,
  canRedo,
  canUndo,
  confirmSession,
  editSession,
  isDirty,
  openSession,
  pendingOps,
  redoSession,
  restoreDocOp,
  undoSession,
} from "./session";
import type { TimelineDoc } from "./schema";

const TRIM: Op = { type: "trim", itemId: "i1", duration: 3, ripple: false };
const SPLIT: Op = { type: "split", itemId: "i1", at: 2 };
const RIPPLE_MOVE: Op = {
  type: "move",
  itemId: "m1",
  start: 1.5,
  ripple: true,
};

function itemById(doc: TimelineDoc, id: string) {
  for (const track of doc.tracks) {
    for (const item of track.items) {
      if (item.id === id) return item;
    }
  }
  throw new Error(`no item ${id}`);
}

describe("openSession", () => {
  it("starts clean, with nothing to save and nowhere to step", () => {
    const session = openSession(redditStoryFixture(), 7);

    expect(isDirty(session)).toBe(false);
    expect(canUndo(session)).toBe(false);
    expect(canRedo(session)).toBe(false);
    expect(session.revision).toBe(7);
    expect(pendingOps(session)).toEqual([]);
  });
});

describe("editSession", () => {
  it("applies the ops, queues them, and leaves the loaded document alone", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);
    const session = editSession(openSession(doc, 1), [TRIM]);

    expect(itemById(session.doc, "i1").duration).toBe(3);
    expect(session.queue).toEqual([TRIM]);
    expect(isDirty(session)).toBe(true);
    /* PURE_OPS from the session's side: the document handed in is untouched,
     * which is what makes the undo stack's snapshots trustworthy. */
    expect(hashDoc(doc)).toBe(before);
  });

  it("counts one gesture as one undo step however many ops it took", () => {
    const session = editSession(openSession(redditStoryFixture(), 1), [
      TRIM,
      { type: "setItemProps", itemId: "i1", props: { label: "Opening" } },
    ]);

    expect(session.past).toHaveLength(1);
    expect(session.queue).toHaveLength(2);
  });

  it("records no undo step for an edit that was refused outright", () => {
    const session = editSession(openSession(redditStoryFixture(), 1), [
      { type: "trim", itemId: "nope", duration: 2, ripple: false },
    ]);

    expect(canUndo(session)).toBe(false);
    expect(isDirty(session)).toBe(false);
    expect(session.errors.length).toBeGreaterThan(0);
  });

  it("records the step when the op applied but left the document invalid", () => {
    /* Two legal ops that between them drop one overlay on top of another at
     * the same depth: the edit DID happen and the user needs to be able to
     * undo it, which is the distinction failedOpCount exists to make. */
    const session = editSession(openSession(redditStoryFixture(), 1), [
      { type: "move", itemId: "o2", start: 1, ripple: false },
      { type: "setItemProps", itemId: "o2", props: { z: 10 } },
    ]);

    expect(canUndo(session)).toBe(true);
    expect(session.errors.length).toBeGreaterThan(0);
  });

  it("clears the redo branch once a new edit is made", () => {
    const edited = editSession(openSession(redditStoryFixture(), 1), [TRIM]);
    const undone = undoSession(edited);
    expect(canRedo(undone)).toBe(true);

    const branched = editSession(undone, [SPLIT]);
    expect(canRedo(branched)).toBe(false);
  });

  it("keeps the undo stack at the documented depth", () => {
    let session = openSession(redditStoryFixture(), 1);
    for (let n = 0; n < TIMELINE_UNDO_DEPTH + 10; n += 1) {
      session = editSession(session, [
        { type: "setItemProps", itemId: "i1", props: { label: `take ${n}` } },
      ]);
    }

    expect(session.past).toHaveLength(TIMELINE_UNDO_DEPTH);
  });
});

describe("undo and redo", () => {
  /* UNDO_HASH_IS_EXACT — the phase's own check, run over each of the three
   * ops it names. */
  it.each([
    ["trim", TRIM],
    ["split", SPLIT],
    ["ripple move", RIPPLE_MOVE],
  ] as const)("restores a document that hashes identically after %s", (
    _label,
    op,
  ) => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);

    const edited = editSession(openSession(doc, 1), [op]);
    expect(hashDoc(edited.doc)).not.toBe(before);

    const undone = undoSession(edited);
    expect(hashDoc(undone.doc)).toBe(before);
  });

  it("round-trips through redo", () => {
    const edited = editSession(openSession(redditStoryFixture(), 1), [TRIM]);
    const after = hashDoc(edited.doc);

    const redone = redoSession(undoSession(edited));
    expect(hashDoc(redone.doc)).toBe(after);
  });

  it("posts a restore rather than an inverse op", () => {
    const edited = editSession(openSession(redditStoryFixture(), 1), [TRIM]);
    const undone = undoSession(edited);

    expect(undone.queue).toHaveLength(1);
    expect(undone.queue[0]?.type).toBe("restoreDoc");
    /* And that restore reproduces the document on the server's side of the
     * wire, which is the only thing that makes it a legitimate substitute. */
    const replayed = apply(edited.doc, undone.queue);
    expect(hashDoc(replayed.doc)).toBe(hashDoc(undone.doc));
    expect(replayed.errors).toEqual([]);
  });

  it("does nothing at the ends of the stacks", () => {
    const session = openSession(redditStoryFixture(), 1);

    expect(undoSession(session)).toBe(session);
    expect(redoSession(session)).toBe(session);
  });

  it("survives an undo that crosses a save", () => {
    const doc = redditStoryFixture();
    const before = hashDoc(doc);

    const edited = editSession(openSession(doc, 1), [TRIM]);
    /* The autosave fired and the server accepted the trim. */
    const saved = confirmSession(
      edited,
      apply(doc, [TRIM]).doc,
      2,
      edited.queue.length,
    );
    expect(isDirty(saved)).toBe(false);

    const undone = undoSession(saved);
    expect(hashDoc(undone.doc)).toBe(before);
    /* The trim is already in the server's document, so the undo has to be
     * expressed as something that goes BACK — UNDO_PAST_THE_SAVE. */
    expect(undone.queue[0]?.type).toBe("restoreDoc");
    expect(isDirty(undone)).toBe(true);
  });
});

describe("confirmSession", () => {
  it("adopts the server's document as the new baseline", () => {
    const doc = redditStoryFixture();
    const edited = editSession(openSession(doc, 4), [TRIM]);
    const serverDoc = apply(doc, [TRIM]).doc;

    const confirmed = confirmSession(edited, serverDoc, 5, 1);

    expect(confirmed.revision).toBe(5);
    expect(confirmed.savedDoc).toBe(serverDoc);
    expect(confirmed.doc).toBe(serverDoc);
    expect(isDirty(confirmed)).toBe(false);
  });

  it("replays the ops made while the save was in flight", () => {
    const doc = redditStoryFixture();

    const sent = editSession(openSession(doc, 1), [TRIM]);
    const sentCount = pendingOps(sent).length;
    /* The user kept working while the request was out. */
    const kept = editSession(sent, [
      { type: "setItemProps", itemId: "i1", props: { label: "Opening" } },
    ]);

    const confirmed = confirmSession(kept, apply(doc, [TRIM]).doc, 2, sentCount);

    /* QUEUE_SURVIVES_A_FLIGHT: the in-flight op is gone from the queue and the
     * one made during the flight is still there, applied to the screen. */
    expect(confirmed.queue).toHaveLength(1);
    expect(itemById(confirmed.doc, "i1").label).toBe("Opening");
    expect(itemById(confirmed.doc, "i1").duration).toBe(3);
    expect(confirmed.revision).toBe(2);
  });

  it("converges on the server when the local document disagreed", () => {
    const doc = redditStoryFixture();
    const edited = editSession(openSession(doc, 1), [TRIM]);

    /* SERVER_IS_THE_TRUTH: a server document that differs from the local one
     * wins outright rather than being merged. */
    const serverDoc = apply(doc, [
      { type: "trim", itemId: "i1", duration: 4, ripple: false },
    ]).doc;
    const confirmed = confirmSession(edited, serverDoc, 2, 1);

    expect(itemById(confirmed.doc, "i1").duration).toBe(4);
  });

  it("never posts more ops in one request than the contract accepts", () => {
    let session = openSession(redditStoryFixture(), 1);
    for (let n = 0; n < TIMELINE_MAX_OPS_PER_SAVE + 5; n += 1) {
      session = editSession(session, [
        { type: "setItemProps", itemId: "i1", props: { label: `take ${n}` } },
      ]);
    }

    expect(pendingOps(session)).toHaveLength(TIMELINE_MAX_OPS_PER_SAVE);
    expect(session.queue.length).toBeGreaterThan(TIMELINE_MAX_OPS_PER_SAVE);
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: BROWSER_EQUALS_SERVER
 *
 * The phase's first done-when box. The editor's path to a document is
 * editSession; the server's is the apply() call in applyOpsToTimeline. Running
 * both over one fixture is what proves the two paths are the same function
 * rather than two implementations that happen to agree today.
 */
describe("the browser and the server agree", () => {
  it.each([
    ["trim", [TRIM]],
    ["split", [SPLIT]],
    ["ripple move", [RIPPLE_MOVE]],
    ["trim then split then ripple", [TRIM, SPLIT, RIPPLE_MOVE]],
  ] as const)("produces one document for %s", (_label, ops) => {
    const doc = redditStoryFixture();

    /* The browser: ops applied locally as the user makes them, one gesture at
     * a time, through the session. */
    let session = openSession(doc, 1);
    for (const op of ops) session = editSession(session, [op]);

    /* The server: the same op list posted in one request and replayed against
     * the stored document. */
    const server = apply(redditStoryFixture(), [...ops]);

    expect(hashDoc(session.doc)).toBe(hashDoc(server.doc));
    expect(session.errors).toEqual(server.errors);
  });

  it("agrees on a restore, which is how undo reaches the server", () => {
    const doc = redditStoryFixture();
    const edited = editSession(openSession(doc, 1), [SPLIT]);
    const server = apply(edited.doc, [restoreDocOp(doc)]);

    expect(hashDoc(server.doc)).toBe(hashDoc(doc));
    expect(server.errors).toEqual([]);
  });
});
