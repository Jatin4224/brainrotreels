/**
 * SOURCE OF TRUTH KEYWORDS: Phone, PHONE_IS_CSS_3D, THE_GLARE_IS_THE_LAMP
 *
 * WHAT:  The phone lying on the table: its body as a stack of CSS 3D layers,
 *        the iOS furniture on its screen (status bar, island, Reels header,
 *        progress bar, tab bar), the film grain, the glass, and the lamp's
 *        reflection in it.
 *
 * WHY:   PHONE_IS_CSS_3D. The phone is built from a handful of planes at
 *        different `translateZ` inside the same tilted 3D context as the
 *        table, which is what gives it real thickness: the side band shows at
 *        the edges, the frame sits proud of the back, and the whole thing
 *        parallaxes correctly because the browser is doing the perspective,
 *        not a drop shadow pretending to.
 *
 *        THE_GLARE_IS_THE_LAMP. Three things on this phone move when the lamp
 *        swings — the cast shadow, the screen glare and the light pool behind
 *        it — and they are the reason the lamp feels like it is LIGHTING the
 *        scene rather than hanging in front of it. Their refs are handed up to
 *        LampScene, which writes them from the pendulum every frame.
 * WHERE: Inside LampScene, in its own perspective context over the table.
 */

import * as React from "react";

import { ReelsFeed } from "./ReelsFeed";

/**
 * The six elements LampScene's RAF loop writes to every frame. They are
 * separate props rather than one object because a ref reached through a
 * property is a ref READ during render, which is the thing the React
 * Compiler's rules — rightly — will not allow.
 */
export interface PhoneProps {
  /** The phone wrapper, moved by the "pull" reaction. */
  phoneRef: React.Ref<HTMLDivElement>;
  /** The cast shadow, which slides opposite the lamp. */
  shadowRef: React.Ref<HTMLDivElement>;
  /** The lamp's reflection on the glass. */
  glareRef: React.Ref<HTMLDivElement>;
  /** The feed column, driven by the scroll timeline. */
  feedRef: React.Ref<HTMLDivElement>;
  /** The progress bar's fill. */
  progressRef: React.Ref<HTMLDivElement>;
  /** The touch ripple. */
  rippleRef: React.Ref<HTMLSpanElement>;
}

function StatusBar() {
  return (
    <div className="absolute inset-x-0 top-0 flex h-10 items-center justify-between pl-[26px] pr-[22px] text-[13px] font-semibold tracking-[-0.01em]">
      <span>9:41</span>
      <span className="flex items-center gap-[5px]">
        <svg width="16" height="11" viewBox="0 0 16 11" fill="#fff">
          <rect x="0" y="7" width="3" height="4" rx="1" />
          <rect x="4.3" y="5" width="3" height="6" rx="1" />
          <rect x="8.6" y="2.5" width="3" height="8.5" rx="1" />
          <rect x="12.9" y="0" width="3" height="11" rx="1" />
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11" fill="#fff">
          <path d="M7.5 2.3c2.1 0 4 .8 5.4 2.1l1.1-1.1A9.2 9.2 0 0 0 7.5.7 9.2 9.2 0 0 0 1 3.3l1.1 1.1a7.7 7.7 0 0 1 5.4-2.1zm0 3.1c1.3 0 2.5.5 3.3 1.3l1.1-1.1A6.3 6.3 0 0 0 7.5 3.8c-1.7 0-3.3.7-4.4 1.8l1.1 1.1c.8-.8 2-1.3 3.3-1.3zm0 3.1c.5 0 .9.2 1.2.5L7.5 10.2 6.3 9c.3-.3.7-.5 1.2-.5z" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12">
          <rect
            x="0.5"
            y="0.5"
            width="21"
            height="11"
            rx="3.5"
            fill="none"
            stroke="#fff"
            strokeOpacity=".45"
          />
          <rect x="2" y="2" width="15" height="8" rx="2" fill="#fff" />
          <path
            d="M23 4v4c.8-.3 1.4-1 1.4-2s-.6-1.7-1.4-2z"
            fill="#fff"
            fillOpacity=".5"
          />
        </svg>
      </span>
    </div>
  );
}

