/**
 * SOURCE OF TRUTH KEYWORDS: Reaction, reactionPose, HandPose, THE_HAND_IS_A
 *   _CHARACTER, ANNOY_WINDOW_MS
 *
 * WHAT:  The hand's five reactions as pose curves — swat and wag when it is
 *        poked, nudge → pull → tap as somebody keeps touching the screen it is
 *        trying to watch — plus the escalation rule that picks between them.
 *
 * WHY:   THE_HAND_IS_A_CHARACTER. A hand that scrolls forever is a loop; a
 *        hand that NOTICES is a thing with an opinion, and the difference is
 *        almost entirely in whether the second touch gets a different answer
 *        than the first. So the touches are counted, the reaction escalates
 *        while they keep coming, and the count forgets itself after a few
 *        quiet seconds — annoyance that does not decay is just a state
 *        machine with a grudge.
 *
 *        Every curve returns DELTAS on top of whatever the scroll timeline was
 *        doing, never absolute poses, which is what lets a reaction interrupt
 *        a swipe mid-drag without the hand teleporting. `amp` scales all of
 *        them at once so reduced motion gets the same choreography at a third
 *        of the size rather than a different, flatter animation.
 * WHERE: Called by LampScene's RAF loop while a reaction is live; the result
 *        is merged into the pose handed to hand/handScene.ts, and the `phone`
 *        field is written to the phone element's transform.
 */

import {
  easeInOutCubic,
  clamp,
  lerp,
  PHONE_OFFSET_REST,
  type PhoneOffset,
  type PhonePoint,
} from "./geometry";

export type ReactionType = "swat" | "wag" | "nudge" | "pull" | "tap";

/** Where the fingertip is asked to go, and how strongly. */
export interface PoseAim extends PhonePoint {
  w: number;
}

/** Everything a reaction (or the idle timeline) can say about the hand. */
export interface HandPose {
  k: number;
  lift: number;
  back?: number;
  lateral?: number;
  yawOff?: number;
  pitchOff?: number;
  roll?: number;
  aim?: PoseAim;
  phone?: PhoneOffset;
}

/** The deltas a reaction contributes on top of the timeline's base pose. */
export type PoseDelta = Omit<HandPose, "k" | "lift"> & { lift?: number };

export interface Reaction {
  type: ReactionType;
  /** performance.now() when it started. */
  t0: number;
  dur: number;
  say: string;
  /** Where the phone was when it started, so it can ease back from there. */
  from: PhoneOffset;
  /** The point that was touched, for the reactions that look at it. */
  aim?: PhonePoint;
  /** Latch, so the panel shake fires once per swat. */
  shook?: boolean;
}

/** How long a touch stays "recent" for the purpose of escalating. */
export const ANNOY_WINDOW_MS = 6000;

export const REACTION_SPECS: Record<
  ReactionType,
  { dur: number; say: string }
> = {
  swat: { dur: 1150, say: "hey! I'm scrolling" },
  wag: { dur: 1400, say: "uh-uh, my reel" },
  nudge: { dur: 1500, say: "excuse me?" },
  pull: { dur: 3600, say: "get your own phone" },
  tap: { dur: 1800, say: "seriously?!" },
};

/** The nth touch inside the annoy window → what the hand does about it. */
export function escalate(n: number): { type: ReactionType; say: string } {
  if (n === 1) return { type: "nudge", say: REACTION_SPECS.nudge.say };
  if (n === 2) return { type: "pull", say: REACTION_SPECS.pull.say };
  /* Past the fourth it stops being a bit and starts being a warning. */
  return { type: "tap", say: n > 4 ? "okay. STOP." : REACTION_SPECS.tap.say };
}

/**
 * The pose at `e` (0→1) through a reaction. `amp` is 1 normally and 0.35 under
 * reduced motion: the same timings and the same shapes, smaller.
 */
