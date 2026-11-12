/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthShell, AuthShellProps, AUTH_SURFACE,
 *   marketing-canvas, AUTH_WEARS_THE_BRAND, SHELL_HAS_TWO_SHAPES,
 *   CTA_PINS_TO_THE_BOTTOM, LEGAL_IS_A_PAGE_FOOTER, PlatformLogo
 *
 * WHAT:  The chrome every (auth) route wears — the wordmark top-left, the
 *        page body (either a centred column or a form column beside a message
 *        panel), and the legal line along the bottom.
 *
 * WHY:   AUTH_SURFACE: NO card, panel, or border around the form — the auth
 *        screens sit directly on the page background, and this is the one
 *        file that decides that. They previously disagreed: sign-in, sign-up,
 *        forgot and reset were bare while accept-invitation drew its own
 *        <Card>, so the same flow changed shape halfway through. Owning the
 *        surface here is what keeps them identical; a form that reintroduces
 *        its own container is the bug this file exists to prevent. The only
 *        bordered thing on these screens is the message panel, which is not
 *        the form.
 *
 *        AUTH_WEARS_THE_BRAND is the change this rewrite records. These pages
 *        used to render in the PRODUCT's monochrome palette, so pressing "Get
 *        started" on a black-and-orange landing page dropped the visitor onto
 *        a plain white form — at the narrowest point of the funnel, which is
 *        the worst possible place to look like a different company. Applying
 *        `.marketing-canvas` (MARKETING_DESIGN_LANGUAGE in globals.css)
 *        re-points `--background`, `--card`, `--border` and friends for
 *        everything beneath, so the forms, inputs and buttons underneath keep
 *        using plain `bg-card` / `border-border` and simply come out in the
 *        brand palette. Nothing inside the product shifts by a pixel, because
 *        the class is applied HERE and not to `body`.
 *
 *        SHELL_HAS_TWO_SHAPES, chosen by whether `aside` was passed. ONE
 *        component, not two: sign-in and sign-up hand it the message panel;
 *        forgot-password, reset-password and accept-invitation hand it
 *        nothing and get the centred column they already had. A second
 *        `AuthSplitShell` would be the same header, footer and canvas
 *        maintained twice, which is how the halves of one flow start
 *        disagreeing again.
 *
 *        LEGAL_IS_A_PAGE_FOOTER, not a line under the submit button. It
 *        applies to every auth screen rather than to one form, so it belongs
 *        to the page; and on mobile, where the CTA pins to the bottom, a line
 *        owned by the form and a line owned by the page land in the same
 *        place anyway. Keeping it here means the forgot-password and
 *        reset-password screens cannot quietly lose it.
 *
 *        CTA_PINS_TO_THE_BOTTOM below `lg`: the body is a flex column that
 *        fills the viewport, so a form ending in `mt-auto` pushes its primary
 *        action to the bottom of the screen, where a thumb already is. That
 *        is what the mobile artboards show, and it falls out of the shell
 *        rather than every screen reimplementing it. The column still grows
 *        past the viewport when a form is taller than the screen, because the
 *        height is a MINIMUM.
 *
 *        The form column is `max-w-[26rem]` and CENTRED in its half at `lg`,
 *        which is what the desktop artboard shows: the fields are a column of
 *        controls, not a page, and letting them run to 500px beside a panel
 *        that is doing the talking makes the screen read as two paragraphs.
 *
 * WHERE: Used by every page under src/app/(auth)/. The sign-in and sign-up
 *        pages pass `aside={<AuthShowcase />}`.
 */

import * as React from "react";
import Link from "next/link";

import { PlatformLogo } from "@/components/global/platform-logo";
import { AUTH_LINK_CLASS } from "./auth-styles";
import { cn } from "@/lib/utils";

export interface AuthShellProps {
  children: React.ReactNode;
  /**
   * The desktop-only panel beside the form. Omit for a centred single column.
   * The panel hides itself below `lg` (see AuthShowcase), so the shell only
   * has to stop reserving a second grid track.
   */
  aside?: React.ReactNode;
  /**
   * The small tilted pill beside the wordmark on mobile, e.g. "41s to post".
   * Mobile-only: at `lg` the panel's headline already owns that glance.
   */
  headerTag?: string;
}

export function AuthShell({ children, aside, headerTag }: AuthShellProps) {
  const isSplit = aside !== undefined;

  return (
    /* DESKTOP_DOES_NOT_SCROLL, and only on the split screens: at `lg` the
       sign-in and sign-up pages are one viewport — the form on the left, the
       animated panel on the right — and a page that scrolls by forty pixels
       under a looping animation is what makes the animation look broken.
       The panel fits itself to whatever height it is given (see
       auth-showcase-canvas in globals.css), so the page height can be FIXED
       rather than a minimum.

       `auth-split-lock` and not `lg:h-svh lg:overflow-hidden`, because the
       lock has a FLOOR as well as a breakpoint — see the class in
       globals.css. A fixed height with a centred column that does not fit is
       not a page that scrolls, it is a page whose heading sits on top of the
       wordmark and whose submit button sits on top of the legal line, which
       is exactly what a short viewport (or browser zoom, which shortens the
       viewport the same way) produced here. Below the floor the page is a
       minimum height again and simply scrolls. */
    <div
      className={cn(
        "marketing-canvas auth-typography flex min-h-svh flex-col bg-background p-6 lg:p-8",
        isSplit ? "auth-split-lock" : "",
      )}
    >
      <header className="flex items-center justify-between gap-4">
        <PlatformLogo href="/" size="lg" />

        {headerTag ? (
          <span className="brutal-shadow inline-flex -rotate-[4deg] items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background lg:hidden">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-brand"
            />
            {headerTag}
          </span>
        ) : null}
      </header>

      {/* The body fills whatever the header and footer leave, which is what
          lets a form's `mt-auto` reach the bottom of the viewport on mobile.
          Two equal halves at `lg` — the panel is as wide as the whole form
          side, which is what makes it read as the other half of the page
          rather than as an illustration pinned beside the fields. */}
      <main
        className={cn(
          "flex w-full flex-1 pt-8",
          isSplit
            ? "flex-col gap-10 lg:grid lg:grid-cols-2 lg:items-stretch lg:gap-10 lg:pt-6"
            : "flex-col items-center justify-center",
        )}
      >
        <div
          className={cn(
            "flex w-full flex-1 flex-col",
            isSplit
              ? "auth-form-column max-w-[26rem] lg:mx-auto lg:justify-center"
              : "max-w-md flex-none",
          )}
        >
          {children}
        </div>

        {isSplit ? aside : null}
      </main>

      {/* LEGAL_IS_A_PAGE_FOOTER. `pt-8` keeps it off the mobile CTA that pins
          just above it; at `lg` it is simply the last line on the page. */}
      <footer className="pt-8 text-center text-xs text-muted-foreground sm:text-sm lg:text-left">
        By continuing you agree to our{" "}
        <Link href="/legal/terms" className={AUTH_LINK_CLASS}>
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className={AUTH_LINK_CLASS}>
          Privacy Policy
        </Link>
        .
      </footer>
    </div>
  );
}
