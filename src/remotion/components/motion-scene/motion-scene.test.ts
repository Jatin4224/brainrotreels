/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: motion-scene test, ANIMATION_NEVER_MOVES_THE_INK,
 *   SHORT_ELEMENTS_SCALE_THEIR_MOTION, BUNDLED_GLYPH_ONLY, RUNS_ARE_FOUND_BY_PATH,
 *   DETERMINISTIC_MOTION
 *
 * WHAT:  The pure halves of the motion components — the animation maths, the
 *        stagger, the icon geometry and the run lookup. No rendering: the
 *        suite runs in `node` with no DOM, and what a frame LOOKS like is the
 *        gallery's job, which is a human.
 *
 * WHY:   ANIMATION_NEVER_MOVES_THE_INK is the claim worth asserting here,
 *        because the whole of Phase 16a's measurement depends on it: if an
 *        entrance could change a layout rectangle, the overflow and overlap
 *        checks would describe the element at rest and the video would show it
 *        somewhere else. The test reads every animation's style and insists it
 *        only ever touches opacity, transform and clip-path.
 *
 *        SHORT_ELEMENTS_SCALE_THEIR_MOTION is asserted because getting it
 *        wrong is invisible in a long beat and ruins a short one — an element
 *        on screen for 0.4s would otherwise begin its exit before its entrance
 *        finished and never reach full opacity, which reads as a flicker
 *        rather than as a bug.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { SCENE_ANIMATIONS, SCENE_ICONS } from "@/lib/types/scene";

import { animationStyle, elementProgress } from "./animation";
import { SCENE_ICON_PATHS } from "./icons";
import { localProgress, runByPath } from "./util";

const CANVAS = { width: 1080, height: 1920 };

describe("animations", () => {
  it("only ever touches opacity, transform and clip-path", () => {
    /* ANIMATION_NEVER_MOVES_THE_INK. Anything else here — a width, a margin,
     * a font size — would move the drawn text away from where it was
     * measured, and no check would notice. */
    const allowed = new Set(["opacity", "transform", "clipPath"]);

    for (const animation of SCENE_ANIMATIONS) {
      for (const progress of [0, 0.5, 1]) {
        const style = animationStyle({ animation, progress, canvas: CANVAS });
        for (const key of Object.keys(style)) {
          expect(allowed.has(key), `${animation} sets ${key}`).toBe(true);
        }
      }
    }
  });

  it("is fully present at the end of every entrance", () => {
    for (const animation of SCENE_ANIMATIONS) {
      const style = animationStyle({ animation, progress: 1, canvas: CANVAS });
      /* At rest an element must be exactly where it was placed: no residual
       * translate, no residual scale, nothing clipped. */
      expect(style.opacity ?? 1).toBe(1);
      if (style.transform !== undefined) {
        expect(style.transform).toMatch(/\(-?0(px)?\)|scale\(1\)/u);
      }
      if (style.clipPath !== undefined) {
        expect(style.clipPath).toBe("inset(0% 0 0 0)");
      }
    }
  });

  it("is absent at the start of every entrance except none", () => {
    for (const animation of SCENE_ANIMATIONS) {
      if (animation === "none") continue;
      const style = animationStyle({ animation, progress: 0, canvas: CANVAS });
      expect(style.opacity).toBe(0);
    }
  });

  it("leaves a settled element alone", () => {
    const window = { from: 0, to: 4 };
    const progress = elementProgress({
      seconds: 2,
      window,
      hasEntrance: true,
      hasExit: true,
    });

    expect(progress).toBe(1);
  });

  it("is zero outside the window", () => {
    const window = { from: 1, to: 2 };
    for (const seconds of [0, 0.5, 2.5]) {
      expect(
        elementProgress({ seconds, window, hasEntrance: true, hasExit: true }),
      ).toBe(0);
    }
  });

  it("reaches full presence even in a window shorter than its animations", () => {
    /* SHORT_ELEMENTS_SCALE_THEIR_MOTION. 0.4s is shorter than a 0.35s
     * entrance plus a 0.25s exit, so without scaling the element would never
     * be fully visible. */
    const window = { from: 0, to: 0.4 };
    const samples = Array.from({ length: 41 }, (_, i) => i * 0.01);
    const peak = Math.max(
      ...samples.map((seconds) =>
        elementProgress({ seconds, window, hasEntrance: true, hasExit: true }),
      ),
    );

    /* Fully present at ONE instant — the entrance ends exactly where the exit
     * begins, which is what "scaled rather than overlapped" means. The
     * assertion is that it gets there at all: unscaled, the two would cross
     * at roughly 0.55 and the element would read as a flicker. */
    expect(peak).toBeGreaterThan(0.99);
  });

  it("is deterministic", () => {
    /* DETERMINISTIC_MOTION — Phase 04 reuses a render when the document
     * hashes equal, so the same moment must produce the same style. */
    const args = {
      animation: "pop" as const,
      progress: 0.42,
      canvas: CANVAS,
    };
    expect(animationStyle(args)).toEqual(animationStyle(args));
  });
});

