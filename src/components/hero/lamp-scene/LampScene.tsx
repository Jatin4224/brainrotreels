/**
 * SOURCE OF TRUTH KEYWORDS: LampScene, ONE_RAF_LOOP, NEVER_SETSTATE_PER_FRAME,
 *   SCENE_IS_A_FIXED_COORDINATE_SPACE, PAUSE_WHEN_NOBODY_IS_WATCHING
 *
 * WHAT:  The lamp-lit Reels scene: a phone on a dark table under a swinging
 *        pendant lamp, scrolled by a 3D hand that reacts when it is poked or
 *        when somebody touches the screen it is watching. This file owns the
 *        scaling wrapper, the single animation loop, and every pointer route.
 *
 * WHY:   ONE_RAF_LOOP and NEVER_SETSTATE_PER_FRAME. Six things here move
 *        every frame — the lamp, the pool, the phone's shadow, the screen
 *        glare, the feed, and the hand — and they all derive from two
 *        numbers: the pendulum's angle and the timeline's clock. Driving them
 *        from one loop that writes straight to refs keeps them in lockstep
 *        and keeps React out of it entirely; driving them from state would
 *        re-render a 500-node subtree sixty times a second at the top of a
 *        landing page. React state here is TWO things: whether the GL hand
 *        arrived, and what the bubble says. Both change a handful of times in
 *        a session.
 *
 *        SCENE_IS_A_FIXED_COORDINATE_SPACE. Everything inside is laid out
 *        against a fixed 560×760, and the wrapper scales it to whatever column
 *        it lands in — so the composition never reflows, the hand never drifts
 *        off the phone at a new width, and the hero cannot shift while it
 *        loads. Pointer maths divides that scale back out before comparing
 *        anything.
 *
 *        PAUSE_WHEN_NOBODY_IS_WATCHING, which the hero needs more than most:
 *        this is the top of a long page, it holds a WebGL context, and
 *        without this it would render for the entire scroll and behind a
 *        hidden tab.
 * WHERE: The right column of the hero on src/app/(marketing)/page.tsx, loaded
 *        through LampSceneMount so three.js stays out of the page's bundle.
 */

"use client";

import { useAnimate, useReducedMotion } from "framer-motion";
import Image from "next/image";
import * as React from "react";

import { cn } from "@/lib/utils";

import { HandCanvas, useHandScene } from "./HandCanvas";
import { Lamp } from "./Lamp";
import { Phone } from "./Phone";
import { SpeechBubble } from "./SpeechBubble";
import { Table } from "./Table";
import {
  PHONE_OFFSET_REST,
  SCENE_H,
  SCENE_W,
  aimAngle,
  isOnScreen,
  lampShift,
  toScene,
  type PhoneOffset,
  type PhonePoint,
} from "./lib/geometry";
import {
  createPendulum,
  pushPendulum,
  releasePendulum,
  setGrabTarget,
  setHoverTarget,
  stepPendulum,
  type PendulumState,
} from "./lib/pendulum";
import {
  ANNOY_WINDOW_MS,
  FLINCH_MS,
  REACTION_SPECS,
  escalate,
  flinchDelta,
  reactionPose,
  type HandPose,
  type PoseDelta,
  type Reaction,
  type ReactionType,
} from "./lib/reactions";
import { STILL_FRAME, scrollTimeline } from "./lib/timeline";

export interface LampSceneProps {
  className?: string | undefined;
}

/**
 * Everything that changes between frames, in one mutable object behind one
 * ref. None of it belongs in React state: the loop writes most of it sixty
 * times a second, and no part of the tree renders differently because of it.
 */
interface SimState {
  pendulum: PendulumState;
  /** Timestamp of the previous frame, 0 when the clock needs restarting. */
  last: number;
  /** The scroll timeline's origin. A reaction pushes it forward by its own
   *  duration, which is what makes the feed resume where it stopped rather
   *  than where it would have got to. */
  t0: number;
  react: Reaction | null;
  flinchStart: number;
  overHand: boolean;
  phoneNow: PhoneOffset;
  /** The escalating-annoyance counter, and when it was last touched. */
  annoyCount: number;
  annoyLast: number;
  /** Poking alternates between the two reactions. */
  nextPoke: ReactionType;
  /** Set while the globe is being dragged, so the release is not a click. */
  dragged: boolean;
  paused: boolean;
}

