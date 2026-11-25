/**
 * SOURCE OF TRUTH KEYWORDS: HandCanvas, THREE_IS_NEVER_IN_THE_BUNDLE,
 *   useHandScene
 *
 * WHAT:  The canvas the three.js hand draws into, and the hook that loads
 *        three.js and the model late — only once the scene is actually on
 *        screen and the browser has nothing better to do.
 *
 * WHY:   THREE_IS_NEVER_IN_THE_BUNDLE. This is a LANDING PAGE: three.js plus
 *        a 4.6MB hand is more bytes than the rest of the route put together,
 *        and a visitor who bounces at the fold should never have paid for it.
 *        So the import is dynamic (it becomes its own chunk), it is gated on
 *        an IntersectionObserver so a phone that never scrolls the hero into
 *        view never fetches it, and then on idle so it cannot compete with
 *        the page's own first interaction. Until all that lands — or forever,
 *        on a machine with no WebGL — the drawn hand is on screen instead.
 *
 *        The canvas is `pointer-events: none`. Hit-testing the hand is a
 *        raycast done by the scene root's own handler, not a DOM event, which
 *        is the only way a hand drawn in WebGL can be hovered without putting
 *        a 560×760 blocker over everything beneath it.
 * WHERE: Layer 5 of LampScene, over the phone and under the bubble.
 */

"use client";

import * as React from "react";

import type { HandScene } from "./hand/handScene";
import { SCENE_H, SCENE_W } from "./lib/geometry";

const MODEL_URL = "/hero/hand-point.glb";

function whenIdle(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const ric = window.requestIdleCallback;
  if (typeof ric === "function") {
    const id = ric(fn, { timeout: 2000 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 300);
  return () => window.clearTimeout(id);
}

export interface UseHandSceneArgs {
  /** The element whose visibility gates the load. */
  rootRef: React.RefObject<HTMLElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  reduced: boolean;
  onReady: () => void;
}

/**
 * Loads the hand once it is worth loading and hands back a ref to it. The ref
 * is deliberately a ref and not state: the RAF loop reads it every frame, and
 * the only React re-render in the whole scene's lifetime is the one that
 * hides the fallback hand.
 */
export function useHandScene({
  rootRef,
  canvasRef,
  reduced,
  onReady,
}: UseHandSceneArgs): React.RefObject<HandScene | null> {
  const sceneRef = React.useRef<HandScene | null>(null);
  /* Held in refs so changing the callback, or the reduced-motion setting,
     cannot re-run the loader and download the model a second time. Synced
     in an effect rather than during render: a ref written while rendering is
     a ref written twice under StrictMode and never under a bailout. */
  const onReadyRef = React.useRef(onReady);
  const reducedRef = React.useRef(reduced);

  React.useEffect(() => {
    onReadyRef.current = onReady;
    reducedRef.current = reduced;
  }, [onReady, reduced]);

  React.useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    let cancelled = false;
    let cancelIdle: (() => void) | null = null;

    const load = () => {
      cancelIdle = whenIdle(() => {
        if (cancelled) return;
        void import("./hand/handScene")
          .then(({ createHandScene }) => {
            if (cancelled) return;
            try {
              sceneRef.current = createHandScene(canvas, MODEL_URL, {
                still: reducedRef.current,
                onReady: () => {
                  if (!cancelled) onReadyRef.current();
                },
                onError: (err) => {
                  /* No WebGL, a lost context, or a model that would not
                     parse. The drawn hand is already on screen; leaving it
                     there is the whole fallback — but a hero that silently
                     downgrades is a hero nobody ever finds out is broken, so
                     say so where a developer will see it. */
                  if (process.env.NODE_ENV !== "production") {
                    console.error("[lamp-scene] hand failed to load:", err);
                  }
                  sceneRef.current?.dispose();
                  sceneRef.current = null;
                },
              });
            } catch {
              sceneRef.current = null;
            }
          })
          .catch(() => {
            sceneRef.current = null;
          });
      });
    };

    if (typeof IntersectionObserver !== "function") {
      load();
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            load();
          }
        },
        { rootMargin: "200px" },
      );
      io.observe(root);
      return () => {
        cancelled = true;
        io.disconnect();
        cancelIdle?.();
        sceneRef.current?.dispose();
        sceneRef.current = null;
      };
    }

    return () => {
      cancelled = true;
      cancelIdle?.();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [rootRef, canvasRef]);

  return sceneRef;
}

export const HandCanvas = React.forwardRef<HTMLCanvasElement>(
  function HandCanvas(_props, ref) {
    return (
      <canvas
        ref={ref}
        width={SCENE_W}
        height={SCENE_H}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0"
        style={{ width: SCENE_W, height: SCENE_H }}
      />
    );
  },
);
