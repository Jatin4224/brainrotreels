/**
 * SOURCE OF TRUTH KEYWORDS: Table, ONE_PLANE_FOR_THE_WHOLE_SCENE
 *
 * WHAT:  The room the scene happens in: a walnut tabletop seen at a slant, the
 *        pool of warm light the lamp throws on it, and the vignette that
 *        closes the rest of the room down to black.
 *
 * WHY:   ONE_PLANE_FOR_THE_WHOLE_SCENE. The walnut is a flat image rotated
 *        33° in the SAME perspective context the phone uses, so the grain
 *        narrows toward the back on exactly the plane the phone is lying on.
 *        A tabletop faked with a gradient would have to be re-faked every time
 *        the phone moved; this one is simply the surface, and everything else
 *        in the scene is positioned against it.
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
          background: "#120c08",
        }}
      >
        <div
          className="absolute"
          style={{
            left: -520,
            top: -700,
            width: 1600,
            height: 1900,
            transformOrigin: "800px 1158px",
            transform: "rotateX(33deg)",
            background: "url(/hero/walnut.webp) 0 0/1600px 2000px no-repeat",
            filter: "brightness(.58) saturate(1.08)",
          }}
        />

        {/* PATINA_IS_ON_THE_PLANE. A mottled, cloudy layer over the grain, on
            the SAME geometry as the walnut so it is foreshortened by the same
            33° rather than floating flat over a surface that recedes — the
            one detail that separates a texture ON the table from a texture in
            front of it. `overlay` keeps the plank seams and the lamp's pool
            reading through it while the blotches darken and warm the wood, so
            the tabletop stops being a flat swatch of grain. */}
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
              "url(/hero/table-patina.webp) 0 0/1600px 2000px no-repeat",
            mixBlendMode: "overlay",
            opacity: 0.75,
          }}
        />
      </div>

      {/* The pool of lamplight. `screen` so it ADDS to the wood instead of
          painting over it, which is the difference between a lit table and a
          table with a bright shape on it. */}
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
