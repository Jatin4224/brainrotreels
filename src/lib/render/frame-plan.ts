/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: planComposition, planTimeline, planFrame,
 *   CompositionPlan, PlannedItem, LAYER_ORDER, TRACK_ORDER_IS_STACK_ORDER,
 *   PLAN_IS_PURE, RENDER_PLANNING, collectAssetHandles
 *
 * WHAT:  Turns a resolved timeline document into a flat, frame-addressed draw
 *        list: which items exist, in what order, from which frame, for how
 *        many frames.
 * WHY:   PLAN_IS_PURE, and it is the same argument as src/lib/timeline's
 *        purity. This module imports no Remotion, no React and nothing
 *        platform-specific, which buys three things that matter more than the
 *        indirection costs:
 *
 *          1. It is UNIT TESTABLE. The questions worth asking about a renderer
 *             — is this item on screen at frame 412, what order do the layers
 *             stack in, where does a loop restart — are answerable here with
 *             no browser, no Chrome, and no ffmpeg.
 *          2. Phase 15's editor needs the same answers to draw its timeline
 *             ruler, and it must not import a Remotion composition to get them.
 *          3. It is where DETERMINISM is enforceable. Given a document, the
 *             plan is a pure function of it — so "the same document renders
 *             identically twice" reduces to "the components draw the plan
 *             faithfully", which is a much smaller thing to trust.
 *
 *        TRACK_ORDER_IS_STACK_ORDER: tracks are composited in ARRAY ORDER,
 *        bottom-most first, exactly as the timeline schema promises
 *        ("Walked by the renderer in array order, bottom-most first"). Overlay
 *        items additionally sort by their own `z` WITHIN the overlay layer.
 *        Sorting everything globally by `z` was the alternative and it is
 *        wrong: only overlays declare `z`, so every other item would collapse
 *        to one depth and the lane structure the document spent five track
 *        types describing would stop meaning anything.
 * WHERE: src/remotion/timeline-renderer.tsx walks `planTimeline()`;
 *        ./frame-plan.test.ts snapshots `planFrame()`. Phase 04's pre-flight
 *        reads `planComposition()` for the frame count it bills on.
 */

import {
  TRACK_TYPES,
  documentLength,
  itemSpan,
  secondsToFrames,
  type AssetRef,
  type RenderKind,
  type TimelineDoc,
  type Track,
  type TrackItem,
} from "@/lib/timeline";

/**
 * SOURCE OF TRUTH KEYWORDS: LAYER_ORDER, TRACK_ORDER_IS_STACK_ORDER
 *
 * WHAT:  Which lane draws on top of which, when two tracks of different types
 *        both have something on screen.
 * WHY:   Array order decides between tracks of the SAME type (two video lanes),
 *        but a document is free to list its tracks in any order — the Reddit
 *        fixture happens to put its scene track before its audio — so the
 *        renderer cannot rely on authoring order alone without letting a
 *        generator accidentally bury its captions under a background. This is
 *        the stable per-type floor; ties inside a type keep array order.
 *
 *        `audio` is in the list with a layer of its own purely so the plan is
 *        total over TRACK_TYPES. It draws nothing, and the renderer composites
 *        audio outside the visual stack.
 * WHERE: planTimeline's sort, below.
 */
export const LAYER_ORDER: Readonly<Record<Track["type"], number>> = {
  video: 0,
  scene: 10,
  overlay: 20,
  caption: 30,
  /* Not a visual layer — see the note above. */
  audio: -1,
};

/* A compile error if a track type is ever added without a layer decision. */
const _LAYER_ORDER_IS_TOTAL: readonly Track["type"][] = TRACK_TYPES;

/**
 * SOURCE OF TRUTH KEYWORDS: PlannedItem
 *
 * WHAT:  One item, located in frames and ready to draw.
 * WHY:   Frames, not seconds, because that is the only unit Remotion sequences
 *        accept — and converting once here rather than inside each component is
 *        what stops two components rounding the same boundary differently and
 *        producing a one-frame flicker between them.
 *
 *        `layer` and `order` are both carried: `layer` is the per-type floor
 *        from LAYER_ORDER and `order` is the item's position within the
 *        document, which breaks ties deterministically. A sort with no
 *        tiebreaker is not a deterministic sort, and Phase 04 reuses renders by
 *        document hash, so an unstable draw order would produce two different
 *        videos from one hash.
 * WHERE: Returned by planTimeline; consumed by the composition and by
 *        planFrame.
 */
export interface PlannedItem {
  /** The item's own id, unique within the document. */
  id: string;
  /** Which lane it came from, so the composition knows how to draw it. */
  trackType: Track["type"];
  /** Which component family draws it. Captions and audio have none. */
  render: RenderKind | null;
  from: number;
  durationInFrames: number;
  layer: number;
  /** Position in the flattened document, for a stable sort. */
  order: number;
  /** Overlay depth, when the item declares one. */
  z: number | null;
  item: TrackItem;
}