function TabBar() {
  return (
    <div className="absolute inset-x-0 bottom-0 box-border flex h-[50px] items-center justify-between bg-black px-6 pb-3">
      <svg
        width="23"
        height="23"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinejoin="round"
      >
        <path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z" />
      </svg>
      <svg
        width="23"
        height="23"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m20 20-4.6-4.6" />
      </svg>
      <svg
        width="23"
        height="23"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path d="M12 8v8M8 12h8" />
      </svg>
      {/* Reels, filled: the tab the phone is actually on. */}
      <svg width="23" height="23" viewBox="0 0 24 24" fill="#fff">
        <path d="M7 2.5h10A4.5 4.5 0 0 1 21.5 7v10a4.5 4.5 0 0 1-4.5 4.5H7A4.5 4.5 0 0 1 2.5 17V7A4.5 4.5 0 0 1 7 2.5zm-2.6 6v8.5A2.6 2.6 0 0 0 7 19.6h10a2.6 2.6 0 0 0 2.6-2.6V8.5zm3.1-4.1L9.8 7h3.3L10.8 4.4zm5.3 0L15.1 7h4.4a2.6 2.6 0 0 0-2.5-2.6zM10 10.5v6.5l5.6-3.2z" />
      </svg>
      <span
        className="size-6 rounded-full"
        style={{ background: "#f06a35", boxShadow: "0 0 0 1.5px #fff" }}
      />
      <span className="absolute bottom-1.5 left-1/2 -ml-12 h-1 w-24 rounded bg-white" />
    </div>
  );
}

/** One of the three machined buttons on the phone's metal edge. */
function SideButton({ style }: { style: React.CSSProperties }) {
  return (
    <span
      className="absolute"
      style={{
        width: 3,
        borderRadius: 2,
        background: "linear-gradient(#5e554b, #2a2622)",
        transform: "translateZ(5px)",
        ...style,
      }}
    />
  );
}

