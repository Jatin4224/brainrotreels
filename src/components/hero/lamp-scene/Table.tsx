/**
 * SOURCE OF TRUTH KEYWORDS: Table, ONE_PLANE_FOR_THE_WHOLE_SCENE
 *
 * WHAT:  The room the scene happens in: a dark mottled tabletop seen at a
 *        slant, the pool of warm light the lamp throws on it, and the vignette
 *        that closes the rest of the room down to black.
 *
 * WHY:   ONE_PLANE_FOR_THE_WHOLE_SCENE. The surface is a flat image rotated
 *        33° in the SAME perspective context the phone uses, so it recedes on
 *        exactly the plane the phone is lying on. A tabletop faked with a
 *        gradient would have to be re-faked every time the phone moved; this
 *        one is simply the surface, and everything else in the scene is
 *        positioned against it.
 *
 *        THE_CARD_IS_NOT_A_ROOM. It used to be walnut planks, which read as a
 *        photograph of a table pasted behind the UI and fought the black page
 *        around it. The base is now the page's own `--background`, so the card
 *        has no edge of its own, and the only thing on it is the mottled
 *        texture catching the lamp.
 *
 *        The light pool is a separate layer rather than part of the texture
 *        because it has to TRACK the lamp — it is the scene's largest cue
 *        that the globe is a light source, and it moves 2.1× the globe's own
 *        travel, which is the parallax of something lit from above.
 * WHERE: The back two layers of LampScene, under the phone.
 */

import * as React from "react";

export function Table({ poolRef }: { poolRef: React.Ref<HTMLDivElement> }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          perspective: "1400px",
          perspectiveOrigin: "280px 170px",
          background: "var(--background)",
        }}
      >
        {/* TEXTURE_IS_ON_THE_PLANE. The tabletop itself — one mottled image
            rotated into the same 33° plane the phone lies on, so it is
            foreshortened WITH the phone rather than floating flat behind it.
            It is dark by design: the lamp's pool below is what finds the
            mottling, so the surface reads as lit rather than as a picture of
            a surface. */}
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            left: -520,
            top: -700,
            width: 1600,
            height: 1900,
            transformOrigin: "800px 1158px",
            transform: "rotateX(33deg)",
            background:
              "url(/hero/table-surface.webp) 0 0/1600px 2000px no-repeat",
          }}
        />
      </div>

      {/* AIR_AROUND_THE_BULB. A soft warm haze centred on the globe, in the
          card's own flat plane rather than the table's. With the planks gone
          the bulb had nothing above the table to light, so the top third went
          dead black and the lamp read as a sticker; this is the light in the
          air around it. `screen`, so it only ever adds. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          mixBlendMode: "screen",
          background:
            "radial-gradient(circle at 50% 27%, rgba(255,200,140,0.18), rgba(255,180,110,0.05) 38%, transparent 62%)",
        }}
      />

      {/* The pool of lamplight on the table. `screen` so it ADDS to the
          surface instead of painting over it, which is the difference between
          a lit table and a table with a bright shape on it. */}
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

      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 78% 66% at 50% 46%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.8) 100%)",
        }}
      />
    </>
  );
}
