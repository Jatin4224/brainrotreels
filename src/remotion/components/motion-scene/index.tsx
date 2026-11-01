/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MotionScene, PARSE_AT_THE_COMPONENT,
 *   UNKNOWN_DRAWS_NOTHING, DURATION_COMES_FROM_THE_PLAN,
 *   NO_COORDINATE_SURVIVES_THE_SEAM, TIME_IS_A_PROP
 *
 * WHAT:  The component registered as the `motion` render kind — the thin
 *        Remotion driver that reads the current frame and hands a moment to
 *        `MotionSceneCanvas`.
 *
 * WHY:   Thin on purpose. Everything that DRAWS lives in ./canvas.tsx and the
 *        primitives beside it, with time as a prop (TIME_IS_A_PROP), so the
 *        gallery mounts the same components from a `requestAnimationFrame`
 *        loop instead of needing a Player per card. This file is the only one
 *        in the folder that knows Remotion exists, which is what keeps that
 *        true.
 *
 *        PARSE_AT_THE_COMPONENT, the contract every render component honours:
 *        props arrive loose and each narrows what it needs with its own
 *        schema. Here that is `fromSceneSpec`, which is also the gate that
 *        enforces NO_COORDINATE_SURVIVES_THE_SEAM — a stored element carrying
 *        a `box` is refused rather than honoured, so the layout engine's
 *        monopoly on geometry survives a hand-edited document or one written
 *        by an older release.
 *
 *        DURATION_COMES_FROM_THE_PLAN. The beat's length is
 *        `frames.durationInFrames / fps`, not the item's own `duration` field.
 *        The planner has already resolved anchors, clamped the item to the
 *        document and snapped it to whole frames (Phase 03), so the plan is
 *        the only value that matches what is actually on screen — reading
 *        `item.duration` would disagree by up to a frame and every element's
 *        exit would land in the wrong place.
 *
 *        UNKNOWN_DRAWS_NOTHING: a scene that does not parse logs once and
 *        draws nothing. A visible placeholder was the alternative and it is
 *        worse on the paid path — it would composite a box reading
 *        "unsupported" into a customer's video, where silence is the honest
 *        failure. The log line is what makes it diagnosable.
 * WHERE: Registered as `motion` in src/remotion/registry.ts.
 */

import { useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

import { getMotionStyle } from "@/lib/motion-styles";
import { getPalette } from "@/lib/palettes";
import { fromSceneSpec } from "@/lib/scene";
import { sceneSpecSchema } from "@/lib/timeline";
import type { RenderItemProps } from "@/lib/types";

import { MotionSceneCanvas } from "./canvas";

export { MOTION_PRIMITIVES, MotionSceneCanvas } from "./canvas";

/* Only the one field this family reads. The rest of the item — its id, its
 * timing, its label — belongs to the walker, which has already used them. */
const motionItemSchema = z.object({ scene: sceneSpecSchema });

/* One line per bad scene per process, not per frame. A 60-second render is
 * 1800 frames and would otherwise write 1800 identical lines into the log that
 * matters most when a render goes wrong. */
const warned = new Set<string>();

export function MotionScene({ item, canvas, style, frames }: RenderItemProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const parsedItem = motionItemSchema.safeParse(item);
  if (!parsedItem.success) return null;

  const parsed = fromSceneSpec(parsedItem.data.scene);
  if (!parsed.ok) {
    const key = parsed.errors.map((error) => error.path).join("|");
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(
        "[motion-scene] Refusing to draw a scene that does not parse — drawing nothing. " +
          parsed.errors
            .map((error) => `${error.path}: ${error.message}`)
            .join("; "),
      );
    }
    return null;
  }

  return (
    <MotionSceneCanvas
      scene={parsed.scene}
      /* The DOCUMENT's style id, resolved with the fallback — a document
       * written by a newer release naming a style this worker has never heard
       * of still produces a video (UNKNOWN_STYLE_FALLS_BACK). */
      style={getMotionStyle(style.motionStyleId)}
      /* The document's palette, not the motion style's: applying a style
       * copies its palette into the document, so this is the one answer to
       * "what colour is this video" (APPLYING_A_STYLE_WRITES_THE_PALETTE). */
      palette={getPalette(style.paletteId)}
      canvas={canvas}
      safeZone={style.safeZone}
      /* FRAMES_ARE_RELATIVE_INSIDE — the walker mounts every item in its own
       * Sequence, so this frame is already relative to the beat and needs no
       * offset arithmetic. */
      seconds={frame / fps}
      beatSeconds={frames.durationInFrames / fps}
    />
  );
}
