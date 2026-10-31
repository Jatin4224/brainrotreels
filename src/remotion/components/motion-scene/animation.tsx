/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ElementShell, animationStyle, ENTRANCE_AND_EXIT_ARE_NAMED,
 *   ANIMATION_NEVER_MOVES_THE_INK, PROGRESS_IS_A_FRACTION_OF_SECONDS,
 *   DETERMINISTIC_MOTION
 *
 * WHAT:  The wrapper every motion element is drawn inside — it mounts the
 *        element only while it is on screen and applies its entrance and exit.
 *
 * WHY:   ENTRANCE_AND_EXIT_ARE_NAMED. The movements come from the closed
 *        `SCENE_ANIMATIONS` set rather than from a duration-and-easing bag the
 *        designer fills in, because an animation is the one part of a scene
 *        geometry cannot check: a check can prove text fits, it cannot prove a
 *        curve does not look broken. Eight named movements are implemented
 *        once and reviewed once in the gallery.
 *
 *        ANIMATION_NEVER_MOVES_THE_INK is the constraint that keeps the
 *        checks honest. Every movement here is a TRANSFORM or an opacity — it
 *        never changes a layout rectangle, a font size or a wrap. If an
 *        entrance could nudge an element's real position, the overflow and
 *        overlap checks would describe the element at rest and the video would
 *        show it somewhere else, which is precisely the gap this phase exists
 *        to close. A transform also composites on the GPU, so it costs nothing
 *        per frame in headless Chrome.
 *
 *        PROGRESS_IS_A_FRACTION_OF_SECONDS: the window arrives in seconds and
 *        is converted with the canvas's own fps, so the same beat animates
 *        identically at 24, 30 and 60fps. Interpolating over a frame COUNT
 *        would make a 0.35s entrance twice as fast at 60fps.
 *
 *        DETERMINISTIC_MOTION. A fixed cubic easing over a fraction of
 *        seconds, never `spring` with a frame-dependent damping and nothing
 *        touching `Math.random`. Phase 04 reuses a render when the document
 *        hashes equal, so the same scene has to produce the same pixels on a
 *        different machine and in a different process.
 *
 *        The easing is eight lines HERE rather than Remotion's `interpolate`,
 *        and that is the one deliberate duplication in this folder. Importing
 *        `remotion` would pull its module body into the app bundle for the
 *        gallery's sake, which is the problem CAPTIONS_STAY_PURE describes —
 *        the package expects a Remotion bundle. A cubic ease-in-out is not a
 *        thing that can be got subtly wrong, and in exchange every drawing
 *        component in this folder runs anywhere. Grep TIME_IS_A_PROP.
 *
 *        The offsets are fractions of the CANVAS, not pixels, for the reason
 *        everything else in this engine is (SIZE_IS_A_FRACTION_OF_HEIGHT) —
 *        a 40px slide is a different gesture at 720p and at 4K.
 * WHERE: src/remotion/components/motion-scene/index.tsx wraps every element
 *        in one of these; the gallery renders the same component.
 */

import type { ReactNode } from "react";

import type { SceneAnimation } from "@/lib/types/scene";

/* Long enough to read as a move rather than a cut, short enough that a 1.5s
 * beat is not mostly animation. The exit is quicker than the entrance because
 * a departure nobody is looking at any more only needs to not be abrupt. */
const ENTRANCE_SECONDS = 0.35;
const EXIT_SECONDS = 0.25;

/* Travel distances, as fractions of the canvas. */
const RISE_FRACTION = 0.03;
const SLIDE_FRACTION = 0.07;
const POP_FROM = 0.88;

/**
 * SOURCE OF TRUTH KEYWORDS: animationStyle, ANIMATION_NEVER_MOVES_THE_INK
 *
 * WHAT:  The CSS for one movement at a given progress, where 0 is fully absent
 *        and 1 is fully present.
 * WHY:   Separate from the shell and exported so a primitive that staggers its
 *        own parts — a list revealing item by item, a kinetic line arriving
 *        word by word — applies the SAME movement to each part instead of
 *        inventing a second vocabulary of motion for its insides. Grep
 *        STAGGER_REUSES_THE_MOVEMENT.
 * WHERE: The shell below; List, KineticText, BarChart and FlowGraph.
 */
