/**
 * SOURCE OF TRUTH KEYWORDS: Lamp, THE_LAMP_IS_GRABBABLE, swing-btn
 *
 * WHAT:  The pendant lamp — halo, cord, fitting, glass globe — and the real
 *        button over the globe that makes it grabbable and keyboard-operable.
 *
 * WHY:   THE_LAMP_IS_GRABBABLE. The scene is decorative and almost all of it
 *        is `aria-hidden`, but a thing that LOOKS pullable and does nothing is
 *        worse than a thing that looks fixed. So the globe carries a genuine
 *        `<button>`: a pointer can drag it and throw it, Tab reaches it, and
 *        Enter swings it, which is the same affordance by a different route
 *        rather than a keyboard consolation prize.
 *
 *        The whole group rotates about (280, 0) — the point the cord is pinned
 *        to the ceiling — so one `rotate()` written by the pendulum swings the
 *        cord, the fitting, the globe and the halo together, as one object on
 *        a string. LampScene writes that transform; this file never animates.
 * WHERE: The front-most layer of LampScene, over the hand and the bubble —
 *        the lamp hangs between the viewer and the table.
 */

import * as React from "react";

export interface LampProps {
  groupRef: React.Ref<HTMLDivElement>;
  onGrab: React.PointerEventHandler<HTMLButtonElement>;
  onPush: React.MouseEventHandler<HTMLButtonElement>;
}

export function Lamp({ groupRef, onGrab, onPush }: LampProps) {
  return (
    <div
      ref={groupRef}
      className="absolute inset-x-0 top-0"
      style={{
        height: 330,
        transformOrigin: "280px 0",
        transform: "rotate(0deg)",
      }}
    >
      <div
        aria-hidden="true"
        className="absolute rounded-full"
        style={{
          left: 130,
          top: 70,
          width: 300,
          height: 300,
          background:
            "radial-gradient(closest-side, rgba(255,214,160,0.30), rgba(255,180,110,0.10) 55%, transparent)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute"
        style={{ left: 279, top: 0, width: 2, height: 172, background: "#050505" }}
      />
      <div
        aria-hidden="true"
        className="absolute"
        style={{
          left: 271,
          top: 164,
          width: 18,
          height: 24,
          borderRadius: "3px 3px 2px 2px",
          background:
            "linear-gradient(90deg, #0a0a0a, #3b3835 40%, #111 70%, #050505)",
          boxShadow: "0 2px 0 rgba(0,0,0,0.6)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute rounded-[50%]"
        style={{ left: 273, top: 160, width: 14, height: 8, background: "#2b2926" }}
      />
      <div
        aria-hidden="true"
        className="absolute rounded-full"
        style={{
          left: 236,
          top: 170,
          width: 88,
          height: 88,
          background:
            "radial-gradient(circle at 50% 60%, #fffcf4 0%, #fdf1dc 28%, #efd9b6 62%, #c9a983 100%)",
          boxShadow:
            "0 0 34px 10px rgba(255,222,170,0.40), 0 0 120px 40px rgba(255,186,110,0.16)",
        }}
      />
      <button
        type="button"
        aria-label="Swing the lamp"
        onPointerDown={onGrab}
        onClick={onPush}
        className="lampSwingBtn absolute border-0 bg-transparent p-0"
        style={{ left: 226, top: 150, width: 108, height: 118, borderRadius: 54 }}
      />
    </div>
  );
}
