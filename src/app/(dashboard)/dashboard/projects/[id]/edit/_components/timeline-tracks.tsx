/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: TimelineTracks, TrackLane, ClipBlock, TimelineRuler,
 *   PIXELS_PER_SECOND, DRAG_IS_A_PREVIEW_THEN_AN_OP, SNAP_TO_BOUNDARIES,
 *   EDGE_IS_A_TRIM_BODY_IS_A_MOVE, CAPTIONS_ARE_NOT_DRAGGABLE,
 *   KEYBOARD_REACHABLE_CLIPS
 *
 * WHAT:  The five lanes along the bottom of the editor: the ruler, the
 *        playhead, and every clip as a draggable, trimmable, selectable block.
 *
 * WHY:   DRAG_IS_A_PREVIEW_THEN_AN_OP. A drag moves a CSS offset and nothing
 *        else; the document is untouched until the pointer comes up, when one
 *        op is emitted for the whole gesture. Two things fall out of that and
 *        both matter: the undo stack gets one entry per gesture rather than one
 *        per mouse move (ONE_GESTURE_ONE_UNDO in the session), and the
 *        autosave posts one op rather than two hundred.
 *
 *        EDGE_IS_A_TRIM_BODY_IS_A_MOVE, which is what every editor does and
 *        what the ops already distinguish: dragging an edge changes the length
 *        without moving the other edge (`trim`), dragging the body changes the
 *        start and keeps the length (`move`). Conflating them is named in
 *        ops.ts as the most common way a hand-rolled timeline gets edits
 *        wrong, so the two gestures are different handles here rather than one
 *        handle with a modifier.
 *
 *        SNAP_TO_BOUNDARIES: a drag lands on a nearby clip edge or the
 *        playhead when it is within a few pixels, because frame-accurate
 *        butt-joins are the common intent and nobody can hit them by hand. The
 *        threshold is in PIXELS, not seconds — it has to feel the same at every
 *        zoom level.
 *
 *        CAPTIONS_ARE_NOT_DRAGGABLE, enforced by the ops and reflected here
 *        rather than contradicted: a caption's timing comes from the words it
 *        covers (CAPTIONS_FOLLOW_WORDS), so its block selects and opens the
 *        text editor instead of offering handles that would be refused.
 *
 *        KEYBOARD_REACHABLE_CLIPS — every block is a real `<button>` with an
 *        accessible name and `aria-pressed`, so the timeline is navigable by
 *        tab and the editor's shortcuts (split, delete) work on whatever is
 *        selected. A div with an onClick would make the whole screen
 *        mouse-only.
 *
 * WHERE: Rendered by timeline-editor.tsx, driven by use-timeline-editor's
 *        `edit`.
 */

import * as React from "react";

import {
  TIME_EPSILON,
  isSeconds,
  itemSpan,
  roundSeconds,
  type Op,
  type TimelineDoc,
  type Track,
  type TrackItem,
} from "@/lib/timeline";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * SOURCE OF TRUTH KEYWORDS: PIXELS_PER_SECOND, ZOOM_LEVELS, SNAP_PIXELS
 *
 * WHAT:  The zoom scale, and how close a drag has to land to snap.
 * WHY:   A fixed set rather than a continuous slider: the useful question is
 *        "whole video" versus "this sentence", and three answers cover it
 *        without a control nobody can aim. 12px/s fits roughly three minutes
 *        on a laptop, which is the length this product makes.
 *        SNAP_PIXELS is in screen pixels so the gesture feels identical at
 *        every zoom — eight is about the width of a fingertip's worth of mouse
 *        wobble and well short of the gap between two deliberate positions.
 * WHERE: The zoom buttons; secondsFromDelta and snap below.
 */
const ZOOM_LEVELS = [12, 40, 120] as const;

const SNAP_PIXELS = 8;

const LANE_HEIGHT_PX = 44;

/* The lanes in the order the phase names them, which is also bottom-up render
 * order for the two that composite (video under everything, overlays above). */
const LANE_ORDER: readonly Track["type"][] = [
  "scene",
  "video",
  "overlay",
  "caption",
  "audio",
];

const LANE_TONE: Readonly<Record<Track["type"], string>> = {
  video: "bg-primary/20 border-primary/40",
  scene: "bg-chart-2/20 border-chart-2/40",
  audio: "bg-chart-4/20 border-chart-4/40",
  caption: "bg-muted border-border",
  overlay: "bg-chart-5/20 border-chart-5/40",
};