export function animationStyle(args: {
  animation: SceneAnimation;
  /** 0 → absent, 1 → fully present. */
  progress: number;
  canvas: { width: number; height: number };
}): React.CSSProperties {
  const { animation, progress, canvas } = args;
  const away = 1 - progress;

  switch (animation) {
    case "none":
      return {};

    case "fade":
      return { opacity: progress };

    case "rise":
      return {
        opacity: progress,
        transform: `translateY(${away * RISE_FRACTION * canvas.height}px)`,
      };

    case "fall":
      return {
        opacity: progress,
        transform: `translateY(${-away * RISE_FRACTION * canvas.height}px)`,
      };

    case "slide-left":
      /* Named for the direction it travels, so `slide-left` enters from the
       * RIGHT. The alternative reading — named for where it comes from — makes
       * every pair of adjacent elements look like a mistake. */
      return {
        opacity: progress,
        transform: `translateX(${away * SLIDE_FRACTION * canvas.width}px)`,
      };

    case "slide-right":
      return {
        opacity: progress,
        transform: `translateX(${-away * SLIDE_FRACTION * canvas.width}px)`,
      };

    case "pop":
      return {
        opacity: progress,
        transform: `scale(${POP_FROM + (1 - POP_FROM) * progress})`,
      };

    case "wipe-up":
      /* A clip rather than a translate, so the element is revealed in place —
       * which is what makes it read as a reveal and not as a slide. It still
       * moves no ink: the glyphs stay exactly where they were measured. */
      return {
        opacity: progress > 0 ? 1 : 0,
        clipPath: `inset(${away * 100}% 0 0 0)`,
      };

    default: {
      const exhaustive: never = animation;
      throw new Error(
        `[motion-scene/animation] Unknown animation ${String(exhaustive)}`,
      );
    }
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: elementProgress, PROGRESS_IS_A_FRACTION_OF_SECONDS
 *
 * WHAT:  How present an element is at a moment: 0 before it arrives, 1 while
 *        it is settled, back to 0 as it leaves.
 * WHY:   One function so the entrance and the exit cannot be computed with
 *        different easings by accident, and so a primitive staggering its
 *        insides can ask the same question about its own parts.
 *
 *        A window shorter than the two animations together gets them SCALED
 *        rather than overlapped: a 0.4s element would otherwise be mid-exit
 *        before its entrance finished and never reach full opacity, which
 *        reads as a flicker. Grep SHORT_ELEMENTS_SCALE_THEIR_MOTION.
 * WHERE: The shell; the staggering primitives.
 */
export function elementProgress(args: {
  /** Seconds since the start of the beat. */
  seconds: number;
  window: { from: number; to: number };
  hasEntrance: boolean;
  hasExit: boolean;
}): number {
  const { seconds, window: visible, hasEntrance, hasExit } = args;
  const span = visible.to - visible.from;

  const wanted =
    (hasEntrance ? ENTRANCE_SECONDS : 0) + (hasExit ? EXIT_SECONDS : 0);
  /* SHORT_ELEMENTS_SCALE_THEIR_MOTION — never more than half the window each. */
  const scale = wanted > span && wanted > 0 ? span / wanted : 1;
  const entranceSeconds = hasEntrance ? ENTRANCE_SECONDS * scale : 0;
  const exitSeconds = hasExit ? EXIT_SECONDS * scale : 0;

  if (seconds < visible.from || seconds > visible.to) return 0;

  const since = seconds - visible.from;
  const until = visible.to - seconds;

  const arriving =
    entranceSeconds > 0 ? easeOutCubic(since / entranceSeconds) : 1;
  const leaving = exitSeconds > 0 ? easeInCubic(until / exitSeconds) : 1;

  return Math.min(arriving, leaving);
}

/* Both clamp to 0..1, so a caller never has to. `out` decelerates into place,
 * which is what makes an entrance read as arriving rather than as stopping;
 * `in` accelerates away, which is the same gesture reversed. */
function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

function easeInCubic(t: number): number {
  const x = clamp01(t);
  return x ** 3;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

/**
 * SOURCE OF TRUTH KEYWORDS: ElementShell, UNMOUNTED_OUTSIDE_ITS_WINDOW
 *
 * WHAT:  Mounts one element for exactly as long as it is on screen, with its
 *        entrance and exit applied.
 * WHY:   UNMOUNTED_OUTSIDE_ITS_WINDOW — it returns null rather than rendering
 *        at zero opacity. A transparent element still costs layout and paint
 *        on every frame of a beat it is not part of, and a six-element beat
 *        where five are invisible is five wasted compositions per frame across
 *        1800 frames. It also makes the frame honest in the Remotion preview's
 *        element inspector.
 * WHERE: index.tsx, once per element.
 */
export function ElementShell({
  animation,
  exitAnimation,
  window: visible,
  canvas,
  seconds,
  children,
}: {
  animation: SceneAnimation;
  exitAnimation: SceneAnimation;
  window: { from: number; to: number };
  canvas: { width: number; height: number };
  /** Seconds since the start of the beat — see TIME_IS_A_PROP. */
  seconds: number;
  children: ReactNode;
}) {
  if (seconds < visible.from || seconds > visible.to) return null;

  const progress = elementProgress({
    seconds,
    window: visible,
    hasEntrance: animation !== "none",
    hasExit: exitAnimation !== "none",
  });

  /* Which of the two movements is showing: the exit's, once past the midpoint
   * of the window and on the way out. Picking by progress alone would apply
   * the entrance's movement to the departure, so an element that rose in would
   * sink out — backwards. */
  const leaving = seconds > (visible.from + visible.to) / 2;
  const style = animationStyle({
    animation: leaving ? exitAnimation : animation,
    progress,
    canvas,
  });

  return (
    <div style={{ position: "absolute", inset: 0, ...style }}>{children}</div>
  );
}
