/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MotionSceneCanvas, MOTION_PRIMITIVES,
 *   ONE_FAMILY_TEN_PRIMITIVES, TIME_IS_A_PROP, PREVIEW_IS_THE_RENDER,
 *   LAYOUT_ONCE_PER_FRAME
 *
 * WHAT:  A whole motion beat drawn at one moment: lay the scene out, then draw
 *        each element with its primitive, inside its entrance and exit.
 *
 * WHY:   PREVIEW_IS_THE_RENDER. This is the component BOTH drivers mount —
 *        `MotionScene` in ./index.tsx, which reads Remotion's frame, and the
 *        gallery, which drives it from a `requestAnimationFrame` loop. The
 *        same split src/components/global/caption-preview already uses, and
 *        for the same reason: a gallery that drew its own approximation would
 *        be wrong exactly where it matters — on the long label, at the edge of
 *        the safe zone, in the one primitive somebody changed last week.
 *
 *        TIME_IS_A_PROP is what makes that possible, and it is why there is no
 *        `remotion` import in this file or in any primitive beside it. Forty
 *        gallery cards would otherwise be forty Players.
 *
 *        ONE_FAMILY_TEN_PRIMITIVES: the dispatch is a map, so an eleventh
 *        primitive is a key plus a component and nobody edits this file.
 *
 *        LAYOUT_ONCE_PER_FRAME. `layoutScene` runs in the body, so once per
 *        frame per beat rather than once per render. Deliberate and cheap — it
 *        is arithmetic over at most six elements, plus a Dagre pass over at
 *        most eight nodes for a graph. The alternative, laying out once and
 *        threading geometry through props, would require the Player and the
 *        Lambda to agree to pass identical values; the whole reason the engine
 *        is pure and synchronous is so that neither has to. Both call the same
 *        function and get the same answer.
 * WHERE: ./index.tsx (the registered `motion` family) and the gallery's
 *        preview card.
 */

import { createElement, type ComponentType } from "react";

import type { Palette } from "@/lib/palettes";
import { elementWindowSeconds, layoutScene } from "@/lib/scene";
import type { CanvasSpec } from "@/lib/timeline";
import type {
  MotionPrimitiveProps,
  Scene,
  ScenePrimitive,
} from "@/lib/types/scene";
import type { SafeZone } from "@/lib/types/caption";

import { ElementShell } from "./animation";
import { FlowGraph } from "./flow-graph";
import { BarChart, Counter, Meter } from "./numbers";
import { Compare, Icon, List } from "./structure";
import { Callout, KineticText, Title } from "./text";

/**
 * SOURCE OF TRUTH KEYWORDS: MOTION_PRIMITIVES, ONE_FAMILY_TEN_PRIMITIVES
 *
 * WHAT:  The map from an element's `kind` to the component that draws it.
 * WHY:   A FULL `Record`, not a `Partial` — the opposite of
 *        `RENDER_COMPONENTS` in src/remotion/registry.ts, and deliberately.
 *        An unimplemented RENDER KIND is a documented gap, because a document
 *        written by a newer release must degrade rather than fail. A primitive
 *        comes from this app's own closed `SCENE_PRIMITIVES`, the designer
 *        prompt is generated from that same list, and the gallery exercises
 *        all of it — so a missing one is a bug nobody should be able to ship,
 *        and the type system is the cheapest place to say so.
 * WHERE: The dispatch below.
 */
export const MOTION_PRIMITIVES: Readonly<
  Record<ScenePrimitive, ComponentType<MotionPrimitiveProps>>
> = {
  title: Title,
  kineticText: KineticText,
  counter: Counter,
  meter: Meter,
  barChart: BarChart,
  compare: Compare,
  list: List,
  flowGraph: FlowGraph,
  icon: Icon,
  callout: Callout,
};

export function MotionSceneCanvas({
  scene,
  palette,
  canvas,
  safeZone,
  seconds,
  beatSeconds,
}: {
  scene: Scene;
  palette: Palette;
  canvas: CanvasSpec;
  safeZone: SafeZone;
  /** The moment being drawn, in seconds from the start of the beat. */
  seconds: number;
  /** The beat's whole length in seconds. */
  beatSeconds: number;
}) {
  const placed = layoutScene(scene, { canvas, safeZone });

  return (
    <>
      {scene.elements.map((element, index) => {
        const placedElement = placed.elements[index];
        if (placedElement === undefined) return null;

        /* Computed once and handed to both the shell and the primitive: the
         * shell decides when to mount and the primitive interpolates its own
         * insides over the same window, and two calls that could ever disagree
         * would put a count-up outside the frames it is visible in. */
        const visible = elementWindowSeconds(element, beatSeconds);

        return (
          <ElementShell
            key={element.id}
            animation={element.entrance}
            exitAnimation={element.exit}
            window={visible}
            canvas={canvas}
            seconds={seconds}
          >
            {/* `createElement`, not JSX with a capitalised local, for the same
                reason the renderer's own dispatch uses it: assigning a
                looked-up component to a variable and rendering it as JSX trips
                react-hooks/static-components, because the compiler cannot tell
                a map lookup from a component built during render. The identity
                really is stable — MOTION_PRIMITIVES is a module constant. */}
            {createElement(MOTION_PRIMITIVES[element.kind], {
              element,
              placed: placedElement,
              palette,
              canvas,
              window: visible,
              seconds,
            })}
          </ElementShell>
        );
      })}
    </>
  );
}
