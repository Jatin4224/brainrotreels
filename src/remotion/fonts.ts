/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: loadRenderFonts, RENDER_FONT_FAMILY,
 *   BUNDLED_FONT_ONLY, FONT_BLOCKS_THE_FIRST_FRAME, delayRender, staticFile
 *
 * WHAT:  Loads the render's one font family from `public/fonts/` and blocks the
 *        first frame until it is ready.
 * WHY:   BUNDLED_FONT_ONLY. There is no network font here and there must never
 *        be one. Two separate failures follow from a remote font:
 *
 *          - A font that 404s or times out mid-render produces a video that is
 *            SILENTLY WRONG — every text element falls back to a different
 *            face, the render succeeds, and nobody notices until a customer
 *            does. That is the worst failure mode a paid render has.
 *          - Phase 04 renders on Lambda, where outbound access to a font CDN
 *            is one more thing that can be unavailable per invocation, so the
 *            same document would render differently depending on the weather.
 *
 *        FONT_BLOCKS_THE_FIRST_FRAME: `delayRender()` is the mechanism that
 *        makes this correct rather than merely likely. Remotion will otherwise
 *        screenshot frame 0 while the face is still loading, so the first
 *        frames of a render use the fallback and the rest do not — a one-frame
 *        flash of the wrong typeface. The handle is cleared in both the
 *        success and the failure path, because an uncleared handle hangs the
 *        render forever at 0%.
 *
 *        The files are COPIES in `public/fonts/`, taken from the pinned
 *        `@fontsource/geist-sans` dev dependency rather than downloaded. That
 *        keeps the font identical to the one `next/font/google` self-hosts for
 *        the app UI (Geist), so a caption in the editor preview and the same
 *        caption in the finished video are the same typeface — and it keeps
 *        the asset versioned by the lockfile instead of by whoever last
 *        fetched it.
 * WHERE: Called once at the top of TimelineRenderer. The family name is read
 *        by every text-drawing component (TextOverlay today, Captions in
 *        Phase 08).
 */

import { continueRender, delayRender, staticFile } from "remotion";

import { RENDER_FONT_FACES, RENDER_FONT_FAMILY } from "@/lib/captions/fonts";

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_FONT_FAMILY
 *
 * Re-exported from src/lib/captions/fonts.ts, which OWNS the name — see
 * CAPTIONS_STAY_PURE there. Every text-drawing component reads it from
 * either module; the definition is kept out of this file so the caption
 * library can be imported without pulling the `remotion` package.
 */
export { RENDER_FONT_FAMILY };

/* The face list moved to src/lib/captions/fonts.ts in Phase 16c, because a
 * SECOND loader now needs it: the app's own preview surfaces register the same
 * family without Remotion. Two copies of this list is how one loader ends up a
 * weight behind the other. Grep ONE_FACE_LIST_TWO_LOADERS. */
const FACES = RENDER_FONT_FACES;

/* Module-scoped so a composition that mounts repeatedly — which the Player
 * does on every prop change — registers each face once. `document.fonts.add`
 * is idempotent per FontFace object, not per family, so without this the set
 * grows on every remount. */
let loaded = false;

/**
 * SOURCE OF TRUTH KEYWORDS: loadRenderFonts, FONT_BLOCKS_THE_FIRST_FRAME
 *
 * WHAT:  Registers every face and holds the render until they are usable.
 * WHY:   Safe to call on every mount: it is a no-op after the first. It is
 *        also safe OUTSIDE a browser — Remotion's own server-side bundling
 *        step evaluates module bodies, and `document` does not exist there, so
 *        the guard is what stops the composition failing to import.
 * WHERE: TimelineRenderer's body.
 */
export function loadRenderFonts(): void {
  if (loaded) return;
  if (typeof document === "undefined" || typeof FontFace === "undefined")
    return;
  loaded = true;

  const handle = delayRender(`Loading ${RENDER_FONT_FAMILY}`);

  Promise.all(
    FACES.map(async ({ weight, file }) => {
      const face = new FontFace(
        RENDER_FONT_FAMILY,
        `url(${staticFile(file)})`,
        {
          weight,
          style: "normal",
        },
      );
      await face.load();
      document.fonts.add(face);
    }),
  )
    .then(() => continueRender(handle))
    .catch((error: unknown) => {
      /* Continue rather than hang. A render with the wrong typeface is a bad
       * outcome; a render stuck at 0% until a Lambda timeout is a worse one,
       * and it is the one that costs money without producing anything. The log
       * line is what makes the bad outcome diagnosable. */
      console.error(
        `[remotion/fonts] Could not load ${RENDER_FONT_FAMILY}:`,
        error,
      );
      continueRender(handle);
    });
}
