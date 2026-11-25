/**
 * SOURCE OF TRUTH KEYWORDS: Table, LIGHT_IS_THE_ONLY_THING_LEFT, poolRef,
 *   lampSceneBg, hero-bg, vignette, light pool
 *
 * WHAT:  What the lamp DOES to the room: the pool of warm light it throws,
 *        which slides as the lamp swings, and the vignette that closes the
 *        rest of the card down to black.
 *
 * WHY:   LIGHT_IS_THE_ONLY_THING_LEFT. The room itself is no longer built
 *        here. It used to be a mottled texture rotated into the phone's 33°
 *        plane plus a radial haze faking the air around the bulb — two
 *        static fakes of a lit room, maintained by hand. The room is now one
 *        photographic backdrop on the card itself (`.lampSceneBg`, see
 *        globals.css), so everything static left this file and only the
 *        MOVING light stayed.
 *
 *        The pool has to be a layer rather than part of the backdrop because
 *        it TRACKS the lamp — it is the scene's largest cue that the globe is
 *        a light source, and it moves 2.1× the globe's own travel, which is
 *        the parallax of something lit from above. A baked-in pool would sit
 *        still while the lamp swung over it and kill the illusion outright.
 *
 *        Both layers are `screen` / pure black so they only ever add light or
 *        take it away. Neither paints a colour of its own over the backdrop.
 * WHERE: The back two layers of LampScene, under the phone.
 */

import * as React from "react";

export function Table({ poolRef }: { poolRef: React.Ref<HTMLDivElement> }) {
  return (
    <>
      {/* The pool of lamplight on the table. `screen` so it ADDS to the
          backdrop instead of painting over it, which is the difference
          between a lit table and a table with a bright shape on it. */}
      <div
        ref={poolRef}
        aria-hidden="true"
        className="absolute"
        style={{
          left: -120,
          right: -120,
          top: 40,
          height: 700,
          mixBlendMode: "screen",
          transform: "translateX(0px)",
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 40% 42% at 50% 50%, rgba(255,178,104,0.46) 0%, rgba(214,120,56,0.20) 40%, rgba(0,0,0,0) 74%)",
          }}
        />
      </div>

      {/* The card's own falloff to black. Lighter than it was (0.8 → 0.72):
          the backdrop arrives with a vignette already in it, and the old one
          stacked on top crushed the corners to flat black and ate the
          image's edges. It cannot go much lighter than this, though — the
          backdrop's corners are a warm black and the page's are a cool one,
          and without the falloff reaching them the card shows as a faintly
          brown rectangle on the page. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 78% 66% at 50% 46%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.72) 100%)",
        }}
      />
    </>
  );
}
