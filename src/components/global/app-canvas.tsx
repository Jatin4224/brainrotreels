/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AppCanvasBodyClass, APP_CANVAS_ON_BODY,
 *   PORTALS_ESCAPE_THE_CANVAS, app-canvas, APP_DESIGN_LANGUAGE
 *
 * WHAT:  Puts the `app-canvas` palette class on <body> for as long as a
 *        dashboard route is mounted, and takes it off on the way out.
 *
 * WHY:   PORTALS_ESCAPE_THE_CANVAS, and this component exists because of a
 *        real bug rather than a theory. `.app-canvas` was applied to the
 *        shell <div> in the dashboard layout, which styles everything in the
 *        React tree — but every Base UI overlay renders through a PORTAL into
 *        <body>, which is OUTSIDE that div. CSS custom properties cascade
 *        through the DOM, not through React, so each of those surfaces fell
 *        back to the root palette:
 *          - `--primary` reverted to the app's monochrome white, so the
 *            primary button in a dialog came out white-on-dark instead of
 *            brand orange;
 *          - `--primary-soft` is defined ONLY in `.app-canvas`, so it
 *            resolved to nothing and the tinted step discs painted no
 *            background at all;
 *          - `text-primary` icons went grey.
 *        Dialogs, dropdown menus, selects, popovers, sheets and tooltips were
 *        all affected — which is most of the dashboard's interactive surface.
 *
 *        ON <body>, NOT ON <html>, and not in the root layout: the marketing
 *        and auth routes have their own palettes (`.marketing-canvas`), and a
 *        permanent class would repaint them too. Scoping it to the mount of
 *        this component means the class is present exactly while a dashboard
 *        route is on screen and is removed the moment the customer navigates
 *        to a public page.
 *
 *        THE SHELL DIV KEEPS ITS CLASS TOO, deliberately — this does not
 *        replace it. The class on the div is in the SERVER-RENDERED HTML, so
 *        the page paints in the right palette on the very first frame; this
 *        effect runs after hydration and only has to be in place before the
 *        customer can open an overlay, which cannot happen earlier. Dropping
 *        the div's class and relying on this alone would reintroduce a flash
 *        of the wrong palette on every full page load.
 *
 *        It renders NOTHING. An element here would land inside the shell's
 *        flex layout and have to be styled out of the way; a class on body is
 *        the whole job.
 *
 * WHERE: Mounted once by src/app/(dashboard)/layout.tsx. The tokens it
 *        switches on live in `.app-canvas` in src/app/globals.css.
 */

import * as React from "react";

/** Kept in one place so the class name cannot drift from globals.css. */
export const APP_CANVAS_CLASS = "app-canvas";

export function AppCanvasBodyClass() {
  React.useEffect(() => {
    const { body } = document;
    /* Guarded rather than assumed: React 18 mounts effects twice in dev
     * StrictMode, and two layouts could briefly overlap during a client
     * navigation. `add` is idempotent, but the cleanup must not remove a
     * class a second instance still needs — so only the instance that ADDED
     * it removes it. */
    const alreadyPresent = body.classList.contains(APP_CANVAS_CLASS);
    if (!alreadyPresent) body.classList.add(APP_CANVAS_CLASS);
    return () => {
      if (!alreadyPresent) body.classList.remove(APP_CANVAS_CLASS);
    };
  }, []);

  return null;
}
