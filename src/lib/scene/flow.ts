/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: layoutGraph, GRAPH_LAYOUT_IS_DAGRE,
 *   DAGRE_IS_SYNCHRONOUS, SCALE_TO_FIT_THEN_MEASURE, GRAPH_IS_LAYERED
 *
 * WHAT:  A flow graph's nodes and edge routes, in canvas pixels, laid out by
 *        Dagre and scaled to fit the slot it was given.
 *
 * WHY:   GRAPH_LAYOUT_IS_DAGRE. This is the one new dependency the phase file
 *        asks to be approved before adding, and it was: `@dagrejs/dagre`,
 *        pinned. A hand-rolled layered placement was the alternative and it is
 *        the same algorithm written worse — rank assignment, crossing
 *        reduction and coordinate assignment are each a paper, and getting
 *        crossing reduction wrong produces exactly the overlapping-garbage
 *        picture this phase exists to prevent.
 *
 *        DAGRE_IS_SYNCHRONOUS, and that is why it was chosen over elkjs. The
 *        geometry has to be computed in three places that cannot await:
 *        inside `checkScene`, which is a pure function the editor calls while
 *        typing; inside a Remotion component's render pass, which is
 *        synchronous by construction; and inside the deterministic checks on
 *        the Inngest worker. A Promise-based layout would have put an async
 *        seam through all three, and the component would have had to render a
 *        frame before it knew where anything goes — which in Remotion means a
 *        frame of the wrong picture, composited into a paid video.
 *
 *        SCALE_TO_FIT_THEN_MEASURE is the order that matters. Dagre is given
 *        node boxes sized from the REAL measured label widths, lays the graph
 *        out at that natural size, and only then is the whole drawing scaled
 *        uniformly into the slot. Laying out inside a pre-scaled box instead
 *        would make node separation and rank separation shrink with the graph
 *        and the nodes would touch. Scaling uniformly also keeps the aspect of
 *        the drawing, so an eight-node chain does not stretch into a smear.
 *        The scaled node rectangles are then handed back for the label text to
 *        be fitted INTO — which is what makes a graph that had to shrink too
 *        far report itself as a text overflow through the same path every
 *        other primitive uses, rather than through a special case.
 *
 *        GRAPH_IS_LAYERED: `direction` is down or right, never a force
 *        layout. A process with a direction is what an explainer beat is
 *        drawing, and a layered graph reads as one; a force-directed blob of
 *        six nodes reads as a molecule.
 *
 * WHERE: src/lib/scene/layouts.ts, for the `flow-graph` layout's graph slot.
 */

import * as dagre from "@dagrejs/dagre";

import {
  SCENE_TEXT_ROLE_SPECS,
  type PlacedGraph,
  type PlacedRect,
} from "@/lib/types/scene";

import { lineHeightPx, measureLineWidth, roleFontPx } from "./measure";

/* Padding inside a node box, and the gaps between nodes and between ranks —
 * all as fractions of the label's font size, so the drawing is proportional at
 * every resolution for the same reason text is (SIZE_IS_A_FRACTION_OF_HEIGHT).
 */
const NODE_PADDING_X = 0.7;
const NODE_PADDING_Y = 0.45;
const NODE_SEPARATION = 0.8;
const RANK_SEPARATION = 1.4;

/**
 * SOURCE OF TRUTH KEYWORDS: layoutGraph, SCALE_TO_FIT_THEN_MEASURE
 *
 * WHAT:  Node rectangles and edge polylines in canvas pixels, centred in
 *        `box`.
 * WHY:   Returns geometry only — no text fitting, no errors. The caller fits
 *        the labels into the rectangles this produced and reports what does
 *        not fit, which keeps every overflow in the app on one code path.
 * WHERE: layouts.ts.
 */
export function layoutGraph(args: {
  nodes: readonly { id: string; label: string }[];
  edges: readonly { from: string; to: string }[];
  direction: "down" | "right";
  box: PlacedRect;
  canvasHeight: number;
}): PlacedGraph {
  const { nodes, edges, direction, box, canvasHeight } = args;

  const spec = SCENE_TEXT_ROLE_SPECS.label;
  const fontPx = roleFontPx(spec.sizeVh, canvasHeight);
  const padX = NODE_PADDING_X * fontPx;
  const padY = NODE_PADDING_Y * fontPx;

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction === "down" ? "TB" : "LR",
    nodesep: NODE_SEPARATION * fontPx,
    ranksep: RANK_SEPARATION * fontPx,
    marginx: 0,
    marginy: 0,
  });
  /* Dagre requires a default edge label; without it `setEdge` with no value
   * stores `undefined` and the layout throws on its own internals. */
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    graph.setNode(node.id, {
      width: measureLineWidth(node.label, spec.weight, fontPx) + 2 * padX,
      height: lineHeightPx(spec.lineHeight, fontPx) + 2 * padY,
    });
  }
  for (const edge of edges) {
    /* Only edges between nodes that exist are laid out. An edge naming an
     * unknown node is a real defect and `checkScene` reports it as
     * GRAPH_EDGE_UNKNOWN_NODE — but Dagre would CREATE the missing node as a
     * zero-sized box and lay the graph out around a point nobody can see, so
     * the picture would be wrong in a way the error message did not describe. */
    if (graph.hasNode(edge.from) && graph.hasNode(edge.to)) {
      graph.setEdge(edge.from, edge.to);
    }
  }

  dagre.layout(graph);

  /* Dagre's own extent, which is not its graph label's width/height: those are
   * only set when a margin is configured, and the real bound is the union of
   * the node boxes and the edge points. */
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const laid = nodes.map((node) => {
    const placed = graph.node(node.id);
    const left = placed.x - placed.width / 2;
    const top = placed.y - placed.height / 2;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + placed.width);
    maxY = Math.max(maxY, top + placed.height);
    return {
      id: node.id,
      label: node.label,
      left,
      top,
      width: placed.width,
      height: placed.height,
    };
  });

  const routes = edges.map((edge) => {
    const points =
      graph.hasNode(edge.from) && graph.hasNode(edge.to)
        ? graph.edge(edge.from, edge.to).points
        : [];
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return { from: edge.from, to: edge.to, points };
  });

  const naturalWidth = Math.max(maxX - minX, 1);
  const naturalHeight = Math.max(maxY - minY, 1);

  /* Never scale UP. A two-node graph blown up to fill a 1920-tall frame draws
   * two enormous boxes and reads as a mistake; left at its natural size and
   * centred, it reads as a diagram. */
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight, 1);

  const offsetX = box.x + (box.width - naturalWidth * scale) / 2 - minX * scale;
  const offsetY = box.y + (box.height - naturalHeight * scale) / 2 - minY * scale;

  return {
    nodes: laid.map((node) => ({
      id: node.id,
      label: node.label,
      rect: {
        x: offsetX + node.left * scale,
        y: offsetY + node.top * scale,
        width: node.width * scale,
        height: node.height * scale,
      },
    })),
    edges: routes.map((route) => ({
      from: route.from,
      to: route.to,
      points: route.points.map((point) => ({
        x: offsetX + point.x * scale,
        y: offsetY + point.y * scale,
      })),
    })),
  };
}
