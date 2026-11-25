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
import ReactDOM from "react-dom";

import type { HandScene } from "./hand/handScene";
import { SCENE_H, SCENE_W } from "./lib/geometry";

const MODEL_URL = "/hero/hand-point.glb";

/* The scene is held back until the hand is drawn, so the model is on the
   critical path for the hero's reveal — start fetching it the moment this
   module is parsed, in parallel with the three.js chunk beside it, rather
   than waiting for the effect to run. */
if (typeof window !== "undefined") {
  ReactDOM.preload(MODEL_URL, { as: "fetch", crossOrigin: "anonymous" });
}

export interface UseHandSceneArgs {
  /** The element whose visibility gates the load. */
  rootRef: React.RefObject<HTMLElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  reduced: boolean;
  onReady: () => void;
  /** Called when there will be no 3D hand, so the scene can show regardless. */
  onFailed: () => void;
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
  onFailed,
}: UseHandSceneArgs): React.RefObject<HandScene | null> {
  const sceneRef = React.useRef<HandScene | null>(null);
  /* Held in refs so changing the callback, or the reduced-motion setting,
     cannot re-run the loader and download the model a second time. Synced
     in an effect rather than during render: a ref written while rendering is
     a ref written twice under StrictMode and never under a bailout. */
  const onReadyRef = React.useRef(onReady);
  const onFailedRef = React.useRef(onFailed);
  const reducedRef = React.useRef(reduced);

  React.useEffect(() => {
    onReadyRef.current = onReady;
    onFailedRef.current = onFailed;
    reducedRef.current = reduced;
  }, [onReady, onFailed, reduced]);

  React.useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    let cancelled = false;

    const fail = (err?: unknown) => {
      /* No WebGL, a lost context, or a model that would not parse. There is
         no stand-in hand to fall back to any more — the scene simply shows
         without one, which is better than the flat cartoon hand that used to
         sit here. A hero that silently downgrades is one nobody finds out is
         broken, so say so where a developer will see it. */
      if (process.env.NODE_ENV !== "production" && err) {
        console.error("[lamp-scene] hand failed to load:", err);
      }
      sceneRef.current?.dispose();
      sceneRef.current = null;
      if (!cancelled) onFailedRef.current();
    };

    /* No idle gate. It used to defer this by up to 2s so a 4.6MB model could
       not compete with the page's first interaction; the model is ~190KB now
       and the whole scene waits on it, so that delay is the visible pause,
       not a saving. The IntersectionObserver stays: a visitor who never
       reaches the hero still never pays for three.js. */
    const load = () => {
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
              onError: fail,
            });
          } catch (err) {
            fail(err);
          }
        })
        .catch(fail);
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
        sceneRef.current?.dispose();
        sceneRef.current = null;
      };
    }

    return () => {
      cancelled = true;
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
