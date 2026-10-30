/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: layoutScene, safeRectFor, slotRects, runBoxes,
 *   LAYOUT_ENGINE_OWNS_THE_GEOMETRY, SAFE_ZONE_IS_SHARED, SPLIT_ALONG_THE_LONG_AXIS,
 *   PRIMITIVE_WEIGHTS, SLOT_ORDER_IS_THE_LAYOUT
 *
 * WHAT:  The layout engine. Turns a scene — a named layout and up to six
 *        elements with no coordinates anywhere — into real rectangles in
 *        canvas pixels, with every text run measured and fitted.
 *
 * WHY:   LAYOUT_ENGINE_OWNS_THE_GEOMETRY. This file is the other half of
 *        THE_MODEL_NEVER_EMITS_COORDINATES: because nothing upstream may
 *        produce a position, every position in a motion video is produced
 *        here, by code, under test. That is what makes "no rendered beat has
 *        overlapping or cut-off content" a property of the system rather than
 *        a hope about the model — the only geometry a model can get wrong is
 *        the geometry it is allowed to write, and it is allowed to write none.
 *
 *        SAFE_ZONE_IS_SHARED. The safe rectangle comes from `captionBox` in
 *        src/lib/captions/safe-zone.ts — the function Phase 08 already wrote —
 *        rather than from a second reading of SAFE_ZONE_INSETS. The phase file
 *        asks for this explicitly and the reason is concrete: two
 *        implementations of "where TikTok's button rail is" means a caption and
 *        a motion element that disagree about the bottom of the frame in the
 *        same video, and the one that is wrong is whichever was edited second.
 *        Calling it with a zero-height block is how you ask that function for
 *        the zone itself rather than for a band inside it.
 *
 *        SPLIT_ALONG_THE_LONG_AXIS is the one layout decision that is not
 *        obvious and is the difference between usable and not. `split-2` as
 *        two COLUMNS is correct on 16:9 and unusable on 9:16, where two
 *        columns of a 1080-wide frame are 500px each and a three-word label
 *        wraps four times. So every multi-slot layout divides the LONGER side
 *        of the safe rectangle: two columns on landscape, two rows on
 *        portrait. The same scene then reads correctly at both aspects, which
 *        is required — a project's canvas is chosen per video and the designer
 *        is not re-run per aspect.
 *
 *        PRIMITIVE_WEIGHTS decides how a stack divides its height. Equal
 *        bands were the alternative and they are wrong in both directions: an
 *        icon given a third of the frame is a logo, and a five-bar chart given
 *        a third is unreadable.
 *
 * WHERE: src/lib/scene/check.ts runs the checks over what this returns; the
 *        MotionScene components in src/remotion/ draw it; the gallery page
 *        renders it for review.
 */

import { captionBox } from "@/lib/captions/safe-zone";
import {
  LAYOUT_SLOTS,
  type LayoutContext,
  type PlacedElement,
  type PlacedRect,
  type PlacedScene,
  type Scene,
  type ScenePrimitive,
  type StrictSceneElement,
} from "@/lib/types/scene";

import { layoutGraph } from "./flow";
import { fitTextRun } from "./measure";
import { elementTextRuns } from "./runs";

/* The gutter between slots, as a fraction of frame height — so it is the same
 * visual gap at every resolution, and the same gap horizontally and
 * vertically (a gutter keyed to width would be tighter on portrait, where
 * things are already tight). */
const GAP_VH = 0.022;

/**
 * SOURCE OF TRUTH KEYWORDS: PRIMITIVE_WEIGHTS
 *
 * How much vertical room each primitive is worth when a stack divides its
 * height. These are relative, not absolute: only the ratios matter.
 */
const PRIMITIVE_WEIGHTS: Readonly<Record<ScenePrimitive, number>> = {
  title: 3,
  kineticText: 3,
  counter: 3,
  meter: 2,
  barChart: 4,
  compare: 3,
  list: 3,
  flowGraph: 4,
  icon: 1,
  callout: 2,
};

