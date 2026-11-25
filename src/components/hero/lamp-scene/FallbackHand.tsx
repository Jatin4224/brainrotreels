/**
 * SOURCE OF TRUTH KEYWORDS: FallbackHand, THERE_IS_ALWAYS_A_HAND
 *
 * WHAT:  A drawn hand in a cream knit sleeve, anchored at its fingertip, shown
 *        whenever the three.js hand is not on screen — before the model
 *        loads, on a machine with no WebGL, or when the GL context is lost.
 *
 * WHY:   THERE_IS_ALWAYS_A_HAND. The scene's whole claim is that something is
 *        SCROLLING this phone, and a hero that shows a phone scrolling itself
 *        for the two seconds before a 4.6MB model arrives has already made the
 *        wrong first impression. This hand costs nothing, ships in the HTML,
 *        and is driven by the SAME timeline as the real one, so the handover
 *        is a change of fidelity rather than a change of behaviour.
 *
 *        It is anchored at the fingertip (314, 505) for the same reason the 3D
 *        rig is: the thing that has to stay put is the point touching the
 *        glass, and everything else can hang off it.
 * WHERE: Rendered by LampScene under the canvas, hidden once `glReady`.
 */

import * as React from "react";

export const FallbackHand = React.forwardRef<HTMLDivElement>(
  function FallbackHand(_props, ref) {
    const uid = React.useId().replace(/:/g, "");

    return (
      <div
        ref={ref}
        aria-hidden="true"
        className="absolute"
        style={{ left: 314, top: 505, width: 0, height: 0, transformOrigin: "0 0" }}
      >
        <div
          className="absolute"
          style={{
            left: -8,
            top: 8,
            width: 150,
            height: 34,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.55)",
            filter: "blur(9px)",
            transform: "rotate(24deg)",
            transformOrigin: "0 0",
          }}
        />
        <svg
          width="360"
          height="380"
          viewBox="0 0 360 380"
          className="absolute"
          style={{
            left: -14,
            top: -63,
            overflow: "visible",
            transform: "rotate(22deg) scale(0.85)",
            transformOrigin: "14px 63px",
          }}
        >
          <defs>
            <radialGradient id={`${uid}-k`} cx="32%" cy="26%" r="85%">
              <stop offset="0" stopColor="#ffe4cb" />
              <stop offset=".45" stopColor="#f6c29a" />
              <stop offset="1" stopColor="#cf8660" />
            </radialGradient>
            <linearGradient id={`${uid}-f`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffe2c6" />
              <stop offset=".5" stopColor="#f4bc93" />
              <stop offset="1" stopColor="#d18b64" />
            </linearGradient>
            <radialGradient id={`${uid}-s`} cx="30%" cy="18%" r="90%">
              <stop offset="0" stopColor="#fdf6ec" />
              <stop offset=".5" stopColor="#ece0cf" />
              <stop offset="1" stopColor="#b8a690" />
            </radialGradient>
          </defs>
          <path
            d="M212 186 C 262 164, 332 196, 386 262 L 392 420 L 252 420 C 222 342, 196 262, 212 186 Z"
            fill={`url(#${uid}-s)`}
          />
          <path
            d="M236 230 C 270 222, 310 240, 340 270 M246 270 C 280 262, 318 282, 346 310 M256 312 C 290 306, 324 324, 352 350"
            stroke="#cdbfac"
            strokeWidth="2"
            fill="none"
            opacity=".55"
          />
          <rect
            x="116"
            y="138"
            width="98"
            height="40"
            rx="20"
            fill={`url(#${uid}-f)`}
            transform="rotate(-8 165 158)"
          />
          <ellipse cx="214" cy="110" rx="80" ry="72" fill={`url(#${uid}-k)`} />
          <rect
            x="160"
            y="156"
            width="66"
            height="32"
            rx="16"
            fill={`url(#${uid}-f)`}
            stroke="#c47c58"
            strokeOpacity=".3"
          />
          <rect
            x="150"
            y="125"
            width="76"
            height="36"
            rx="18"
            fill={`url(#${uid}-f)`}
            stroke="#c47c58"
            strokeOpacity=".3"
          />
          <rect
            x="140"
            y="93"
            width="82"
            height="38"
            rx="19"
            fill={`url(#${uid}-f)`}
            stroke="#c47c58"
            strokeOpacity=".3"
          />
          <rect x="14" y="40" width="192" height="46" rx="23" fill={`url(#${uid}-f)`} />
          <ellipse cx="34" cy="66" rx="17" ry="17" fill="#e9a57c" opacity=".45" />
          <ellipse cx="32" cy="52" rx="12" ry="7.5" fill="#fff0e4" opacity=".85" />
          <path
            d="M92 50 q6 13 0 26 M138 50 q6 13 0 26"
            stroke="#c47c58"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
            opacity=".55"
          />
          <ellipse
            cx="190"
            cy="78"
            rx="38"
            ry="13"
            fill="#fff"
            opacity=".28"
            transform="rotate(-12 190 78)"
          />
          <ellipse cx="80" cy="47" rx="40" ry="5" fill="#fff" opacity=".3" />
          {/* The knit sleeve, same cream as the 3D one's. */}
          <path
            d="M204 178 C 240 160, 302 174, 352 218"
            stroke="#f3ead9"
            strokeWidth="30"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M214 170 l-4 18 M232 164 l-3 19 M250 162 l-2 19 M268 164 l0 19 M286 168 l2 19 M304 175 l3 18 M322 185 l4 17 M338 198 l5 15"
            stroke="#d6c9b5"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  },
);
