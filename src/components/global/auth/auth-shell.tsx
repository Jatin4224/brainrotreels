/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthShell, AuthShellProps, AUTH_SURFACE,
 *   marketing-canvas, AUTH_WEARS_THE_BRAND, SHELL_HAS_TWO_SHAPES,
 *   CTA_PINS_TO_THE_BOTTOM, PlatformLogo
 *
 * WHAT:  The chrome every (auth) route wears — the brand wordmark in a top
 *        bar, an optional right-hand slot in that bar, and the page body,
 *        which is either a centred column or a form column beside a showcase
 *        panel.
 *
 * WHY:   AUTH_SURFACE: NO card, panel, or border around the form — the auth
 *        screens sit directly on the page background, and this is the one file
 *        that decides that. They previously disagreed: sign-in, sign-up,
 *        forgot and reset were bare while accept-invitation drew its own
 *        <Card>, so the same flow changed shape halfway through. Owning the
 *        surface here is what keeps them identical; a form that reintroduces
 *        its own container is the bug this file exists to prevent.
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
 *        component, not two: sign-in and sign-up hand it the showcase panel;
 *        forgot-password, reset-password and accept-invitation hand it
 *        nothing and get the centred column they already had. A second
 *        `AuthSplitShell` would be the same top bar and the same canvas
 *        maintained twice, which is how the halves of one flow start
 *        disagreeing again.
 *
 *        CTA_PINS_TO_THE_BOTTOM below `lg`: the body is a flex column that
 *        fills the viewport, so a form ending in `mt-auto` pushes its primary
 *        action to the bottom of the screen, where a thumb already is. That
 *        is what the mobile artboards show, and it falls out of the shell
 *        rather than every screen reimplementing it. The column still grows
 *        past the viewport when a form is taller than the screen, because the
 *        height is a MINIMUM.
 *
 *        `max-w-[500px]` on the form column matches auth-design.md's
 *        `flex: 1 1 420px; max-width: 500px`. At the old `max-w-md` (24rem) a
 *        two-column social row plus two fields reads as cramped.
 *
 * WHERE: Used by every page under src/app/(auth)/. The sign-in and sign-up
 *        pages pass `aside={<AuthShowcase />}` and
 *        `headerEnd={<AuthModeNav />}`.
 */

import * as React from "react";

import { PlatformLogo } from "@/components/global/platform-logo";
import { cn } from "@/lib/utils";

export interface AuthShellProps {
  children: React.ReactNode;
  /**
   * The desktop-only panel beside the form. Omit for a centred single column.
   * The panel hides itself below `lg` (see AuthShowcase), so the shell only
   * has to stop reserving a second grid track.
   */
  aside?: React.ReactNode;
  /** Right-hand side of the top bar — the opposite-mode link, typically. */
  headerEnd?: React.ReactNode;
  /**
   * The small tilted pill beside the wordmark on mobile, e.g. "41s to post".
   * Mobile-only: on desktop the same claim is already on the showcase panel.
   */
  headerTag?: string;
}

export function AuthShell({
  children,
  aside,
  headerEnd,
  headerTag,
}: AuthShellProps) {
  const isSplit = aside !== undefined;

  return (
    <div className="marketing-canvas flex min-h-svh flex-col bg-background px-6 py-7 lg:px-8 lg:py-12">
      <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-4">
        <PlatformLogo href="/" tone="brand" size="lg" />

        {headerTag ? (
          <span className="brutal-shadow inline-flex -rotate-[4deg] items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background lg:hidden">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
            {headerTag}
          </span>
        ) : null}

        {headerEnd}
      </header>

      {/* The body fills whatever the header leaves, which is what lets a
          form's `mt-auto` reach the bottom of the viewport on mobile.
          `items-center` only once there are two columns: a centred column
          should be centred VERTICALLY too, and on the split layout the two
          columns are centred against each other instead. */}
      <main
        className={cn(
          "mx-auto flex w-full max-w-[1240px] flex-1 pt-10 lg:pt-12",
          isSplit
            ? "flex-col gap-10 lg:flex-row lg:items-stretch lg:gap-14"
            : "flex-col items-center justify-center",
        )}
      >
        <div
          className={cn(
            "flex w-full flex-1 flex-col",
            isSplit ? "max-w-[500px] lg:flex-[1_1_420px]" : "max-w-md flex-none",
          )}
        >
          {children}
        </div>

        {/* flex-[999_1_520px] per auth-design.md — the panel takes every pixel
            the form column does not want, and wraps away entirely below lg. */}
        {isSplit ? (
          <div className="hidden lg:block lg:flex-[999_1_520px]">{aside}</div>
        ) : null}
      </main>
    </div>
  );
}