export interface CompositionPlan {
  width: number;
  height: number;
  fps: number;
  /** Always at least 1 — see MINIMUM_ONE_FRAME. */
  durationInFrames: number;
  durationInSeconds: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: planComposition, MINIMUM_ONE_FRAME
 *
 * WHAT:  The composition's canvas and length, derived from the document.
 * WHY:   The brief requires the duration to come from the document rather than
 *        being hard-coded, and `documentLength()` already owns that rule
 *        (VIDEO_LENGTH_RULE: the span of the video and audio lanes, because
 *        those are the two things with an intrinsic duration).
 *
 *        MINIMUM_ONE_FRAME: a zero-length composition is a Remotion error, not
 *        an empty video — `durationInFrames` must be positive. An empty or
 *        still-generating document is an ordinary state (a project is created
 *        before anything is generated into it), so it clamps to one frame and
 *        renders a single black frame instead of refusing to mount. That keeps
 *        the preview page usable on a draft project.
 * WHERE: `<Composition>` in src/remotion/root.tsx and the Player's props.
 */
export function planComposition(doc: TimelineDoc): CompositionPlan {
  const seconds = documentLength(doc);
  return {
    width: doc.canvas.width,
    height: doc.canvas.height,
    fps: doc.canvas.fps,
    durationInFrames: Math.max(1, secondsToFrames(seconds, doc.canvas.fps)),
    durationInSeconds: seconds,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: planTimeline, SKIP_UNRESOLVED_ITEM
 *
 * WHAT:  Every drawable item in the document, in composite order.
 * WHY:   SKIP_UNRESOLVED_ITEM. An item whose span does not resolve — an anchor
 *        naming a word the script does not contain — is DROPPED from the plan
 *        rather than drawn at zero. `resolveWordAnchors` leaves such anchors in
 *        place deliberately (see its PARTIAL_RESOLUTION note), so a renderer
 *        handed a partially-resolved document must not invent a time for them:
 *        an item at frame 0 that should have been at 0:42 is a wrong video,
 *        while a missing item is a visibly incomplete one. `validate()` is
 *        what reports the dangling anchor as the real problem.
 *
 *        Items of zero length are dropped for the same reason: a Sequence with
 *        `durationInFrames: 0` draws nothing anyway, and keeping it in the plan
 *        would make the frame-visibility maths lie about what is on screen.
 * WHERE: The composition's single `.map()`; planFrame below.
 */
export function planTimeline(doc: TimelineDoc): PlannedItem[] {
  const planned: PlannedItem[] = [];
  let order = 0;

  for (const track of doc.tracks) {
    for (const item of track.items) {
      const index = order;
      order += 1;

      const span = itemSpan(item, doc.words);
      if (span === null) continue;

      const from = secondsToFrames(span.start, doc.canvas.fps);
      const durationInFrames = secondsToFrames(
        span.end - span.start,
        doc.canvas.fps,
      );
      if (durationInFrames <= 0) continue;

      planned.push({
        id: item.id,
        trackType: track.type,
        render: "render" in item ? item.render : null,
        from,
        durationInFrames,
        layer: LAYER_ORDER[track.type],
        order: index,
        z: "z" in item ? item.z : null,
        item,
      });
    }
  }

  /* Stable by construction: layer, then overlay depth, then document order.
   * Every comparison is total, so the result does not depend on the sort
   * implementation — which it would if the comparator ever returned 0 for two
   * genuinely different items. */
  return planned.sort(compareForComposite);
}

function compareForComposite(a: PlannedItem, b: PlannedItem): number {
  if (a.layer !== b.layer) return a.layer - b.layer;
  if (a.z !== null && b.z !== null && a.z !== b.z) return a.z - b.z;
  return a.order - b.order;
}

/**
 * SOURCE OF TRUTH KEYWORDS: planFrame, FRAME_WINDOW_IS_HALF_OPEN
 *
 * WHAT:  The items on screen at one frame, in composite order.
 * WHY:   FRAME_WINDOW_IS_HALF_OPEN — `[from, from + durationInFrames)`. The
 *        last frame of an item is `from + durationInFrames - 1`, which is the
 *        same convention Remotion's `<Sequence>` uses, so the plan and the
 *        thing drawing it agree. An inclusive end would double-draw one frame
 *        wherever two items are laid back to back, and back-to-back items are
 *        the normal case for captions.
 *
 *        Audio items are included: "on screen" here means "active at this
 *        frame", and a caller asking what is playing at frame 412 wants the
 *        music bed in the answer. The composition filters by track type, not
 *        this function.
 * WHERE: ./frame-plan.test.ts, which snapshots the first, middle and last
 *        frame of a fixture; available to the editor's playhead inspector.
 */
export function planFrame(doc: TimelineDoc, frame: number): PlannedItem[] {
  return planTimeline(doc).filter(
    (planned) =>
      frame >= planned.from && frame < planned.from + planned.durationInFrames,
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: collectAssetHandles, HANDLES_ACTUALLY_REFERENCED
 *
 * WHAT:  Every handle in `doc.assets`, paired with the Asset row id behind it.
 * WHY:   Read off `doc.assets` rather than scraped from the items, and the
 *        difference matters in both directions. A handle declared but unused
 *        costs one signature and keeps the map complete for a scene element
 *        that reaches for it (Phase 12's card art is addressed by elements, not
 *        by the item). A handle used but NOT declared is a broken document —
 *        `validate()` reports it as such — and scraping the items would paper
 *        over that by signing whatever string an item happened to contain.
 *
 *        Pure, so the signing step (which needs the database and the storage
 *        adapter) stays on the server while the collection is testable
 *        anywhere.
 * WHERE: `projects.preview` passes the result to
 *        signDocumentAssets in src/services/assets.service.ts.
 */
export function collectAssetHandles(
  doc: TimelineDoc,
): { handle: string; ref: AssetRef }[] {
  return Object.entries(doc.assets).map(([handle, ref]) => ({ handle, ref }));
}
