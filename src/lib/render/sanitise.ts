/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: dropUnknownRenderKinds, SanitiseResult,
 *   FORWARD_COMPATIBLE_DOCUMENT, ONE_BAD_ITEM_IS_NOT_A_BAD_DOCUMENT,
 *   UNKNOWN_DRAWS_NOTHING
 *
 * WHAT:  Removes items whose `render` value this build does not know about,
 *        before the document is parsed, and reports what it dropped.
 * WHY:   ONE_BAD_ITEM_IS_NOT_A_BAD_DOCUMENT. `timelineDocSchema` is `.strict()`
 *        and its `render` field is a closed enum, which is right for everything
 *        that WRITES a document — a generator inventing a render kind should
 *        fail loudly. It is wrong for the thing that RENDERS one, and the
 *        difference is a real deployment shape, not a hypothetical:
 *
 *            a document written by a newer release
 *            → rendered by a worker still on the old one
 *            → `render: 'newThing'` fails the whole parse
 *            → the customer's video comes out BLACK
 *
 *        architecture.md's rule is the opposite — "an unknown `render` value
 *        logs a warning and draws nothing… a bad item must never crash a paid
 *        render" — and the registry already honours it for a kind that is in
 *        the union but has no component yet. This closes the other half, where
 *        the value is not in the union at all.
 *
 *        Items are DROPPED rather than rewritten to a known kind. Rewriting to
 *        `media` was the obvious alternative and it is worse than useless: the
 *        item would draw its asset in a way the newer release never intended,
 *        so instead of a missing element the customer gets a wrong one, which
 *        nobody can look at and diagnose.
 *
 *        Pure and schema-free on purpose. It runs BEFORE validation, on
 *        whatever JSON arrived, so it cannot rely on the document already being
 *        well-formed — every navigation step below is defensive for that
 *        reason, not out of habit.
 * WHERE: Called by src/remotion/timeline-renderer.tsx immediately before the
 *        strict parse. Unit-tested in ./sanitise.test.ts.
 */

import { RENDER_KINDS } from "@/lib/timeline";

export interface SanitiseResult {
  /** The document with unknown-render items removed. */
  doc: Record<string, unknown>;
  /** Each distinct unknown value found, for one log line per render. */
  droppedKinds: string[];
  /** How many items were removed in total. */
  droppedCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * SOURCE OF TRUTH KEYWORDS: dropUnknownRenderKinds
 *
 * WHAT:  A copy of the document with unrenderable items removed.
 * WHY:   Returns a COPY, never mutating its input, for the same reason every
 *        timeline op does: the caller may be the editor holding that object in
 *        an undo stack, and a renderer that quietly edited the document being
 *        edited would be very hard to explain.
 *
 *        An item with NO `render` field is kept. That is not an oversight —
 *        audio and caption items legitimately have none (there is nothing to
 *        choose between), and dropping them would silence every video.
 * WHERE: TimelineRenderer, before `timelineDocSchema.safeParse`.
 */
export function dropUnknownRenderKinds(input: unknown): SanitiseResult {
  const known: readonly string[] = RENDER_KINDS;

  if (!isRecord(input)) {
    return { doc: {}, droppedKinds: [], droppedCount: 0 };
  }

  const tracks = input["tracks"];
  if (!Array.isArray(tracks)) {
    /* Nothing to walk. The strict parse downstream is what reports a document
     * with no tracks array as malformed — this function does not duplicate
     * that judgement. */
    return { doc: { ...input }, droppedKinds: [], droppedCount: 0 };
  }

  const droppedKinds = new Set<string>();
  let droppedCount = 0;

  const nextTracks = tracks.map((track) => {
    if (!isRecord(track)) return track;
    const items = track["items"];
    if (!Array.isArray(items)) return track;

    const keptItems = items.filter((item) => {
      if (!isRecord(item)) return true;
      const render = item["render"];
      /* Absent is fine — see the WHY. A non-string `render` is malformed in a
       * way the strict parse should report, so it is left in place. */
      if (typeof render !== "string") return true;
      if (known.includes(render)) return true;

      droppedKinds.add(render);
      droppedCount += 1;
      return false;
    });

    return { ...track, items: keptItems };
  });

  return {
    doc: { ...input, tracks: nextTracks },
    droppedKinds: [...droppedKinds],
    droppedCount,
  };
}