/**
 * SOURCE OF TRUTH KEYWORDS: safeRectFor, SAFE_ZONE_IS_SHARED
 *
 * WHAT:  The rectangle every slot is placed inside.
 * WHY:   See SAFE_ZONE_IS_SHARED in the file header. `band: "middle"` and a
 *        zero block are the arguments that make `captionBox` return the zone
 *        rather than a position within it — the band is irrelevant when
 *        nothing is being clamped.
 * WHERE: layoutScene; the gallery draws it as a guide.
 */
export function safeRectFor(ctx: LayoutContext): PlacedRect {
  const box = captionBox({
    canvas: ctx.canvas,
    safeZone: ctx.safeZone,
    band: "middle",
    blockHeight: 0,
  });
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

/* A band of `fraction` of `rect`'s height, taken from the top, with the rest
 * returned as the remainder minus one gutter. */
function splitVertical(
  rect: PlacedRect,
  fraction: number,
  gap: number,
): [PlacedRect, PlacedRect] {
  const topHeight = rect.height * fraction - gap / 2;
  return [
    { x: rect.x, y: rect.y, width: rect.width, height: topHeight },
    {
      x: rect.x,
      y: rect.y + topHeight + gap,
      width: rect.width,
      height: rect.height - topHeight - gap,
    },
  ];
}

/* `count` equal cells along `rect`'s longer side — see
 * SPLIT_ALONG_THE_LONG_AXIS. */
function divideLongAxis(
  rect: PlacedRect,
  count: number,
  gap: number,
): PlacedRect[] {
  const cells: PlacedRect[] = [];
  const horizontal = rect.width >= rect.height;
  const total = horizontal ? rect.width : rect.height;
  const size = (total - gap * (count - 1)) / count;

  for (let i = 0; i < count; i += 1) {
    const offset = i * (size + gap);
    cells.push(
      horizontal
        ? { x: rect.x + offset, y: rect.y, width: size, height: rect.height }
        : { x: rect.x, y: rect.y + offset, width: rect.width, height: size },
    );
  }
  return cells;
}

/* Vertical bands sized by PRIMITIVE_WEIGHTS, filling the whole rectangle. */
function weightedStack(
  rect: PlacedRect,
  elements: readonly StrictSceneElement[],
  gap: number,
): PlacedRect[] {
  const weights = elements.map((element) => PRIMITIVE_WEIGHTS[element.kind]);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const available = rect.height - gap * (elements.length - 1);

  const bands: PlacedRect[] = [];
  let y = rect.y;
  for (const weight of weights) {
    const height = (available * weight) / totalWeight;
    bands.push({ x: rect.x, y, width: rect.width, height });
    y += height + gap;
  }
  return bands;
}

/**
 * SOURCE OF TRUTH KEYWORDS: slotRects, SLOT_ORDER_IS_THE_LAYOUT
 *
 * WHAT:  One rectangle per element, in element order.
 *
 * WHY:   Slot i belongs to element i, with one documented exception:
 *        `flow-graph` places the GRAPH in the large lower region and the other
 *        element — a title or a callout — in a band above it, whichever order
 *        the array happens to be in. A heading under its own diagram is not a
 *        layout this engine offers, so honouring array order there would mean
 *        producing a picture nobody designed in order to honour a rule that
 *        exists to prevent exactly that.
 *
 *        The exhaustive switch means a sixth layout cannot be added to
 *        SCENE_LAYOUTS without a geometry for it: the `never` arm is a compile
 *        error until it has one. A layout that parsed but had no rects would
 *        place every element at the origin.
 * WHERE: layoutScene.
 */
function slotRects(
  layout: Scene["layout"],
  elements: readonly StrictSceneElement[],
  safeRect: PlacedRect,
  gap: number,
): PlacedRect[] {
  switch (layout) {
    case "stack-center":
      return weightedStack(safeRect, elements, gap);

    case "split-2":
      return divideLongAxis(safeRect, 2, gap);

    case "grid-3":
      return divideLongAxis(safeRect, 3, gap);

    case "hero-plus-caption": {
      /* 62/38. The hero has to read as the subject and the caption as a line
       * under it; at 50/50 neither does. */
      const [hero, caption] = splitVertical(safeRect, 0.62, gap);
      return [hero, caption];
    }

    case "flow-graph": {
      if (elements.length === 1) return [safeRect];
      const [heading, graph] = splitVertical(safeRect, 0.22, gap);
      const graphIndex = elements.findIndex(
        (element) => element.kind === "flowGraph",
      );
      /* No graph at all is a LAYOUT_REQUIRES_PRIMITIVE error from checkScene;
       * geometry still has to return something placeable so the beat can be
       * drawn and the error reported beside it rather than instead of it. */
      return elements.map((_, index) =>
        index === graphIndex ? graph : heading,
      );
    }

    default: {
      const exhaustive: never = layout;
      throw new Error(`[scene/layouts] Unknown layout ${String(exhaustive)}`);
    }
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: runBoxes, MEASURE_WHAT_IS_DRAWN
 *
 * WHAT:  Where inside its slot each of an element's text runs goes.
 *
 * WHY:   A slot is not a box of text: a bar chart is rows of label-and-figure,
 *        a compare is two columns, a meter is a label over a track over a
 *        percentage. Measuring every run against the WHOLE slot would pass a
 *        five-bar chart whose labels each individually fit the slot and
 *        together overlap each other — which is the clutter failure this phase
 *        is about, passed by a check that looked rigorous.
 *
 *        The fractions are the same ones the components draw with, and that is
 *        load-bearing rather than tidy: this file decides a bar label gets 55%
 *        of the row, so the component must draw it in 55% of the row or the
 *        measurement describes a picture that does not exist.
 * WHERE: layoutScene, per element.
 */
function runBoxes(
  element: StrictSceneElement,
  slot: PlacedRect,
  gap: number,
): Map<string, PlacedRect> {
  const boxes = new Map<string, PlacedRect>();
  const rows = (count: number): PlacedRect[] => {
    const height = (slot.height - gap * (count - 1)) / count;
    return Array.from({ length: count }, (_, i) => ({
      x: slot.x,
      y: slot.y + i * (height + gap),
      width: slot.width,
      height,
    }));
  };

  switch (element.kind) {
    case "title": {
      if (element.subhead === undefined) {
        boxes.set("text", slot);
      } else {
        const [head, sub] = splitVertical(slot, 0.66, gap);
        boxes.set("text", head);
        boxes.set("subhead", sub);
      }
      break;
    }

    case "kineticText":
      boxes.set("text", slot);
      break;

    case "counter": {
      if (element.label === undefined) {
        boxes.set("to", slot);
      } else {
        const [figure, label] = splitVertical(slot, 0.68, gap);
        boxes.set("to", figure);
        boxes.set("label", label);
      }
      break;
    }

    case "meter": {
      /* The track itself is 22% of the slot and carries no text, so it is
       * reserved rather than measured — the rows above and below are what has
       * to fit. */
      const labelled = element.label !== undefined;
      const [top, rest] = splitVertical(slot, labelled ? 0.26 : 0.001, gap);
      if (labelled) boxes.set("label", top);
      if (element.showPercent) {
        const [, figure] = splitVertical(rest, 0.3, gap);
        boxes.set("value", figure);
      }
      break;
    }

    case "barChart": {
      const bars = rows(element.bars.length);
      element.bars.forEach((_, index) => {
        const row = bars[index];
        if (row === undefined) return;
        boxes.set(`bars.${index}.label`, {
          x: row.x,
          y: row.y,
          width: row.width * 0.55,
          height: row.height,
        });
        /* The figure sits at the right end of the row; the 20% between them is
         * the bar track. */
        boxes.set(`bars.${index}.value`, {
          x: row.x + row.width * 0.78,
          y: row.y,
          width: row.width * 0.22,
          height: row.height,
        });
      });
      break;
    }

    case "compare": {
      const [left, right] = divideLongAxis(slot, 2, gap);
      for (const [side, rect] of [
        ["left", left],
        ["right", right],
      ] as const) {
        if (rect === undefined) continue;
        const [label, value] = splitVertical(rect, 0.38, gap);
        boxes.set(`${side}.label`, label);
        boxes.set(`${side}.value`, value);
      }
      break;
    }

    case "list": {
      const items = rows(element.items.length);
      element.items.forEach((_, index) => {
        const row = items[index];
        if (row !== undefined) boxes.set(`items.${index}`, row);
      });
      break;
    }

    case "icon": {
      if (element.label !== undefined) {
        const [, label] = splitVertical(slot, 0.62, gap);
        boxes.set("label", label);
      }
      break;
    }

    case "callout":
      boxes.set("text", slot);
      break;

    case "flowGraph":
      /* Node label boxes are the node rectangles Dagre produced, so they are
       * filled in by layoutScene after the graph is laid out — there is no
       * fraction of the slot to state here. */
      break;

    default: {
      const exhaustive: never = element;
      throw new Error(
        `[scene/layouts] Unknown primitive ${JSON.stringify(exhaustive)}`,
      );
    }
  }

  return boxes;
}

/**
 * SOURCE OF TRUTH KEYWORDS: layoutScene, LAYOUT_ENGINE_OWNS_THE_GEOMETRY
 *
 * WHAT:  The whole scene, placed and measured.
 * WHY:   Pure, total and synchronous. It never throws for a scene that parsed
 *        and it reports no errors — `checkScene` reads the result and decides
 *        what is wrong with it. Separating them is what lets the editor draw a
 *        beat that is failing its checks, with the problems listed beside it,
 *        instead of showing an empty frame when something is off.
 * WHERE: check.ts; the MotionScene components; the gallery.
 */
export function layoutScene(scene: Scene, ctx: LayoutContext): PlacedScene {
  const safeRect = safeRectFor(ctx);
  const gap = GAP_VH * ctx.canvas.height;
  const slots = slotRects(scene.layout, scene.elements, safeRect, gap);

  const elements: PlacedElement[] = scene.elements.map((element, index) => {
    const slot = slots[index] ?? safeRect;

    if (element.kind === "flowGraph") {
      const graph = layoutGraph({
        nodes: element.nodes,
        edges: element.edges,
        direction: element.direction,
        box: slot,
        canvasHeight: ctx.canvas.height,
      });
      /* Each node label is fitted into the rectangle Dagre gave that node, so
       * a graph that had to shrink past readability reports itself through the
       * same TEXT_OVERFLOW path as every other primitive — see
       * SCALE_TO_FIT_THEN_MEASURE in flow.ts. */
      const runs = elementTextRuns(element).map((run, runIndex) => {
        const node = graph.nodes[runIndex];
        return fitTextRun(run, node?.rect ?? slot, ctx.canvas.height);
      });
      return { id: element.id, kind: element.kind, rect: slot, runs, graph };
    }

    const boxes = runBoxes(element, slot, gap);
    const runs = elementTextRuns(element).map((run) =>
      fitTextRun(run, boxes.get(run.path) ?? slot, ctx.canvas.height),
    );
    return { id: element.id, kind: element.kind, rect: slot, runs };
  });

  return { layout: scene.layout, safeRect, elements };
}

/**
 * SOURCE OF TRUTH KEYWORDS: layoutSlotRule
 *
 * The slot rule for a layout, so `checkScene` and the designer prompt read the
 * same table rather than each holding their own idea of how many elements
 * `grid-3` takes.
 */
export function layoutSlotRule(layout: Scene["layout"]) {
  return LAYOUT_SLOTS[layout];
}
