/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MarketingLayout, PUBLIC_ROUTE_GROUP,
 *   NO_AUTH_IN_THIS_GROUP, PUBLIC_MARKETING_SURFACE, marketing-canvas,
 *   MarketingHeader, MarketingFooter, AUTH_IS_A_CLICK_NOT_A_REDIRECT
 *
 * WHAT:  The shell for every public, unauthenticated page — the landing page,
 *        pricing, the API reference and the legal documents.
 *
 * WHY:   PUBLIC_ROUTE_GROUP. A route group of its own, parallel to `(auth)`,
 *        `(dashboard)` and `(portal)`, because these pages differ from all
 *        three in the one way that matters: they must render for somebody with
 *        no account. Putting them under `(dashboard)` would inherit its
 *        ROUTE_AUTHORIZATION gate and bounce every visitor to sign-in, which
 *        for a PRICING page is the whole audience.
 *
 *        NO_AUTH_IN_THIS_GROUP, and nothing in it may read a session. These
 *        pages are static — no tRPC, no `headers()`, no cookies — so they can
 *        be cached and served to an anonymous visitor at the speed a landing
 *        page needs. A single auth read anywhere beneath here would silently
 *        opt the whole group out of that.
 *
 *        PUBLIC_MARKETING_SURFACE is the OTHER half of that promise, and the
 *        half this group could not keep on its own: `<UpgradeModalProvider>` in
 *        the ROOT layout asks an authProcedure for the active organization, the
 *        answer for a visitor is UNAUTHORIZED, and the global
 *        AuthRedirectObserver used to turn that into a redirect — so the
 *        landing page sent anonymous visitors to /sign-in without them
 *        clicking anything. The observer now excuses these paths; see
 *        `isUnauthenticatedSurface` in src/lib/config/public-routes.ts.
 *        AUTH_IS_A_CLICK_NOT_A_REDIRECT: the header and the page CTAs are the
 *        only route to an auth screen from here.
 *
 *        The header and footer are their own components rather than markup in
 *        this file — see the headers in ./_components for why each exists. The
 *        `marketing-canvas` wash is applied HERE, to the group's root element,
 *        rather than to `body`: the brand gradients belong to the public pages
 *        and would otherwise tint the dashboard and every render thumbnail an
 *        operator is colour-judging (MARKETING_DESIGN_LANGUAGE in globals.css).
 *
 *        The root layout still wraps this, so the theme, the fonts and the
 *        analytics provider all apply — which is why there is no `<html>` here
 *        and why a visitor's cookie choice is honoured on these pages too.
 * WHERE: Wraps src/app/(marketing)/page.tsx (the landing page),
 *        src/app/(marketing)/pricing, src/app/(marketing)/legal and
 *        src/app/(marketing)/docs.
 */

import { MarketingFooter, MarketingHeader } from "./_components";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="marketing-canvas flex min-h-screen flex-col bg-background">
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
