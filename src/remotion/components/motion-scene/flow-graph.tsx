/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: FlowGraph, EDGES_ARE_DRAWN_FROM_DAGRES_ROUTE,
 *   NODES_ARRIVE_IN_RANK_ORDER, ONE_SVG_FOR_THE_EDGES
 *
 * WHAT:  A process diagram: boxed nodes with their labels, joined by the
 *        routes Dagre computed.
 *
 * WHY:   EDGES_ARE_DRAWN_FROM_DAGRES_ROUTE. The polylines come from
 *        `graph.edge().points`, scaled into the slot by
 *        src/lib/scene/flow.ts — not from the two node centres. Drawing
 *        centre-to-centre is the tempting shortcut and it is wrong exactly
 *        where a diagram is interesting: a layered graph routes an edge AROUND
 *        the ranks between its endpoints, and a straight line would cut
 *        through whatever node sits in the way. Dagre already solved that; the
 *        component's job is to not throw the answer away.
 *
 *        ONE_SVG_FOR_THE_EDGES, sized to the whole canvas with no transform,
 *        so the points can be used as they are. An SVG per edge, or one sized
 *        to the slot, would each need an offset applied — one more arithmetic
 *        step between the measured geometry and the drawn picture, which is
 *        the class of mistake this whole library is arranged to avoid. The
 *        edges are drawn FIRST so the node boxes sit on top of their ends
 *        rather than under them.
 *
 *        NODES_ARRIVE_IN_RANK_ORDER — the stagger follows the order of
 *        `element.nodes`, which is the order the author wrote the process in.
 *        Staggering by Dagre's internal ordering would animate a flow
 *        sideways, and staggering all at once would lose the sense of a
 *        sequence, which is the one thing a flow diagram is for.
 * WHERE: Registered in MOTION_PRIMITIVES in ./index.tsx.
 */

import { withAlpha } from "@/lib/captions";
import type { MotionPrimitiveProps } from "@/lib/types/scene";

import { TextBlock } from "./text-block";
import { localProgress, radiusPx, runByPath, strokePx } from "./util";

export function FlowGraph({
  element,
  placed,
  palette,
  canvas,
  window: visible,
  seconds,
  style,
}: MotionPrimitiveProps) {
  if (element.kind !== "flowGraph") return null;

  const graph = placed.graph;
  if (graph === undefined) return null;

  const count = graph.nodes.length;
  const progressFor = (index: number): number =>
    localProgress({
      seconds,
      window: visible,
      index,
      count,
      spread: 0.26,
    });

  const nodeIndex = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const stroke = strokePx(style, canvas.height * 0.0022, 1.5);

  return (
    <>
      <svg
        width={canvas.width}
        height={canvas.height}
        style={{ position: "absolute", left: 0, top: 0 }}
        aria-hidden
      >
        {graph.edges.map((edge) => {
          if (edge.points.length < 2) return null;
          /* An edge appears with the LATER of the two nodes it joins — an
           * arrow reaching a box that is not there yet reads as a glitch. */
          const from = nodeIndex.get(edge.from) ?? 0;
          const to = nodeIndex.get(edge.to) ?? 0;
          const opacity = progressFor(Math.max(from, to));

          return (
            <polyline
              key={`${edge.from}-${edge.to}`}
              points={edge.points
                .map((point) => `${point.x},${point.y}`)
                .join(" ")}
              fill="none"
              stroke={palette.text}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={opacity * 0.45}
            />
          );
        })}
      </svg>

      {graph.nodes.map((node, index) => {
        const run = runByPath(placed, `nodes.${index}.label`);
        const opacity = progressFor(index);

        return (
          <div key={node.id} style={{ opacity }}>
            <div
              style={{
                position: "absolute",
                left: node.rect.x,
                top: node.rect.y,
                width: node.rect.width,
                height: node.rect.height,
                /* Radius proportional to the box, so a node looks the same at
                 * every resolution and in every graph size. */
                borderRadius: radiusPx(style, node.rect.height),
                border: `${stroke}px solid ${palette.accent}`,
                /* The palette's text colour at low alpha rather than a literal
                 * fill: it tints toward the backdrop, so a node reads as
                 * raised on all five palettes without a sixth colour.
                 *
                 * `withAlpha` rather than a CSS `opacity` on this div, which
                 * would fade the BORDER with the fill and leave the node
                 * outline invisible — the alpha belongs to the one colour that
                 * wants it, not to the element. */
                backgroundColor: withAlpha(palette.text, 0.08),
              }}
            />
            {run === null ? null : (
              <TextBlock run={run} color={palette.text} style={style} />
            )}
          </div>
        );
      })}
    </>
  );
}
