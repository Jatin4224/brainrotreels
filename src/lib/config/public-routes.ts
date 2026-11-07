/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PUBLIC_ROUTES, isPublicRoute,
 *   isUnauthenticatedSurface, PUBLIC_MARKETING_SURFACE,
 *   HOME_IS_PUBLIC, AuthRedirectObserver, PublicRouteKey
 *
 * WHAT:  The route prefixes that serve a visitor with NO account — the landing
 *        page, pricing, the API reference and the legal documents — plus the
 *        single predicate that answers "is being signed out the NORMAL state
 *        here?" for both these pages and the auth screens.
 *
 * WHY:   PUBLIC_MARKETING_SURFACE. `AuthRedirectObserver` turns any tRPC
 *        UNAUTHORIZED into a bounce to sign-in, and it only ever excused the
 *        `(auth)` group (PUBLIC_AUTH_SURFACE in ./auth-routes.ts). The
 *        `(marketing)` group needs exactly the same excuse and did not have it,
 *        so the LANDING PAGE redirected itself to /sign-in: `<UpgradeModalProvider>`
 *        is mounted in the ROOT layout, it calls `useActiveOrganizationId()`,
 *        that hook asks `organization.getActiveOrganization` — an authProcedure
 *        — and for an anonymous visitor the only possible answer is
 *        UNAUTHORIZED. The visitor got a flash of the hero and then a sign-in
 *        form they never asked for, which is the one thing a landing page must
 *        never do (HOME_IS_PUBLIC). Nothing on these pages reads a session;
 *        the way in is a LINK the visitor clicks, never a redirect.
 *
 *        Fixed HERE, as data, rather than inside the observer or by making each
 *        root-layout provider skip its query: the next provider added to the
 *        root layout must not be able to break the public pages again, and the
 *        next public page added must not have to know the observer exists.
 *
 *        `home` is matched EXACTLY and every other entry by prefix. `/` as a
 *        prefix matches every URL in the app, which would silently disable the
 *        auth redirect for the dashboard too — the failure would be a signed-out
 *        user sitting on a broken dashboard instead of being sent to sign in.
 *
 *        Routes are architecture, not branding, so this sits beside AUTH_ROUTES
 *        and ROUTES rather than in BRANDING. Client-safe by construction (plain
 *        literals, no env, no server import) because the observer that reads it
 *        is a client component — see THE_BARREL_IS_CLIENT_SAFE in ./index.ts.
 * WHERE: `isUnauthenticatedSurface` is read by the AuthRedirectObserver in
 *        src/trpc/react-provider.tsx. The paths themselves back the
 *        src/app/(marketing)/* route group; re-exported from @/lib/config.
 */

import { isAuthRoute } from "./auth-routes";

export const PUBLIC_ROUTES = {
  /** The landing page. Exact-match only — see the file header. */
  home: "/",
  pricing: "/pricing",
  docs: "/docs",
  legal: "/legal",
} as const;

export type PublicRouteKey = keyof typeof PUBLIC_ROUTES;

/**
 * SOURCE OF TRUTH KEYWORDS: isPublicRoute, PUBLIC_MARKETING_SURFACE
 *
 * WHAT:  True when a pathname belongs to the public `(marketing)` group.
 * WHY:   One matcher for a set that will keep growing (a blog, a changelog, a
 *        template gallery), so adding a public page is a line of data here
 *        rather than an edit in the auth observer. The exact-match carve-out
 *        for `/` is load-bearing — see the file header.
 * WHERE: Composed by `isUnauthenticatedSurface` below.
 */
export function isPublicRoute(pathname: string): boolean {
  if (pathname === PUBLIC_ROUTES.home) return true;

  return Object.entries(PUBLIC_ROUTES).some(([key, route]) => {
    if (key === "home") return false;
    return pathname === route || pathname.startsWith(`${route}/`);
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: isUnauthenticatedSurface, AuthRedirectObserver,
 *   PUBLIC_AUTH_SURFACE, PUBLIC_MARKETING_SURFACE
 *
 * WHAT:  True when being signed OUT is the normal state for this pathname —
 *        every auth screen and every public marketing page.
 * WHY:   The observer needs ONE question answered, not two, and the two sets
 *        are maintained in different files for good reasons (an auth route is
 *        also a redirect TARGET; a marketing route never is). Composing them
 *        here keeps the observer free of the knowledge that there are two sets
 *        at all, so a third public surface is a change to this function only.
 * WHERE: src/trpc/react-provider.tsx (AuthRedirectObserver).
 */
export function isUnauthenticatedSurface(pathname: string): boolean {
  return isAuthRoute(pathname) || isPublicRoute(pathname);
}
