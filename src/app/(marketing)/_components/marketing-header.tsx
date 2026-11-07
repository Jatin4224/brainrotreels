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
import { FilmIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { AUTH_ROUTES } from "@/lib/config/auth-routes";
import { APP_NAME } from "@/lib/config/branding";
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
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-base font-bold tracking-tight text-foreground"
        >
          <span className="brutal-border brutal-shadow-sm flex size-7 items-center justify-center rounded-lg bg-brand text-brand-foreground">
            <FilmIcon className="size-3.5" aria-hidden="true" />
          </span>
          {APP_NAME}
        </Link>

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
            <Link
              href={AUTH_ROUTES.signIn}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
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
          </div>
        </div>
      </nav>
    </header>
  );
}
