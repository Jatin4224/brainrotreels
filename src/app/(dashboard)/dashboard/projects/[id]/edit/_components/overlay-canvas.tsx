/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: OverlayCanvas, CANVAS_DRAG_IS_NORMALIZED,
 *   DRAG_IS_A_PREVIEW_THEN_AN_OP, ONLY_THE_SELECTED_OVERLAY,
 *   HANDLE_IS_A_CORNER
 *
 * WHAT:  A transparent layer over the player that lets the selected overlay be
 *        dragged and resized where it will actually appear.
 *
 * WHY:   CANVAS_DRAG_IS_NORMALIZED. The box is stored in 0–1 units of the
 *        canvas (NORMALIZED_BOX), so the gesture is measured as a FRACTION of
 *        this element's size rather than in pixels. That is what makes the drag
 *        correct at any preview scale and what keeps an overlay in place when
 *        the project's aspect ratio changes — a pixel delta would be wrong the
 *        moment the preview is a different size from the canvas, which it
 *        always is.
 *
 *        DRAG_IS_A_PREVIEW_THEN_AN_OP, the same contract the tracks panel
 *        follows: the layer moves a local box while the pointer is down and
 *        emits ONE `setItemProps` when it comes up. The player keeps rendering
 *        the document's own box underneath, so what is being dragged is an
 *        outline rather than the overlay itself — which is honest about the
 *        fact that nothing has changed yet.
 *
 *        ONLY_THE_SELECTED_OVERLAY gets handles. Drawing them for every
 *        overlay would cover the picture in chrome and make the preview
 *        unwatchable, and the thing somebody is adjusting is the thing they
 *        just clicked.
 *
 *        HANDLE_IS_A_CORNER — one resize handle, bottom-right, rather than
 *        eight. The box is adjusted numerically in the inspector for anything
 *        precise; this exists for "a bit bigger, a bit left", and eight
 *        handles on a 300px-wide preview would each be smaller than a pointer.
 *
 * WHERE: Laid over the Player in timeline-editor.tsx.
 */

import * as React from "react";

import type { NormalizedBox, Op, TrackItem } from "@/lib/timeline";
import { cn } from "@/lib/utils";

/* Below this the box is too small to grab again, so the resize stops rather
 * than letting somebody drop an overlay they cannot pick back up. */
const MIN_FRACTION = 0.05;

/**
 * SOURCE OF TRUTH KEYWORDS: AUTO_HEIGHT_IS_DRAWN_NOT_WRITTEN
 *
 * What the outline uses for its height when the box has none.
 *
 * `h` is OPTIONAL on a normalized box, and absent means the renderer sizes the
 * overlay to its own content — a text badge is the usual case. There is no
 * number to draw an outline with, so this one is used for DISPLAY, and it is
 * only written to the document when somebody actually drags the corner: at
 * that point they have asked for an explicit height, which is a different
 * thing from us guessing one on their behalf.
 */
const AUTO_HEIGHT_FRACTION = 0.12;

/* The box's height, or the display fallback. */
function heightOf(box: NormalizedBox): number {
  return box.h ?? AUTO_HEIGHT_FRACTION;
}

interface CanvasDrag {
  mode: "move" | "resize";
  originX: number;
  originY: number;
  box: NormalizedBox;
}

export interface OverlayCanvasProps {
  /** The selected item, when it is an overlay with a box. */
  item: TrackItem | null;
  disabled: boolean;
  edit: (ops: readonly Op[]) => void;
}

export function OverlayCanvas({ item, disabled, edit }: OverlayCanvasProps) {
  const surface = React.useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = React.useState<CanvasDrag | null>(null);
  /* What the outline shows while the pointer is down. Separate from `drag` so
   * the gesture's ORIGIN stays fixed while its result moves — deriving one
   * from the other would make every mouse move measure from the last one and
   * accumulate rounding. */
  const [preview, setPreview] = React.useState<NormalizedBox | null>(null);

  const box =
    item !== null && "box" in item && item.box !== undefined ? item.box : null;

  /* The gesture is tracked on the window so a drag that leaves the preview
   * keeps working, exactly as in the tracks panel. */
  React.useEffect(() => {
    if (drag === null || box === null || item === null) return;

    const bounds = surface.current?.getBoundingClientRect() ?? null;
    if (bounds === null || bounds.width === 0 || bounds.height === 0) return;

    const boxFrom = (event: PointerEvent): NormalizedBox => {
      const dx = (event.clientX - drag.originX) / bounds.width;
      const dy = (event.clientY - drag.originY) / bounds.height;

      if (drag.mode === "move") {
        return {
          ...drag.box,
          /* Clamped so an overlay cannot be dragged off the canvas — the box
             must stay inside 0..1 or validate() refuses it (OUT_OF_BOUNDS). */
          x: clamp(drag.box.x + dx, 0, 1 - drag.box.w),
          y: clamp(drag.box.y + dy, 0, 1 - heightOf(drag.box)),
        };
      }
      return {
        ...drag.box,
        w: clamp(drag.box.w + dx, MIN_FRACTION, 1 - drag.box.x),
        h: clamp(heightOf(drag.box) + dy, MIN_FRACTION, 1 - drag.box.y),
      };
    };

    const onMove = (event: PointerEvent) => {
      setPreview(boxFrom(event));
    };
    const onUp = (event: PointerEvent) => {
      const next = boxFrom(event);
      setDrag(null);
      setPreview(null);
      if (sameBox(next, drag.box)) return;
      edit([{ type: "setItemProps", itemId: item.id, props: { box: next } }]);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, item?.id, edit]);

  const shown = preview ?? box;

  if (item === null || shown === null) return null;

  const begin = (mode: CanvasDrag["mode"]) => (event: React.PointerEvent) => {
    if (disabled || box === null) return;
    event.stopPropagation();
    setDrag({
      mode,
      originX: event.clientX,
      originY: event.clientY,
      box,
    });
  };

  return (
    <div
      ref={surface}
      /* Pointer-events only on the outline itself: the player's own controls
         have to stay clickable underneath. */
      className="pointer-events-none absolute inset-0"
      aria-hidden
    >
      <div
        className={cn(
          "pointer-events-auto absolute border-2 border-dashed border-primary bg-primary/10",
          disabled ? "cursor-default" : "cursor-move",
        )}
        onPointerDown={begin("move")}
        style={{
          left: `${shown.x * 100}%`,
          top: `${shown.y * 100}%`,
          width: `${shown.w * 100}%`,
          height: `${heightOf(shown) * 100}%`,
        }}
      >
        {disabled ? null : (
          <span
            onPointerDown={begin("resize")}
            className="absolute -bottom-1.5 -right-1.5 size-3 cursor-se-resize rounded-sm bg-primary"
          />
        )}
      </div>
    </div>
  );
}

function clamp(value: number, low: number, high: number): number {
  /* `high` can fall below `low` for a box already wider than the canvas, and
   * Math.min/max in this order keeps the result inside 0..1 either way. */
  return Math.max(low, Math.min(Math.max(low, high), value));
}

function sameBox(left: NormalizedBox, right: NormalizedBox): boolean {
  return (
    Math.abs(left.x - right.x) < 0.001 &&
    Math.abs(left.y - right.y) < 0.001 &&
    Math.abs(left.w - right.w) < 0.001 &&
    Math.abs(heightOf(left) - heightOf(right)) < 0.001
  );
}
