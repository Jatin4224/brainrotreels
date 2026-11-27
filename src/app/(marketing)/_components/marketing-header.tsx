/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MarketingHeader, MARKETING_NAV_LINKS,
 *   AUTH_IS_A_CLICK_NOT_A_REDIRECT, PUBLIC_MARKETING_SURFACE, AUTH_ROUTES,
 *   sticky header
 *
 * WHAT:  The sticky, blurred header every public page wears — wordmark, the
 *        in-page and cross-page nav, and the one pill CTA that sends a visitor
 *        at the product.
 *
 * WHY:   AUTH_IS_A_CLICK_NOT_A_REDIRECT. These links are the ONLY thing on the
 *        public surface that moves anyone towards an auth screen, and a visitor
 *        has to press one. Nothing here reads a session, so there is no branch
 *        that could decide to send them somewhere on its own — the regression
 *        this is written against is a landing page that bounced an anonymous
 *        visitor to /sign-in before they had read a word (see
 *        PUBLIC_MARKETING_SURFACE in src/lib/config/public-routes.ts).
 *
 *        A Server Component: a sticky header with no session to read needs no
 *        client bundle, and the `(marketing)` group's whole value is being
 *        cacheable (NO_AUTH_IN_THIS_GROUP).
 *
 *        The nav is a typed array rather than hand-written anchors so a section
 *        renamed on the landing page is one edit, and so the mobile/desktop
 *        variants cannot list different things. Hash targets are deliberately
 *        plain strings — a fragment is not a route, so `typedRoutes` has
 *        nothing to check and `Route` would have to be asserted.
 * WHERE: Rendered by src/app/(marketing)/layout.tsx above every public page.
 */

import Link from "next/link";

import { PlatformLogo } from "@/components/global/platform-logo";
import { MarketingMobileNav } from "./marketing-mobile-nav";
import { buttonVariants } from "@/components/ui/button";
import { AUTH_ROUTES } from "@/lib/config/auth-routes";
import type { MarketingLink } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * SOURCE OF TRUTH KEYWORDS: MARKETING_NAV_LINKS
 *
 * WHAT:  What the public header links to, in order.
 * WHY:   One list, so the header and any future mobile sheet cannot disagree.
 *        `/#...` rather than `#...`: these pages are not all the landing page,
 *        and a bare fragment from /pricing would scroll nowhere.
 * WHERE: The nav below.
 */
const MARKETING_NAV_LINKS: readonly MarketingLink[] = [
  { label: "Formats", href: "/#formats" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "API", href: "/docs/api" },
];

export function MarketingHeader() {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl",
        /* HEADER_EARNS_ITS_LINE. The hairline and the wash fade IN over the
           first 64px of scroll, driven by the scroll position itself rather
           than by a listener: at rest the bar is not covering anything yet,
           and the border read as a seam across the top of the hero. The
           classes above are the END state, which is also what a browser with
           no `animation-timeline` support renders. See
           marketing-header-settle in globals.css. */
        "marketing-header-settle",
      )}
    >
      <nav className="safe-x mx-auto flex h-14 max-w-7xl items-center justify-between gap-4">
        <PlatformLogo href="/" size="md" />

        <div className="flex items-center gap-6">
          <div className="hidden items-center gap-6 text-sm font-medium md:flex">
            {MARKETING_NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {/* Below md this moves into the sheet — see
                SIGN_IN_MOVES_IN in marketing-mobile-nav.tsx. The bar cannot
                hold the wordmark, a menu button, Sign in AND Get started at
                390px, and Get started is the one action the page is for. */}
            <Link
              href={AUTH_ROUTES.signIn}
              className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
            >
              Sign in
            </Link>
            {/* The one way in. See AUTH_IS_A_CLICK_NOT_A_REDIRECT. */}
            <Link
              href={AUTH_ROUTES.signUp}
              className={cn(
                buttonVariants({ size: "lg" }),
                "brutal-shadow-brand h-9 rounded-full bg-brand px-4 font-semibold text-brand-foreground hover:bg-brand/90",
              )}
            >
              Get started
            </Link>

            {/* NAV_IS_REACHABLE_ON_A_PHONE. The link row above is
                `hidden md:flex` and nothing replaced it below that, so four
                destinations were unreachable from the header on a phone. */}
            <MarketingMobileNav links={MARKETING_NAV_LINKS} />
          </div>
        </div>
      </nav>
    </header>
  );
}