export default function LampScene({ className }: LampSceneProps) {
  const reduced = useReducedMotion() ?? false;

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const lampRef = React.useRef<HTMLDivElement | null>(null);
  const poolRef = React.useRef<HTMLDivElement | null>(null);
  const phoneElRef = React.useRef<HTMLDivElement | null>(null);
  const shadowRef = React.useRef<HTMLDivElement | null>(null);
  const glareRef = React.useRef<HTMLDivElement | null>(null);
  const feedRef = React.useRef<HTMLDivElement | null>(null);
  const progressRef = React.useRef<HTMLDivElement | null>(null);
  const rippleRef = React.useRef<HTMLSpanElement | null>(null);

  /* The only three pieces of React state in the scene, all of them rare.
     `revealed` uncovers the scene once the hand has been DRAWN (not merely
     downloaded); `posterGone` drops the still once the crossfade is over. */
  const [revealed, setRevealed] = React.useState(false);
  const [posterGone, setPosterGone] = React.useState(false);
  const [bubbleText, setBubbleText] = React.useState("");

  /* Both paths end here: the hand is on screen, or it never will be (no
     WebGL, a dead context, an unparseable model) and the scene shows without
     one. Either way the viewer gets the live scene rather than a still. */
  const reveal = React.useCallback(() => setRevealed(true), []);

  React.useEffect(() => {
    if (!revealed) return;
    const t = window.setTimeout(() => setPosterGone(true), 420);
    return () => window.clearTimeout(t);
  }, [revealed]);

  /* Motion drives exactly one thing here: the panel shake on a swat. */
  const [shakeScope, animateShake] = useAnimate<HTMLDivElement>();

  /* The RAF loop and the pointer handlers all need the current setting, and
     none of them is allowed to re-subscribe when it changes. Synced in an
     effect, not during render. */
  const reducedRef = React.useRef(reduced);

  const sim = React.useRef<SimState>({
    pendulum: createPendulum(false),
    last: 0,
    t0: 0,
    react: null,
    flinchStart: 0,
    overHand: false,
    phoneNow: PHONE_OFFSET_REST,
    annoyCount: 0,
    annoyLast: 0,
    nextPoke: "swat",
    dragged: false,
    paused: false,
  });

  React.useEffect(() => {
    reducedRef.current = reduced;
    /* A fresh pendulum, because the starting swing is the one part of it the
       setting changes rather than scales. */
    sim.current.pendulum = createPendulum(reduced);
  }, [reduced]);

  const handRef = useHandScene({
    rootRef,
    canvasRef,
    reduced,
    onReady: reveal,
    onFailed: reveal,
  });

  /* ── Scaling ──────────────────────────────────────────────────────────
     The scene is laid out at exactly 560×760 and SCALED to its column; it is
     never reflowed, which is what keeps the hand on the phone at every width.

     Two things make the measurement honest. The wrapper carries the aspect
     ratio and the 560px cap in CSS, so it reserves the right box on the very
     first paint with no JS and no shift — and the scene inside is
     `overflow: hidden`-clipped, so its full-size 560px layout box cannot
     push the wrapper, the grid column, or the page wider than it should be.
     Measuring a wrapper the content itself had inflated was the bug this
     replaces: it read 560 at every width and so never scaled down at all,
     overflowing small viewports and stealing width from the hero's text
     column between 900 and 1240px.

     transform-origin is top LEFT rather than the spec's top center because
     the wrapper is now exactly the scaled scene's size: the scene fills it,
     and the wrapper is what gets centred (mx-auto). The result is identical
     and there is no second coordinate space to keep in step. */
  React.useEffect(() => {
    const wrap = wrapRef.current;
    const root = rootRef.current;
    if (!wrap || !root) return;

    const fit = () => {
      const w = wrap.clientWidth;
      if (!w) return;
      root.style.transform = `scale(${Math.min(1, w / SCENE_W)})`;
    };

    fit();
    if (typeof ResizeObserver !== "function") {
      window.addEventListener("resize", fit);
      return () => window.removeEventListener("resize", fit);
    }
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  /* ── Pause offscreen and in a hidden tab ─────────────────────────────── */
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let onScreen = true;
    let visible = !document.hidden;
    const sync = () => {
      const paused = !(onScreen && visible);
      sim.current.paused = paused;
      /* The frame clock is reset on resume, so a paused minute does not
         arrive as a single enormous dt. */
      if (!paused) sim.current.last = 0;
      /* The in-video CSS loops are not on the RAF loop, so they are paused
         by an attribute rather than by stopping to drive them. Written to
         the DOM rather than held in state: it is a per-scroll change on a
         subtree React has no other reason to re-render. */
      root.dataset["paused"] = paused ? "true" : "false";
    };

    const onVis = () => {
      visible = !document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVis);

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver(
        (entries) => {
          onScreen = entries.some((e) => e.isIntersecting);
          sync();
        },
        { rootMargin: "100px" },
      );
      io.observe(root);
    }

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
    };
  }, []);

  /* ── Reactions ────────────────────────────────────────────────────────
     Starting one freezes the scroll timeline where it is; when it ends, its
     whole duration is added to the origin so the swipe carries on from the
     exact frame it was interrupted at. */
  const startReaction = React.useCallback(
    (type: ReactionType, say: string, aim?: PhonePoint) => {
      const s = sim.current;
      const now = performance.now();
      /* Interrupting a live reaction: bank the time it had already paused
         before replacing it, or the feed jumps forward by that much. */
      if (s.react) s.t0 += now - s.react.t0;
      s.react = {
        type,
        t0: now,
        dur: REACTION_SPECS[type].dur,
        say,
        from: s.phoneNow,
        ...(aim ? { aim } : {}),
      };
      s.flinchStart = 0;
      setBubbleText(say);
    },
    [],
  );

  const poke = React.useCallback(() => {
    const s = sim.current;
    if (s.react) return;
    const type = s.nextPoke;
    s.nextPoke = type === "swat" ? "wag" : "swat";
    startReaction(type, REACTION_SPECS[type].say);
  }, [startReaction]);

  const ripple = React.useCallback(
    (p: PhonePoint) => {
      const el = rippleRef.current;
      if (!el?.animate) return;
      /* Screen-local: the ripple lives inside the screen, which starts 6px
         inside the phone's own space. */
      el.style.left = `${(p.px - 6).toFixed(1)}px`;
      el.style.top = `${(p.py - 6).toFixed(1)}px`;
      el.animate(
        reducedRef.current
          ? [{ opacity: 0.5 }, { opacity: 0 }]
          : [
              { transform: "scale(0.35)", opacity: 0.6 },
              { transform: "scale(1.5)", opacity: 0 },
            ],
        { duration: 520, easing: "cubic-bezier(.23,1,.32,1)" },
      );
    },
    [],
  );

  const touchScreen = React.useCallback(
    (p: PhonePoint) => {
      const s = sim.current;
      const now = performance.now();
      /* Annoyance decays: a touch after a quiet few seconds starts over. */
      if (now - s.annoyLast > ANNOY_WINDOW_MS) s.annoyCount = 0;
      s.annoyCount += 1;
      s.annoyLast = now;

      ripple(p);
      const next = escalate(s.annoyCount);
      startReaction(next.type, next.say, p);
    },
    [ripple, startReaction],
  );

  /* ── The one animation loop ──────────────────────────────────────────── */
  React.useEffect(() => {
    let raf = 0;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const s = sim.current;
      if (s.paused) return;

      const isReduced = reducedRef.current;
      const p = s.pendulum;

      /* Lamp. dt is clamped: a dropped frame must not launch the globe. */
      const dt = s.last ? Math.min((t - s.last) / 1000, 1 / 30) : 1 / 60;
      s.last = t;
      stepPendulum(p, dt, isReduced);

      const dx = lampShift(p.a);
      if (lampRef.current) {
        lampRef.current.style.transform = `rotate(${(-p.a).toFixed(3)}deg)`;
      }
      if (poolRef.current) {
        poolRef.current.style.transform = `translateX(${(dx * 2.1).toFixed(1)}px)`;
      }
      if (shadowRef.current) {
        shadowRef.current.style.transform = `translate3d(${(-dx * 0.18).toFixed(1)}px, 30px, 0.4px)`;
      }
      if (glareRef.current) {
        glareRef.current.style.left = `${(24 + dx * 0.55).toFixed(1)}px`;
      }

      /* Scroll timeline, frozen for the duration of any live reaction. */
      if (s.t0 === 0) s.t0 = t;
      let clock = t;
      if (s.react) {
        const el = t - s.react.t0;
        if (el >= s.react.dur) {
          s.t0 += s.react.dur; // resume exactly where it stopped
          s.react = null;
          setBubbleText("");
        } else {
          clock = s.react.t0;
        }
      }

      const reelH = feedRef.current
        ? feedRef.current.offsetHeight / 4
        : 508;
      const frame = isReduced
        ? STILL_FRAME
        : scrollTimeline(clock - s.t0, reelH);

      if (feedRef.current) {
        const y = -(frame.index * reelH + frame.feedOffset);
        feedRef.current.style.transform = `translateY(${y.toFixed(2)}px)`;
      }
      if (progressRef.current) {
        progressRef.current.style.transform = `scaleX(${frame.progress.toFixed(4)})`;
      }

      /* Reaction deltas on top of the timeline's base pose. */
      let delta: PoseDelta = {};
      if (s.react) {
        const e = (t - s.react.t0) / s.react.dur;
        delta = reactionPose(e, s.react, isReduced ? 0.35 : 1);

        /* The panel shake, once, at the moment the swat connects. */
        if (s.react.type === "swat" && !s.react.shook && e > 0.28) {
          s.react.shook = true;
          if (!isReduced && shakeScope.current) {
            void animateShake(
              shakeScope.current,
              { x: [0, -5, 4, -2, 0] },
              { duration: 0.32, ease: "easeOut" },
            );
          }
        }
      } else if (s.flinchStart) {
        const e = (t - s.flinchStart) / FLINCH_MS;
        if (e >= 1 || e < 0) s.flinchStart = 0;
        else delta = flinchDelta(e);
      }

      const phone = delta.phone ?? PHONE_OFFSET_REST;
      s.phoneNow = phone;
      if (phoneElRef.current) {
        phoneElRef.current.style.transform =
          `translate(${phone.dx.toFixed(2)}px, ${phone.dy.toFixed(2)}px) ` +
          `scale(0.78) translate(125px, 260px) ` +
          `rotate(${phone.rot.toFixed(3)}deg) translate(-125px, -260px)`;
      }

      const pose: HandPose = {
        k: frame.k,
        lift: frame.lift + (delta.lift ?? 0),
        ...(delta.back !== undefined ? { back: delta.back } : {}),
        ...(delta.lateral !== undefined ? { lateral: delta.lateral } : {}),
        ...(delta.yawOff !== undefined ? { yawOff: delta.yawOff } : {}),
        ...(delta.pitchOff !== undefined ? { pitchOff: delta.pitchOff } : {}),
        ...(delta.roll !== undefined ? { roll: delta.roll } : {}),
        ...(delta.aim ? { aim: delta.aim } : {}),
        phone,
      };

      handRef.current?.update(pose, { dx });
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animateShake, handRef, shakeScope]);

  /* ── Pointer routing ──────────────────────────────────────────────────
     One handler on the root decides what was touched: the hand first, then
     the phone's glass. The swing button is a real button and handles itself. */
  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button > 0) return;
      if ((e.target as HTMLElement).closest(".lampSwingBtn")) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const { x, y } = toScene(e.clientX, e.clientY, rect);

      const hand = handRef.current;
      if (hand?.hitTest(x, y)) {
        poke();
        return;
      }

      let p: PhonePoint | null = null;
      if (hand) {
        p = hand.toPhone(x, y, sim.current.phoneNow);
      } else if (x > 190 && x < 385 && y > 272 && y < 661) {
        /* No GL yet: a flat approximation of the screen's on-screen box, so
           the phone is still touchable while the model is in flight. */
        p = { px: ((x - 190) / 195) * 250, py: ((y - 272) / 389) * 520 };
      }

      if (p && isOnScreen(p)) touchScreen(p);
    },
    [handRef, poke, touchScreen],
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = sim.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const { x, y } = toScene(e.clientX, e.clientY, rect);

      const hand = handRef.current;
      if (hand) {
        const over = hand.hitTest(x, y);
        /* Ticklish: the flinch fires on the EDGE, not while hovering, so a
           cursor resting on the hand does not twitch it forever. */
        if (over && !s.overHand && !s.react) s.flinchStart = performance.now();
        s.overHand = over;
      }

      setHoverTarget(s.pendulum, aimAngle(x, y));
    },
    [handRef],
  );

  const onPointerLeave = React.useCallback(() => {
    const p = sim.current.pendulum;
    if (p.mode !== "held") releasePendulum(p);
  }, []);

  /* Grabbing the globe. The listeners go on the window, so a drag that
     leaves the scene keeps working until the pointer comes back up. */
  const onGrab = React.useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const root = rootRef.current;
      if (!root) return;

      const s = sim.current;
      s.pendulum.mode = "held";
      s.dragged = false;

      const move = (ev: PointerEvent) => {
        s.dragged = true;
        const rect = root.getBoundingClientRect();
        const { x, y } = toScene(ev.clientX, ev.clientY, rect);
        setGrabTarget(s.pendulum, aimAngle(x, y));
      };
      const up = () => {
        releasePendulum(s.pendulum);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [],
  );

  const onPush = React.useCallback(() => {
    const s = sim.current;
    /* A drag already moved it; the pointerup that ends a drag is not a tap. */
    if (s.dragged) {
      s.dragged = false;
      return;
    }
    pushPendulum(s.pendulum, reducedRef.current);
  }, []);


  return (
    <div
      ref={wrapRef}
      className={cn(
        "mx-auto w-full max-w-[560px] overflow-hidden",
        className,
      )}
      style={{ aspectRatio: `${SCENE_W} / ${SCENE_H}` }}
    >
      <div ref={shakeScope}>
        <div
          ref={rootRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          className="lampScene relative isolate overflow-hidden text-white"
          style={{
            width: SCENE_W,
            height: SCENE_H,
            borderRadius: 30,
            /* The same colour as the page outside the card, so the card has
               no background of its own — only the lamp, the surface it lights
               and the phone on it. */
            background: "var(--background)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
            transformOrigin: "top left",
          }}
        >
          {/* NOTHING_POPS_IN. The still of the scene at rest holds the frame
              until the 3D hand has actually been drawn once. It is the same
              composition, so the handover is a crossfade between two images
              of the same thing rather than a scene assembling itself in
              stages. It unmounts when the fade is over. */}
          {posterGone ? null : (
            <Image
              src="/hero/lamp-poster.webp"
              alt=""
              aria-hidden="true"
              priority
              width={SCENE_W}
              height={SCENE_H}
              className="absolute inset-0 h-full w-full"
            />
          )}

          <div
            className="absolute inset-0"
            style={{
              opacity: revealed ? 1 : 0,
              transition: reduced
                ? "opacity 120ms linear"
                : "opacity 340ms cubic-bezier(0.23, 1, 0.32, 1)",
            }}
          >
            <Table poolRef={poolRef} />
          <Phone
            phoneRef={phoneElRef}
            shadowRef={shadowRef}
            glareRef={glareRef}
            feedRef={feedRef}
            progressRef={progressRef}
            rippleRef={rippleRef}
          />

          <HandCanvas ref={canvasRef} />

          {/* Keyboard routes to the two interactions a pointer gets by
              aiming. They take no pointer events — the root's own handler
              owns that, and these would otherwise sit on top of the phone. */}
          <button
            type="button"
            aria-label="Poke the hand"
            onClick={poke}
            className="lampHitBtn pointer-events-none absolute border-0 bg-transparent p-0"
            style={{
              left: 318,
              top: 470,
              width: 242,
              height: 290,
              borderRadius: "60px 0 0 0",
            }}
          />
          <button
            type="button"
            aria-label="Touch the phone screen"
            onClick={() => touchScreen({ px: 90, py: 260 })}
            className="lampHitBtn pointer-events-none absolute border-0 bg-transparent p-0"
            style={{ left: 200, top: 300, width: 120, height: 260, borderRadius: 30 }}
          />

            <SpeechBubble text={bubbleText} />

            <Lamp groupRef={lampRef} onGrab={onGrab} onPush={onPush} />
          </div>
        </div>
      </div>
    </div>
  );
}