export function reactionPose(
  e: number,
  r: Reaction,
  amp: number,
): PoseDelta {
  const t = clamp(e, 0, 1);
  /* `seg` re-bases the clock onto one phase of the curve: 0 before it, 0→1
     across it, 1 after. Reading a reaction is then just a list of phases. */
  const seg = (a: number, b: number) => clamp((t - a) / (b - a), 0, 1);

  const from = r.from ?? PHONE_OFFSET_REST;
  const mix = (A: PhoneOffset, B: PhoneOffset, v: number): PhoneOffset => ({
    dx: lerp(A.dx, B.dx, v),
    dy: lerp(A.dy, B.dy, v),
    rot: lerp(A.rot, B.rot, v),
  });

  /* Whatever a previous reaction left the phone doing, every reaction that is
     not itself about the phone puts it back over its own first 60%. */
  const settle = mix(from, PHONE_OFFSET_REST, easeInOutCubic(seg(0, 0.6)));

  if (r.type === "nudge") {
    /* Stop, glance at the finger that just arrived, brush it away, resume. */
    const a = easeInOutCubic(seg(0, 0.15));
    const b = easeInOutCubic(seg(0.15, 0.32));
    const c = easeInOutCubic(seg(0.32, 0.5));
    const d = easeInOutCubic(seg(0.5, 1));

    let lift = 26 * a;
    let w = 0;
    let lat = 0;
    let yaw = 8 * a;

    if (t >= 0.15) {
      w = b; // the fingertip starts travelling to where you touched
      lift = lerp(26, 6, b);
      yaw = lerp(8, 18, b);
    }
    if (t >= 0.32) {
      w = 1;
      lat = 70 * c; // and then sweeps sideways through it
      lift = lerp(6, 18, c);
      yaw = lerp(18, 34, c);
    }
    if (t >= 0.5) {
      w = 1 - d;
      lat = 70 * (1 - d);
      lift = 18 * (1 - d);
      yaw = 34 * (1 - d);
    }

    const aim: PoseAim = {
      px: r.aim?.px ?? 125,
      py: r.aim?.py ?? 260,
      w: w * amp,
    };
    return {
      lift: lift * amp,
      aim,
      lateral: lat * amp,
      yawOff: yaw * amp,
      phone: settle,
    };
  }

  if (r.type === "pull") {
    /* Puts a finger down and drags the whole phone out of your reach. The
       fingertip is pinned to the glass rather than to a scene position, so it
       travels WITH the phone — which is the detail that sells it as one
       object being moved rather than two things animating in parallel. */
    const P: PhoneOffset = { dx: 58 * amp, dy: 34 * amp, rot: 11 * amp };
    const a = easeInOutCubic(seg(0, 0.12));
    const b = easeInOutCubic(seg(0.12, 0.32));
    const d = easeInOutCubic(seg(0.75, 1));

    let phone = mix(from, P, b);
    let lift = -2 * a;
    let pitch = -5 * b;

    if (t >= 0.32 && t < 0.75) {
      /* Holding it there, with two small presses — impatience, not idleness. */
      lift = -2 + 2.5 * Math.abs(Math.sin(seg(0.4, 0.6) * Math.PI * 2));
    }
    if (t >= 0.75) {
      phone = mix(P, PHONE_OFFSET_REST, d);
      pitch = -5 * (1 - d);
      lift = -2 * (1 - d);
    }

    return { lift, pitchOff: pitch, phone };
  }

  if (r.type === "tap") {
    /* Impatient taps on its own screen, then a short frustrated shake. */
    const t1 = seg(0, 0.62);
    const sh = seg(0.62, 0.85);
    const d = easeInOutCubic(seg(0.85, 1));

    const taps = t < 0.62 ? 16 * Math.abs(Math.sin(t1 * Math.PI * 6)) : 0;
    const shake =
      t >= 0.62 && t < 0.85 ? 10 * Math.sin(sh * Math.PI * 8) * (1 - sh) : 0;
    const raise = t >= 0.62 ? 18 * (1 - d) : 0;

    return {
      lift: (taps + raise) * amp,
      yawOff: shake * amp,
      roll: shake * 0.6 * amp,
      phone: settle,
    };
  }

  if (r.type === "swat") {
    /* Yank back, swing across FAST, wobble, settle. The cube on the swing is
       the whole joke: everything else in this file eases, and this one phase
       does not, so it reads as a reflex rather than an animation. */
    const a = easeInOutCubic(seg(0, 0.15));
    const b = Math.pow(seg(0.15, 0.3), 3);
    const c = seg(0.3, 0.55);
    const d = easeInOutCubic(seg(0.55, 1));

    let back = 70 * a;
    let lift = 70 * a;
    let yaw = -22 * a;
    let pitch = 14 * a;
    let lat = 0;

    if (t >= 0.15) {
      back = lerp(70, 15, b);
      lift = lerp(70, 30, b);
      yaw = lerp(-22, 58, b);
      lat = lerp(0, -60, b);
      pitch = lerp(14, 4, b);
    }
    if (t >= 0.3) {
      yaw = 58 + 6 * Math.sin(c * Math.PI * 4) * (1 - c);
    }
    if (t >= 0.55) {
      back = 15 * (1 - d);
      lift = 30 * (1 - d);
      yaw = 58 * (1 - d);
      lat = -60 * (1 - d);
      pitch = 4 * (1 - d);
    }

    return {
      back: back * amp,
      lift: lift * amp,
      yawOff: yaw * amp,
      lateral: lat * amp,
      pitchOff: pitch * amp,
      phone: settle,
    };
  }

  /* wag: lift the finger toward the viewer and waggle it "no, no". */
  const a = easeInOutCubic(seg(0, 0.18));
  const w = seg(0.18, 0.72);
  const d = easeInOutCubic(seg(0.72, 1));
  const up = a * (1 - d);

  return {
    back: 8 * up * amp,
    lift: 95 * up * amp,
    lateral: -30 * up * amp,
    pitchOff: -42 * up * amp,
    yawOff: (6 + 20 * Math.sin(w * Math.PI * 6)) * up * amp,
    phone: settle,
  };
}

/** The hover flinch: a 380ms twitch, layered on top of whatever else is live. */
export const FLINCH_MS = 380;

export function flinchDelta(e: number): PoseDelta {
  const w = Math.sin(e * Math.PI);
  return {
    lift: 14 * w,
    back: 12 * w,
    roll: 7 * Math.sin(e * Math.PI * 3) * (1 - e),
  };
}