describe("stagger", () => {
  it("starts each part after the one before it", () => {
    const window = { from: 0, to: 4 };
    const at = (index: number, seconds: number) =>
      localProgress({ seconds, window, index, count: 4 });

    expect(at(0, 0.05)).toBeGreaterThan(at(3, 0.05));
    expect(at(3, 0.05)).toBe(0);
  });

  it("has every part settled well before the beat ends", () => {
    /* The parts start within the first half of the window, so the last one
     * must be finished with time to spare — otherwise the fifth list item
     * appears as the beat cuts. */
    const window = { from: 0, to: 4 };
    const last = localProgress({
      seconds: window.to * 0.75,
      window,
      index: 4,
      count: 5,
    });

    expect(last).toBe(1);
  });

  it("does not stagger a single part", () => {
    const window = { from: 0, to: 2 };
    expect(
      localProgress({ seconds: 0.0001, window, index: 0, count: 1 }),
    ).toBeGreaterThan(0);
  });
});

describe("icons", () => {
  it("has geometry for every icon the schema allows", () => {
    /* BUNDLED_GLYPH_ONLY. A missing glyph draws nothing, and a beat whose only
     * element is a missing icon is a blank frame in a paid video. The Record
     * makes this a compile error too; this catches an empty array, which the
     * type cannot. */
    for (const icon of SCENE_ICONS) {
      const paths = SCENE_ICON_PATHS[icon];
      expect(paths.length, `${icon} has no subpaths`).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path, `${icon} has an empty subpath`).toMatch(/^M[\s\d.-]/u);
      }
    }
  });

  it("stays inside the 24-unit grid it declares", () => {
    /* A coordinate outside the viewBox is clipped silently — the icon just
     * looks wrong, and only in the gallery. */
    for (const icon of SCENE_ICONS) {
      for (const path of SCENE_ICON_PATHS[icon]) {
        for (const match of path.matchAll(/-?\d+(\.\d+)?/gu)) {
          const value = Number.parseFloat(match[0]);
          expect(value, `${icon}: ${match[0]}`).toBeGreaterThanOrEqual(-1);
          expect(value, `${icon}: ${match[0]}`).toBeLessThanOrEqual(25);
        }
      }
    }
  });
});

describe("run lookup", () => {
  it("finds a run by its field path and misses safely", () => {
    /* RUNS_ARE_FOUND_BY_PATH — an index would silently re-point the moment a
     * primitive gained an optional field. */
    const placed = {
      id: "e",
      kind: "counter" as const,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      runs: [
        {
          path: "label",
          text: "Revenue",
          role: "label" as const,
          fontPx: 20,
          lines: ["Revenue"],
          widthPx: 10,
          heightPx: 10,
          box: { x: 0, y: 0, width: 10, height: 10 },
          drawnRect: { x: 0, y: 0, width: 10, height: 10 },
          overflow: false,
        },
      ],
    };

    expect(runByPath(placed, "label")?.text).toBe("Revenue");
    expect(runByPath(placed, "to")).toBeNull();
  });
});
