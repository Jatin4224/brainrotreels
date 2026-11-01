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

import {
  MOTION_PERSONALITY_TIMING,
  type MotionEasing,
  type MotionPersonality,
  type MotionPersonalityTiming,
} from "@/lib/types/motion-style";
import type { SceneAnimation } from "@/lib/types/scene";

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
      return { opacity: shown(progress) };

    case "rise":
      return {
        opacity: shown(progress),
        transform: `translateY(${away * RISE_FRACTION * canvas.height}px)`,
      };

    case "fall":
      return {
        opacity: shown(progress),
        transform: `translateY(${-away * RISE_FRACTION * canvas.height}px)`,
      };

    case "slide-left":
      /* Named for the direction it travels, so `slide-left` enters from the
       * RIGHT. The alternative reading — named for where it comes from — makes
       * every pair of adjacent elements look like a mistake. */
      return {
        opacity: shown(progress),
        transform: `translateX(${away * SLIDE_FRACTION * canvas.width}px)`,
      };

    case "slide-right":
      return {
        opacity: shown(progress),
        transform: `translateX(${-away * SLIDE_FRACTION * canvas.width}px)`,
      };

    case "pop":
      return {
        opacity: shown(progress),
        transform: `scale(${POP_FROM + (1 - POP_FROM) * progress})`,
      };

    case "wipe-up":
      /* A clip rather than a translate, so the element is revealed in place —
       * which is what makes it read as a reveal and not as a slide. It still
       * moves no ink: the glyphs stay exactly where they were measured. */
      return {
        opacity: progress > 0 ? 1 : 0,
        /* Clamped, unlike the transforms: a negative inset is not a valid
         * clip-path, so an `overshoot` personality cannot overshoot a wipe.
         * The element simply finishes revealed. */
        clipPath: `inset(${Math.max(away, 0) * 100}% 0 0 0)`,
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
  /**
   * The style's personality timing — Phase 16c. Defaulted rather than
   * required, because the default IS a personality (`precise`) and every
   * caller that has a style passes one; a required argument here would have
   * meant threading a style through the two tests that only care about the
   * shape of the curve.
   */
  timing?: MotionPersonalityTiming;
}): number {
  const {
    seconds,
    window: visible,
    hasEntrance,
    hasExit,
    timing = MOTION_PERSONALITY_TIMING.precise,
  } = args;
  const span = visible.to - visible.from;

  const wanted =
    (hasEntrance ? timing.entranceSeconds : 0) +
    (hasExit ? timing.exitSeconds : 0);
  /* SHORT_ELEMENTS_SCALE_THEIR_MOTION — never more than half the window each.
   * This matters more with a style than without: `calm` asks for 0.5s in and
   * 0.35s out, which is longer than a 0.8s element exists for. */
  const scale = wanted > span && wanted > 0 ? span / wanted : 1;
  const entranceSeconds = hasEntrance ? timing.entranceSeconds * scale : 0;
  const exitSeconds = hasExit ? timing.exitSeconds * scale : 0;

  if (seconds < visible.from || seconds > visible.to) return 0;

  const since = seconds - visible.from;
  const until = visible.to - seconds;

  const arriving =
    entranceSeconds > 0 ? ease(since / entranceSeconds, timing.easing) : 1;
  const leaving =
    exitSeconds > 0 ? easeOut(until / exitSeconds, timing.easing) : 1;

  return Math.min(arriving, leaving);
}

/**
 * SOURCE OF TRUTH KEYWORDS: ease, MOTION_EASINGS, OVERSHOOT_PASSES_ONE
 *
 * WHAT:  The three named curves a motion personality can ask for, on the way
 *        in.
 *
 * WHY:   OVERSHOOT_PASSES_ONE is the only one that needs explaining: it
 *        returns values slightly ABOVE 1 before settling, which is what makes
 *        `playful` look springy. Every consumer has to tolerate that —
 *        `animationStyle` clamps opacity with `shown()` and lets the
 *        transforms run past rest, which is exactly where the spring lives,
 *        and the wipe clamps its inset because a negative one is not valid
 *        CSS.
 *
 *        It is a closed-form polynomial rather than Remotion's `spring`, for
 *        DETERMINISTIC_MOTION: a spring is frame-rate dependent in a way that
 *        would make the same beat differ between a 30fps proxy and a 60fps
 *        render.
 * WHERE: elementProgress.
 */
function ease(t: number, easing: MotionEasing): number {
  const x = clamp01(t);
  switch (easing) {
    case "soft":
      /* Decelerates into place — the gentlest arrival. */
      return 1 - (1 - x) ** 3;
    case "sharp":
      /* Quicker off the mark and still settled: a quintic ease-out. */
      return 1 - (1 - x) ** 5;
    case "overshoot": {
      /* Back-out. 1.70158 is the standard constant for a ~10% overshoot;
       * larger values read as a bounce rather than as confidence. */
      const c = 1.70158;
      return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
    }
    default: {
      const exhaustive: never = easing;
      throw new Error(
        `[motion-scene/animation] Unknown easing ${String(exhaustive)}`,
      );
    }
  }
}

/* The same curves reversed, for a departure. `overshoot` is deliberately NOT
 * mirrored: an element springing past its resting place on the way OUT reads
 * as it being yanked, so a playful exit is simply a soft one. */
function easeOut(t: number, easing: MotionEasing): number {
  const x = clamp01(t);
  return easing === "sharp" ? x ** 5 : x ** 3;
}

/* Opacity never exceeds 1, whatever the curve did. */
function shown(progress: number): number {
  return clamp01(progress);
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
  personality,
  children,
}: {
  animation: SceneAnimation;
  exitAnimation: SceneAnimation;
  window: { from: number; to: number };
  canvas: { width: number; height: number };
  /** Seconds since the start of the beat — see TIME_IS_A_PROP. */
  seconds: number;
  /** The style's motion personality, which decides the durations and curve. */
  personality: MotionPersonality;
  children: ReactNode;
}) {
  if (seconds < visible.from || seconds > visible.to) return null;

  const timing = MOTION_PERSONALITY_TIMING[personality];
  const progress = elementProgress({
    seconds,
    window: visible,
    hasEntrance: animation !== "none",
    hasExit: exitAnimation !== "none",
    timing,
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
