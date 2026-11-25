/**
 * SOURCE OF TRUTH KEYWORDS: Pendulum, LAMP_IS_A_SPRING, lampShift
 *
 * WHAT:  The hanging lamp's physics — a damped spring on one angle, with the
 *        three modes the pointer puts it in (free, leaning toward a hovering
 *        cursor, held in a drag).
 *
 * WHY:   LAMP_IS_A_SPRING. A lamp that animates along a keyframed path can be
 *        played but never INTERRUPTED: grab it mid-swing and it either snaps
 *        or finishes the curve it was on. A spring has no path, only a state,
 *        so the same two lines handle swinging in on load, leaning at a
 *        cursor, being dragged, being thrown, and being left alone — and every
 *        one of those can happen in the middle of another.
 *
 *        Stiffness and damping change with the mode rather than the target:
 *        held is stiff and heavily damped so the globe tracks the finger
 *        instead of wobbling under it, free is loose and barely damped so a
 *        throw rings out over several seconds.
 * WHERE: Owned by LampScene's RAF loop, which advances it once a frame and
 *        writes the angle to the lamp group, the light pool, the phone's cast
 *        shadow and the screen glare.
 */

import { clamp } from "./geometry";

export type PendulumMode = "free" | "hover" | "held";

export interface PendulumState {
  /** Angle in degrees; positive leans the globe to the right. */
  a: number;
  /** Angular velocity, in degrees per second. */
  w: number;
  target: number;
  mode: PendulumMode;
  /** Alternates, so repeated clicks throw the lamp the other way each time. */
  dir: 1 | -1;
}

/** The lean a hovering cursor is allowed to ask for. */
export const HOVER_LIMIT = 7;
/** The lean a DRAG is allowed to ask for — the hand is on it, so it goes further. */
export const GRAB_LIMIT = 24;

export function createPendulum(reduced: boolean): PendulumState {
  return {
    /* It swings into place when the page opens, which is the one piece of
       motion that introduces the lamp as a physical object. Reduced motion
       gets a lamp that is simply already still. */
    a: reduced ? 0 : 7,
    w: 0,
    target: 0,
    mode: "free",
    dir: 1,
  };
}

/**
 * One step of the spring. `dt` is seconds, already clamped by the caller — a
 * backgrounded tab resuming with a 4-second frame would otherwise integrate
 * the lamp into orbit.
 */
export function stepPendulum(
  p: PendulumState,
  dt: number,
  reduced: boolean,
): void {
  const k = p.mode === "held" ? 140 : 15;
  const base = p.mode === "held" ? 20 : p.mode === "hover" ? 2.4 : 0.42;
  /* Reduced motion keeps the lamp responsive but kills the ringing: the same
     spring, damped hard enough that it eases rather than swings. */
  const c = reduced ? Math.max(base, 9) : base;

  p.w += (-k * (p.a - p.target) - c * p.w) * dt;
  p.a += p.w * dt;
}

/** A click or Enter on the globe: a shove, alternating side each time. */
export function pushPendulum(p: PendulumState, reduced: boolean): void {
  p.dir = p.dir === 1 ? -1 : 1;
  p.w += p.dir * (reduced ? 12 : 38);
}

export function setHoverTarget(p: PendulumState, aimDeg: number): void {
  if (p.mode === "held") return;
  p.mode = "hover";
  p.target = clamp(aimDeg * 0.35, -HOVER_LIMIT, HOVER_LIMIT);
}

export function setGrabTarget(p: PendulumState, aimDeg: number): void {
  p.target = clamp(aimDeg, -GRAB_LIMIT, GRAB_LIMIT);
}

export function releasePendulum(p: PendulumState): void {
  p.mode = "free";
  p.target = 0;
}
