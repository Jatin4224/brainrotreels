/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: MotionPreview, PREVIEW_IS_THE_RENDER,
 *   SCALED_NOT_REIMPLEMENTED, RAF_DRIVES_THE_TIME_PROP, GLOBAL_BECAUSE_THE_EDITOR_NEEDS_IT
 *
 * WHAT:  A live motion beat — the same components the video uses, drawn at
 *        full canvas size and scaled into a card, looping over the beat.
 *
 * WHY:   PREVIEW_IS_THE_RENDER. It mounts `MotionSceneCanvas`, which is what
 *        the registered `motion` family mounts, so a beat looks the same in
 *        the gallery, in the Player and in the finished file. The same
 *        argument src/components/global/caption-preview makes, and the reason
 *        the primitives take time as a PROP rather than reading Remotion's
 *        frame (TIME_IS_A_PROP) — a gallery that drew its own approximation
 *        would be wrong exactly where it matters.
 *
 *        SCALED_NOT_REIMPLEMENTED: rendered at FULL canvas size inside a CSS
 *        `scale`, never at card size. Every derived pixel — the fitted font,
 *        the safe inset, a graph node's border — would round differently at
 *        preview size, which is how a beat that fits in the gallery overflows
 *        in the video. Scaling the finished picture cannot do that.
 *
 *        RAF_DRIVES_THE_TIME_PROP rather than a CSS animation, for the same
 *        reason the caption preview does it: the card is driven by a TIME
 *        value, which is the same input Remotion derives from the frame
 *        number. A CSS keyframe here would be a second animation
 *        implementation that the render does not have, and it could not drive
 *        a counter's digits at all.
 *
 *        GLOBAL_BECAUSE_THE_EDITOR_NEEDS_IT. In components/global rather than
 *        the route's `_components`, because Phase 15's timeline editor
 *        inspects scene items and will want exactly this card — the same
 *        promotion `caption-preview` and `render-panel` already went through.
 *        It takes its scene, canvas and palette as props and knows nothing
 *        about the gallery.
 * WHERE: The motion gallery route; the timeline editor's inspector.
 */

import * as React from "react";

import { getPalette } from "@/lib/palettes";
import { safeRectFor } from "@/lib/scene";
import type { CanvasSpec } from "@/lib/timeline";
import type { SafeZone } from "@/lib/types/caption";
import type { Scene } from "@/lib/types/scene";
import { MotionSceneCanvas } from "@/remotion/components/motion-scene/canvas";

export interface MotionPreviewProps {
  scene: Scene;
  canvas: CanvasSpec;
  /** A palette id; an unknown one falls back, as everywhere else. */
  paletteId: string;
  safeZone: SafeZone;
  /** The beat's length in seconds. The loop restarts here. */
  durationSeconds: number;
  /** The card's width in CSS pixels. Height follows the canvas aspect. */
  width: number;
  /** Draw the safe rectangle as a guide. */
  showSafeZone?: boolean;
  /** Hold the beat at a fixed moment instead of looping. */
  frozenAt?: number | undefined;
}

export function MotionPreview({
  scene,
  canvas,
  paletteId,
  safeZone,
  durationSeconds,
  width,
  showSafeZone = false,
  frozenAt,
}: MotionPreviewProps) {
  const seconds = useLoopedSeconds(durationSeconds, frozenAt);
  const palette = getPalette(paletteId);
  const scale = width / canvas.width;
  const height = canvas.height * scale;

  return (
    <div
      style={{ width, height }}
      className="relative overflow-hidden rounded-lg border"
    >
      <div
        style={{
          width: canvas.width,
          height: canvas.height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          /* The palette's own gradient, which is what a motion project has
           * behind it until a background is chosen — the same string
           * `Backdrop` composites, so the contrast a reviewer judges is the
           * contrast the render has. */
          background: `linear-gradient(160deg, ${palette.from} 0%, ${palette.to} 100%)`,
          position: "absolute",
          top: 0,
          left: 0,
        }}
      >
        <MotionSceneCanvas
          scene={scene}
          palette={palette}
          canvas={canvas}
          safeZone={safeZone}
          seconds={seconds}
          beatSeconds={durationSeconds}
        />
        {showSafeZone ? (
          <SafeZoneGuide canvas={canvas} safeZone={safeZone} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: useLoopedSeconds, RAF_DRIVES_THE_TIME_PROP
 *
 * WHAT:  The current moment in a looping beat, in seconds.
 * WHY:   Driven by `requestAnimationFrame` and the document clock rather than
 *        by a frame counter, so the loop runs at real time on any refresh rate
 *        — a counter at 120Hz must not count twice as fast as the render will.
 *
 *        A frozen card does not start a loop at all. A gallery of a dozen
 *        cards animating at once is a dozen rAF callbacks, and the review
 *        surface should stay usable on a laptop.
 * WHERE: MotionPreview.
 */
function useLoopedSeconds(
  durationSeconds: number,
  frozenAt: number | undefined,
): number {
  const [ticked, setTicked] = React.useState(0);

  React.useEffect(() => {
    /* A frozen card starts no loop AND writes no state: returning `frozenAt`
     * below is what holds the moment. Setting it here instead would be a
     * setState in an effect body, which cascades a render for a value the
     * component already has. */
    if (frozenAt !== undefined) return;

    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      /* A short hold at the end of each pass, so the exit animation is
       * actually seen before the beat restarts — without it a looping card
       * reads as a stutter. */
      const loop = durationSeconds + 0.4;
      setTicked(((now - started) / 1000) % loop);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationSeconds, frozenAt]);

  return frozenAt ?? ticked;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SafeZoneGuide, SAFE_ZONE_IS_SHARED
 *
 * The rectangle every slot was placed inside, drawn as a dashed outline. It
 * comes from `safeRectFor` — the engine's own function — so the guide cannot
 * disagree with the constraint it is illustrating.
 */
function SafeZoneGuide({
  canvas,
  safeZone,
}: {
  canvas: CanvasSpec;
  safeZone: SafeZone;
}) {
  const rect = safeRectFor({ canvas, safeZone });

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        border: `${Math.max(canvas.height * 0.002, 2)}px dashed rgba(255,255,255,0.35)`,
        pointerEvents: "none",
      }}
    />
  );
}
