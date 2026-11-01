/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: useRenderFonts, THE_PREVIEW_MUST_LOAD_THE_FACE,
 *   ONE_FACE_LIST_TWO_LOADERS, BUNDLED_FONT_ONLY, PREVIEW_IS_THE_RENDER
 *
 * WHAT:  Registers the bundled render faces in the BROWSER, so a preview that
 *        draws with `RENDER_FONT_FAMILY` gets the real typeface.
 *
 * WHY:   THE_PREVIEW_MUST_LOAD_THE_FACE. `RENDER_FONT_FAMILY` is a local name
 *        declared by a `FontFace` — it is not a lookup into whatever is
 *        installed, and it deliberately carries no fallback stack so a missing
 *        face is visible rather than "close enough". Until this module existed,
 *        the only thing that declared it was `src/remotion/fonts.ts`, which
 *        runs inside a Remotion bundle. Every preview surface in the app
 *        therefore asked for a family nothing had registered and got the
 *        browser's default serif: the caption gallery from Phase 08, and the
 *        motion gallery from Phase 16b.
 *
 *        For captions that was wrong but cosmetic — a style reviewed in the
 *        wrong typeface. For motion it is worse and is the reason this got
 *        fixed rather than noted: the overflow and overlap checks measure
 *        Geist's real glyph advances (REAL_ADVANCES_NOT_AN_ESTIMATE), so a
 *        preview drawing a different face shows text that has nothing to do
 *        with what was measured. DRAWN_IS_MEASURED, and PREVIEW_IS_THE_RENDER,
 *        are both false the moment the face is wrong.
 *
 *        It does NOT import `remotion`. That package's module body expects a
 *        Remotion bundle (CAPTIONS_STAY_PURE), and pulling it into an app route
 *        for the sake of a font loader is the thing every preview component in
 *        this folder is arranged to avoid. The face list is shared instead —
 *        ONE_FACE_LIST_TWO_LOADERS in src/lib/captions/fonts.ts.
 *
 *        Returns whether the faces are ready, so a caller can hold the first
 *        paint. That is the browser equivalent of FONT_BLOCKS_THE_FIRST_FRAME:
 *        without it a preview renders one frame in the fallback and then
 *        reflows, which in a motion preview reads as a flicker on every mount.
 * WHERE: `MotionPreview` and the caption preview card.
 */

import * as React from "react";

import { RENDER_FONT_FACES, RENDER_FONT_FAMILY } from "@/lib/captions/fonts";

/* Module-scoped, so the faces are registered once per page rather than once
 * per card: a gallery mounts a dozen previews and `document.fonts.add` is
 * idempotent per FontFace OBJECT, not per family, so without this the set
 * grows on every mount. */
let loading: Promise<void> | null = null;

function loadOnce(): Promise<void> {
  if (loading !== null) return loading;

  /* Guarded HERE rather than in the hook, so the hook's effect has exactly one
   * place it can settle from — an asynchronous one. Resolving synchronously
   * inside the effect body would be a cascading render for a value the
   * component could have started with. */
  if (typeof document === "undefined" || typeof FontFace === "undefined") {
    loading = Promise.resolve();
    return loading;
  }

  loading = Promise.all(
    RENDER_FONT_FACES.map(async ({ weight, file }) => {
      const face = new FontFace(RENDER_FONT_FAMILY, `url(/${file})`, {
        weight,
        style: "normal",
      });
      await face.load();
      document.fonts.add(face);
    }),
  ).then(() => undefined);

  return loading;
}

/**
 * SOURCE OF TRUTH KEYWORDS: useRenderFonts
 *
 * WHAT:  True once the render faces can be drawn with.
 * WHY:   Fails OPEN — on an error it reports ready and logs, rather than
 *        leaving a preview blank forever. The same trade `loadRenderFonts`
 *        makes for a render: text in the wrong face is a bad outcome, a
 *        surface stuck at nothing is a worse one, and the log line is what
 *        makes the bad outcome diagnosable.
 * WHERE: Any preview that draws with RENDER_FONT_FAMILY.
 */
export function useRenderFonts(): boolean {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    loadOnce()
      .catch((error: unknown) => {
        console.error(
          `[render-fonts] Could not load ${RENDER_FONT_FAMILY}:`,
          error,
        );
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