export function Phone({
  phoneRef,
  shadowRef,
  glareRef,
  feedRef,
  progressRef,
  rippleRef,
}: PhoneProps) {
  const grainId = React.useId().replace(/:/g, "");

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{ perspective: "1400px", perspectiveOrigin: "280px 170px" }}
    >
      {/* The tilted table plane the phone lies in — the SAME plane the walnut
          is drawn on, so the phone is on the table rather than over it. */}
      <div
        className="absolute"
        style={{
          left: 82,
          top: 252,
          width: 396,
          height: 412,
          transform: "rotateX(33deg)",
          transformStyle: "preserve-3d",
        }}
      >
        <div
          ref={phoneRef}
          className="absolute"
          style={{
            left: 100,
            top: 0,
            width: 250,
            height: 520,
            transform: "scale(0.78)",
            transformOrigin: "0 0",
            transformStyle: "preserve-3d",
          }}
        >
          {/* Cast shadow — the big soft one, which slides with the lamp. */}
          <div
            ref={shadowRef}
            className="absolute"
            style={{
              inset: "-14px -10px -40px -10px",
              borderRadius: 60,
              background: "rgba(0,0,0,0.62)",
              filter: "blur(26px)",
              transform: "translate3d(0px, 30px, 0.4px)",
            }}
          />
          {/* Contact shadow — the hard one directly under the body, which does
              not move, because the phone is not moving relative to the table. */}
          <div
            className="absolute"
            style={{
              inset: 2,
              borderRadius: 46,
              background: "rgba(0,0,0,0.92)",
              filter: "blur(5px)",
              transform: "translate3d(0, 6px, 0.5px)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              borderRadius: 46,
              background: "#0b0a09",
              transform: "translateZ(2px)",
            }}
          />
          {/* The side band, visible as the metal edge at the phone's sides. */}
          <div
            className="absolute inset-0"
            style={{
              borderRadius: 46,
              background:
                "linear-gradient(90deg, #6a6156 0%, #2b2620 18%, #141210 50%, #2b2620 82%, #5e564c 100%)",
              transform: "translateZ(6px)",
            }}
          />
          <div
            className="absolute inset-0 box-border"
            style={{
              borderRadius: 46,
              padding: 6,
              background:
                "linear-gradient(180deg, #8a7e70 0%, #3a342e 6%, #1a1714 30%, #0f0e0c 70%, #24201c 100%)",
              boxShadow:
                "inset 0 0 0 1px rgba(255,230,195,0.35), inset 0 0 0 2.5px #000",
              transform: "translateZ(9px)",
            }}
          >
            <div
              className="relative h-full w-full overflow-hidden text-white"
              style={{ borderRadius: 40, background: "#000" }}
            >
              <ReelsFeed ref={feedRef} />

              {/* Film grain, over the video and under the UI — the one layer
                  that makes an SVG read as footage rather than as a drawing. */}
              <svg
                className="absolute inset-0 h-full w-full"
                style={{ opacity: 0.16, mixBlendMode: "overlay" }}
              >
                <filter id={grainId}>
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency="1.1"
                    numOctaves={2}
                  />
                  <feColorMatrix type="saturate" values="0" />
                </filter>
                <rect width="100%" height="100%" filter={`url(#${grainId})`} />
              </svg>

              <StatusBar />

              <div
                className="absolute left-1/2 top-[9px] -ml-[42px] h-6 w-[84px] rounded-[20px] bg-black"
              >
                <span
                  className="absolute right-2.5 top-[7px] size-2.5 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle at 35% 35%, #2b3a55, #0a0d14 70%)",
                  }}
                />
              </div>

              <div className="absolute inset-x-4 top-[46px] flex items-center justify-between">
                <span className="flex items-center gap-1 text-[21px] font-bold tracking-[-0.02em]">
                  Reels
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
                  <circle cx="12" cy="12.5" r="3.6" />
                </svg>
              </div>

              <div
                className="absolute inset-x-0 bottom-[50px] h-0.5"
                style={{ background: "rgba(255,255,255,0.25)" }}
              >
                <div
                  ref={progressRef}
                  className="h-full w-full bg-white"
                  style={{
                    transformOrigin: "0 50%",
                    transform: "scaleX(0)",
                  }}
                />
              </div>

              <TabBar />

              <span
                ref={rippleRef}
                className="pointer-events-none absolute left-0 top-0 size-11 rounded-full opacity-0"
                style={{
                  margin: "-22px 0 0 -22px",
                  background: "rgba(255,255,255,0.42)",
                  boxShadow: "0 0 0 1px rgba(255,255,255,0.6)",
                }}
              />

              <div
                className="absolute inset-0"
                style={{
                  borderRadius: 40,
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 30%)",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
                }}
              />
              {/* The lamp, reflected. It slides as the globe swings. */}
              <div
                ref={glareRef}
                className="absolute rounded-full"
                style={{
                  top: -40,
                  left: 24,
                  width: 200,
                  height: 160,
                  background:
                    "radial-gradient(closest-side, rgba(255,236,206,0.40), rgba(255,220,170,0.10) 60%, transparent)",
                  mixBlendMode: "screen",
                }}
              />
            </div>
          </div>

          {/* Side buttons, on the body's own edge — inside the wrapper, so
              they travel with the phone when a reaction drags it away. */}
          <SideButton style={{ left: -3, top: 104, height: 30 }} />
          <SideButton style={{ left: -3, top: 150, height: 50 }} />
          <SideButton style={{ right: -3, top: 160, height: 74 }} />
        </div>
      </div>
    </div>
  );
}
