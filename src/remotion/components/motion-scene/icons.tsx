/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_ICON_PATHS, SceneIconGlyph, BUNDLED_GLYPH_ONLY,
 *   INLINE_SVG_NOT_AN_ICON_PACKAGE, STROKE_SCALES_WITH_THE_GLYPH
 *
 * WHAT:  The twelve glyphs an `icon` element may draw, as inline SVG path
 *        geometry on a 24×24 grid.
 *
 * WHY:   INLINE_SVG_NOT_AN_ICON_PACKAGE. The app's chrome uses
 *        `@hugeicons/react`, and this does not — deliberately. These pixels are
 *        composited into an MP4 by headless Chrome, where a React icon
 *        component is one more module that has to resolve inside the Remotion
 *        bundle and one more thing that can render as an empty box without
 *        failing the render. A beat whose only element is a missing icon is a
 *        blank frame in a paid video, and that is the failure mode this phase
 *        is built around. Twelve `d` attributes have no resolution step and no
 *        version to drift.
 *
 *        BUNDLED_GLYPH_ONLY, the sibling of BUNDLED_FONT_ONLY: the keys here
 *        are exactly `SCENE_ICONS`, so a `Record` — not a `Partial<Record>` —
 *        and the type system refuses a new icon name until it has geometry.
 *        That is the opposite choice from the render registry's
 *        UNKNOWN_DRAWS_NOTHING, and for a reason: an unknown RENDER KIND comes
 *        from a document written by a newer release and must degrade, while an
 *        icon name comes from this app's own closed enum and a missing one is
 *        a bug nobody should be able to ship.
 *
 *        STROKE_SCALES_WITH_THE_GLYPH — the stroke is in the 24-unit user
 *        space and the SVG is sized in canvas pixels, so the line weight stays
 *        proportional at every resolution rather than becoming a hairline at
 *        4K.
 *
 *        Line geometry rather than filled shapes, so one `currentColor` stroke
 *        picks up the palette and a tone without a second fill colour to keep
 *        legible.
 * WHERE: The `Icon` primitive in structure.tsx.
 */

import type { SceneIcon } from "@/lib/types/scene";

/**
 * SOURCE OF TRUTH KEYWORDS: SCENE_ICON_PATHS
 *
 * Every glyph as one or more subpaths on a 24×24 grid. Closed `Record`, so
 * adding a name to SCENE_ICONS without geometry is a compile error.
 */
export const SCENE_ICON_PATHS: Readonly<Record<SceneIcon, readonly string[]>> =
  {
    check: ["M4 12.5 L9.5 18 L20 6.5"],
    cross: ["M6 6 L18 18", "M18 6 L6 18"],
    alert: ["M12 3 L22.5 20.5 L1.5 20.5 Z", "M12 9.5 V14.5", "M12 17.5 V17.6"],
    "arrow-up": ["M12 20.5 V4", "M4.5 11.5 L12 4 L19.5 11.5"],
    "arrow-down": ["M12 3.5 V20", "M4.5 12.5 L12 20 L19.5 12.5"],
    clock: ["M12 3 A9 9 0 1 1 11.99 3 Z", "M12 7 V12.3 L16.2 14.6"],
    user: ["M12 4 A4 4 0 1 1 11.99 4 Z", "M4.5 21 A7.5 7.5 0 0 1 19.5 21"],
    chart: ["M3 20.5 H21", "M7 20.5 V12", "M12 20.5 V5.5", "M17 20.5 V15"],
    bulb: [
      "M12 3 A5.5 5.5 0 0 1 15 13.2 V15.5 H9 V13.2 A5.5 5.5 0 0 1 12 3 Z",
      "M9.5 18.5 H14.5",
      "M10.5 21 H13.5",
    ],
    lock: ["M4.5 10.5 H19.5 V21 H4.5 Z", "M8 10.5 V7 A4 4 0 0 1 16 7 V10.5"],
    spark: ["M12 2.5 L14.2 9.8 L21.5 12 L14.2 14.2 L12 21.5 L9.8 14.2 L2.5 12 L9.8 9.8 Z"],
    globe: [
      "M12 3 A9 9 0 1 1 11.99 3 Z",
      "M3 12 H21",
      "M12 3 A13 13 0 0 1 12 21 A13 13 0 0 1 12 3",
    ],
  };

/**
 * SOURCE OF TRUTH KEYWORDS: SceneIconGlyph, STROKE_SCALES_WITH_THE_GLYPH
 *
 * WHAT:  One glyph, drawn to fill a square of `size` pixels.
 * WHY:   `currentColor` rather than a colour prop, so the caller sets the
 *        colour once on a wrapper and a label beside the icon cannot end up a
 *        different shade from it.
 * WHERE: The `Icon` primitive.
 */
export function SceneIconGlyph({
  icon,
  size,
}: {
  icon: SceneIcon;
  size: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      /* Decorative: the element's own label carries the meaning, and a render
       * has no assistive technology reading it anyway. */
      aria-hidden
    >
      {SCENE_ICON_PATHS[icon].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