export interface TimelineTracksProps {
  doc: TimelineDoc;
  length: number;
  playhead: number;
  selectedItemId: string | null;
  ripple: boolean;
  onSeek: (seconds: number) => void;
  onSelect: (itemId: string | null) => void;
  edit: (ops: readonly Op[]) => void;
}

/**
 * SOURCE OF TRUTH KEYWORDS: DragState, DRAG_IS_A_PREVIEW_THEN_AN_OP
 *
 * WHAT:  The gesture in progress: what is being dragged, from where, and by
 *        how far so far.
 * WHY:   Held in one state object rather than three, so a render can never see
 *        a half-updated gesture — and so releasing the pointer has everything
 *        it needs to build the op without reading the DOM back.
 * WHERE: TimelineTracks' pointer handlers.
 */
interface DragState {
  itemId: string;
  mode: "move" | "trim-start" | "trim-end";
  originX: number;
  deltaX: number;
  start: number;
  end: number;
}

export function TimelineTracks({
  doc,
  length,
  playhead,
  selectedItemId,
  ripple,
  onSeek,
  onSelect,
  edit,
}: TimelineTracksProps) {
  const [zoomIndex, setZoomIndex] = React.useState(0);
  const [drag, setDrag] = React.useState<DragState | null>(null);

  const pps = ZOOM_LEVELS[zoomIndex] ?? ZOOM_LEVELS[0];
  const width = Math.max(length * pps, 240);

  /* Every edge in the document, which is what a drag snaps to. Recomputed per
   * document rather than per pointer move — a drag reads it dozens of times a
   * second and it cannot change mid-gesture. */
  const snapPoints = React.useMemo(() => {
    const points = new Set<number>([0]);
    for (const track of doc.tracks) {
      for (const item of track.items) {
        const span = itemSpan(item, doc.words);
        if (span === null) continue;
        points.add(roundSeconds(span.start));
        points.add(roundSeconds(span.end));
      }
    }
    return [...points];
  }, [doc]);

  /**
   * SOURCE OF TRUTH KEYWORDS: snap, SNAP_TO_BOUNDARIES
   *
   * The nearest edge within the pixel tolerance, or the position as dragged.
   * `ignore` is the dragged item's OWN edges: they are in the snap set like
   * everything else, and leaving them in would pull every small drag back to
   * where it started and make the clip feel stuck.
   */
  const snap = React.useCallback(
    (seconds: number, ignore: readonly number[]): number => {
      let best = seconds;
      let bestGap = SNAP_PIXELS / pps;

      for (const candidate of [...snapPoints, roundSeconds(playhead)]) {
        if (ignore.some((edge) => Math.abs(edge - candidate) < TIME_EPSILON))
          continue;
        const gap = Math.abs(candidate - seconds);
        if (gap < bestGap) {
          best = candidate;
          bestGap = gap;
        }
      }
      return roundSeconds(Math.max(0, best));
    },
    [pps, snapPoints, playhead],
  );

  /**
   * SOURCE OF TRUTH KEYWORDS: endDrag, DRAG_IS_A_PREVIEW_THEN_AN_OP,
   *   EDGE_IS_A_TRIM_BODY_IS_A_MOVE
   *
   * Turns the finished gesture into exactly one op. A gesture that moved less
   * than a frame's worth emits nothing, so a click that wobbled is a
   * selection rather than a no-op edit cluttering the undo stack.
   */
  const endDrag = React.useCallback(
    (gesture: DragState) => {
      const deltaSeconds = gesture.deltaX / pps;
      if (Math.abs(deltaSeconds) < TIME_EPSILON) return;

      if (gesture.mode === "move") {
        const start = snap(gesture.start + deltaSeconds, [
          gesture.start,
          gesture.end,
        ]);
        if (Math.abs(start - gesture.start) < TIME_EPSILON) return;
        edit([{ type: "move", itemId: gesture.itemId, start, ripple }]);
        return;
      }

      if (gesture.mode === "trim-start") {
        const start = snap(gesture.start + deltaSeconds, [gesture.start]);
        /* Guarded here as well as in the op: the op's refusal is a toast, and
         * a drag that cannot succeed should simply not emit. */
        if (start >= gesture.end - TIME_EPSILON) return;
        edit([{ type: "trim", itemId: gesture.itemId, start, ripple }]);
        return;
      }

      const end = snap(gesture.end + deltaSeconds, [gesture.end]);
      if (end <= gesture.start + TIME_EPSILON) return;
      edit([
        {
          type: "trim",
          itemId: gesture.itemId,
          duration: roundSeconds(end - gesture.start),
          ripple,
        },
      ]);
    },
    [edit, pps, ripple, snap],
  );

  /* Pointer capture on the window, so a fast drag that leaves the lane keeps
   * tracking instead of sticking where the pointer left. */
  React.useEffect(() => {
    if (drag === null) return;

    const onMove = (event: PointerEvent) => {
      setDrag((current) =>
        current === null
          ? current
          : { ...current, deltaX: event.clientX - current.originX },
      );
    };
    const onUp = (event: PointerEvent) => {
      setDrag((current) => {
        if (current !== null)
          endDrag({ ...current, deltaX: event.clientX - current.originX });
        return null;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, endDrag]);

  const lanes = React.useMemo(
    () =>
      [...doc.tracks].sort(
        (left, right) =>
          LANE_ORDER.indexOf(left.type) - LANE_ORDER.indexOf(right.type),
      ),
    [doc.tracks],
  );

  const seekFromEvent = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    onSeek(
      roundSeconds(
        Math.min(length, Math.max(0, (event.clientX - bounds.left) / pps)),
      ),
    );
  };

  return (
    <section className="flex flex-col gap-2" aria-label="Timeline tracks">
      <header className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {length.toFixed(1)}s · {doc.canvas.fps}fps · playhead{" "}
          {playhead.toFixed(2)}s
        </p>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Zoom</span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom out"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
          >
            −
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom in"
            disabled={zoomIndex === ZOOM_LEVELS.length - 1}
            onClick={() =>
              setZoomIndex((index) =>
                Math.min(ZOOM_LEVELS.length - 1, index + 1),
              )
            }
          >
            +
          </Button>
        </div>
      </header>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <div style={{ width, minWidth: "100%" }} className="relative">
          <TimelineRuler
            length={length}
            pps={pps}
            onSeek={seekFromEvent}
          />

          {lanes.map((track) => (
            <TrackLane
              key={track.id}
              track={track}
              words={doc.words}
              pps={pps}
              drag={drag}
              selectedItemId={selectedItemId}
              onSelect={onSelect}
              onDragStart={setDrag}
            />
          ))}

          {/* The playhead spans every lane, which is the whole reason it is a
              sibling of them rather than a child of one. */}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-primary"
            style={{ left: playhead * pps }}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: TimelineRuler, SECOND_TICKS
 *
 * WHAT:  The second-by-second scale, clickable to move the playhead.
 * WHY:   The tick interval follows the zoom so the labels never collide: at the
 *        widest zoom every fifth second is labelled, at the closest every one.
 *        A fixed interval produces either an unreadable smear or three ticks on
 *        a three-minute project.
 * WHERE: The top row of the tracks panel.
 */
function TimelineRuler({
  length,
  pps,
  onSeek,
}: {
  length: number;
  pps: number;
  onSeek: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const step = pps >= 100 ? 1 : pps >= 36 ? 2 : 5;
  const ticks = React.useMemo(() => {
    const out: number[] = [];
    for (let second = 0; second <= Math.ceil(length); second += step)
      out.push(second);
    return out;
  }, [length, step]);

  return (
    <div
      role="presentation"
      onClick={onSeek}
      className="relative h-7 cursor-pointer border-b border-border bg-muted/40"
    >
      {ticks.map((second) => (
        <span
          key={second}
          className="absolute top-0 flex h-full items-center border-l border-border pl-1 text-[10px] text-muted-foreground"
          style={{ left: second * pps }}
        >
          {second}s
        </span>
      ))}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: TrackLane, UNRESOLVED_ITEM_IS_SHOWN_NOT_HIDDEN
 *
 * WHAT:  One lane: its label, and its items as positioned blocks.
 * WHY:   UNRESOLVED_ITEM_IS_SHOWN_NOT_HIDDEN. An item whose span cannot be
 *        resolved — an anchor pointing at a word the document lost — is drawn
 *        as a flagged block rather than skipped. A missing clip is the hardest
 *        bug for a customer to report, because the thing they would describe
 *        is not on screen.
 * WHERE: TimelineTracks.
 */
function TrackLane({
  track,
  words,
  pps,
  drag,
  selectedItemId,
  onSelect,
  onDragStart,
}: {
  track: Track;
  words: TimelineDoc["words"];
  pps: number;
  drag: DragState | null;
  selectedItemId: string | null;
  onSelect: (itemId: string | null) => void;
  onDragStart: (drag: DragState) => void;
}) {
  return (
    <div
      className="relative border-b border-border last:border-b-0"
      style={{ height: LANE_HEIGHT_PX }}
    >
      <span className="pointer-events-none absolute left-1 top-1 z-10 rounded bg-background/80 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {track.label}
      </span>

      {track.items.map((item) => {
        const span = itemSpan(item, words);
        if (span === null)
          return (
            <UnresolvedBlock
              key={item.id}
              item={item}
              selected={selectedItemId === item.id}
              onSelect={onSelect}
            />
          );

        return (
          <ClipBlock
            key={item.id}
            track={track}
            item={item}
            start={span.start}
            end={span.end}
            pps={pps}
            drag={drag}
            selected={selectedItemId === item.id}
            onSelect={onSelect}
            onDragStart={onDragStart}
          />
        );
      })}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: ClipBlock, EDGE_IS_A_TRIM_BODY_IS_A_MOVE,
 *   CAPTIONS_ARE_NOT_DRAGGABLE, KEYBOARD_REACHABLE_CLIPS
 *
 * WHAT:  One clip: selectable, draggable by the body, trimmable by either edge.
 * WHY:   The handles are absent on a caption and on an item whose times are
 *        anchors, because the ops refuse both — an affordance that produces a
 *        refusal is worse than no affordance. See CAPTIONS_FOLLOW_WORDS in
 *        ops.ts.
 *
 *        The drag preview is a CSS transform on this element only; the
 *        document does not move until the pointer is released.
 * WHERE: TrackLane.
 */
function ClipBlock({
  track,
  item,
  start,
  end,
  pps,
  drag,
  selected,
  onSelect,
  onDragStart,
}: {
  track: Track;
  item: TrackItem;
  start: number;
  end: number;
  pps: number;
  drag: DragState | null;
  selected: boolean;
  onSelect: (itemId: string | null) => void;
  onDragStart: (drag: DragState) => void;
}) {
  const dragging = drag?.itemId === item.id ? drag : null;
  const timed =
    track.type !== "caption" &&
    item.start !== undefined &&
    item.duration !== undefined &&
    isSeconds(item.start) &&
    isSeconds(item.duration);

  /* The live preview. A move slides the block; a trim moves one edge and
   * resizes, which is why width and left are computed per mode rather than
   * through a single transform. */
  const offset = dragging === null ? 0 : dragging.deltaX;
  const left = start * pps + (dragging?.mode === "trim-end" ? 0 : offset);
  const width = Math.max(
    6,
    (end - start) * pps +
      (dragging === null
        ? 0
        : dragging.mode === "trim-end"
          ? offset
          : dragging.mode === "trim-start"
            ? -offset
            : 0),
  );

  const begin = (mode: DragState["mode"]) => (event: React.PointerEvent) => {
    if (!timed) return;
    event.stopPropagation();
    onSelect(item.id);
    onDragStart({
      itemId: item.id,
      mode,
      originX: event.clientX,
      deltaX: 0,
      start,
      end,
    });
  };

  return (
    <div
      className="absolute top-6"
      style={{ left, width, height: LANE_HEIGHT_PX - 28 }}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(item.id)}
        onPointerDown={begin("move")}
        className={cn(
          "h-full w-full overflow-hidden rounded border px-1 text-left text-[10px] leading-tight",
          LANE_TONE[track.type],
          timed ? "cursor-grab" : "cursor-pointer",
          selected && "ring-2 ring-ring",
        )}
      >
        <span className="block truncate text-foreground">
          {clipLabel(item, track)}
        </span>
      </button>

      {timed ? (
        <>
          <span
            role="presentation"
            onPointerDown={begin("trim-start")}
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l bg-foreground/30 hover:bg-foreground/60"
          />
          <span
            role="presentation"
            onPointerDown={begin("trim-end")}
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r bg-foreground/30 hover:bg-foreground/60"
          />
        </>
      ) : null}
    </div>
  );
}

function UnresolvedBlock({
  item,
  selected,
  onSelect,
}: {
  item: TrackItem;
  selected: boolean;
  onSelect: (itemId: string | null) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
      style={{ height: LANE_HEIGHT_PX - 28 }}
      className={cn(
        "absolute left-1 top-6 rounded border border-destructive bg-destructive/15 px-1 text-[10px] text-foreground",
        selected && "ring-2 ring-ring",
      )}
    >
      {item.label ?? item.id} · no timing
    </button>
  );
}

/* What a block says. The item's own label when it has one, because that is
 * what a person named it; otherwise something derived that is more use than a
 * cuid — the first words of a caption, the render kind of a scene. */
function clipLabel(item: TrackItem, track: Track): string {
  if (item.label !== undefined && item.label.length > 0) return item.label;
  if (track.type === "caption") return "Caption";
  if ("render" in item && typeof item.render === "string") return item.render;
  return item.id;
}
