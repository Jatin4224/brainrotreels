/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_ROUTES, AUTH_CALLBACK_PARAM,
 *   resolveAuthCallback, authRouteWithCallback, RETURN_TO_AFTER_AUTH,
 *   OPEN_REDIRECT_GUARD
 *
 * WHAT:  Auth-flow UI route paths — every `/sign-*` URL the app links or
 *        redirects to. The ONE place these strings live.
 * WHY:   Routes are NOT branding. BRANDING is for visual / textual identity
 *        (name, description, copy); deciding "where does the sign-in page
 *        live" is auth-flow architecture. Centralizing here kills the
 *        dual-source-of-truth bug where proxy.ts and auth-form.tsx each
 *        carried their own `/sign-up` literal. Pages never import this to
 *        redirect — the AuthRedirectObserver in src/trpc/react-provider.tsx
 *        is the only consumer of `signIn` for redirect purposes (proxy.ts
 *        uses it for the sign-up bounce; auth-form.tsx uses both for the
 *        cross-link footers). Per-page `redirect(AUTH_ROUTES.signIn)`
 *        defeats the layout-driven model and is an anti-pattern.
 *        RETURN_TO_AFTER_AUTH lives here too, for the same reason: "where does
 *        the user land after signing in" is auth-flow architecture, and the
 *        param name has to be identical in the code that WRITES the link and
 *        the code that READS it. Two literals is how that silently breaks.
 * WHERE: Imported by src/proxy.ts (sign-up → sign-in bounce when
 *        registration is closed), src/trpc/react-provider.tsx
 *        (AuthRedirectObserver — the global UNAUTHORIZED handler), and
 *        src/components/global/auth/auth-form.tsx (footer cross-links).
 */

import type { Route } from 'next'

export const AUTH_ROUTES = {
  signIn: '/sign-in',
  signUp: '/sign-up',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  /* Public like the rest: the invitee is signed out (or signed in as the wrong
   * account) precisely when they arrive here. */
  acceptInvitation: '/accept-invitation',
} as const

export type AuthRouteKey = keyof typeof AUTH_ROUTES

/**
 * SOURCE OF TRUTH KEYWORDS: isAuthRoute, PUBLIC_AUTH_SURFACE,
 *   AuthRedirectObserver
 *
 * WHAT:  True when a pathname is one of the auth screens — the pages whose
 *        whole purpose is to serve someone who is NOT signed in yet.
 * WHY:   PUBLIC_AUTH_SURFACE. AuthRedirectObserver turns any UNAUTHORIZED into
 *        a bounce to sign-in, which is right everywhere except HERE, where
 *        being signed out is the normal state. Anything mounted in the root
 *        layout runs on these pages too, so the moment one such component asks
 *        an authProcedure a question — <UpgradeModalProvider> calling
 *        useActiveOrganizationId() is what did it — every auth page starts
 *        redirecting to sign-in on load. An invitee following their link got a
 *        flash of the invitation and then a blank sign-in form.
 *        Fixing it at the observer rather than in each component is the point:
 *        the next provider added to the root layout must not be able to break
 *        these pages again, and it will not have to know it could.
 *        ONBOARDING_INCOMPLETE is skipped for the same reason — an invitee who
 *        just signed in has no organization YET, and yanking them to onboarding
 *        to create their own is the opposite of accepting the invitation that
 *        brought them.
 * WHERE: src/trpc/react-provider.tsx (AuthRedirectObserver).
 */
export function isAuthRoute(pathname: string): boolean {
  return Object.values(AUTH_ROUTES).some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_CALLBACK_PARAM, RETURN_TO_AFTER_AUTH
 *
 * WHAT:  The query-string key carrying where to go once auth succeeds.
 * WHY:   Written by whoever sends the user to an auth page and read by that
 *        page. One constant so the two halves cannot drift.
 * WHERE: Built into links by authRouteWithCallback; read by the (auth) pages
 *        through resolveAuthCallback.
 */
export const AUTH_CALLBACK_PARAM = 'callbackURL'

/**
 * SOURCE OF TRUTH KEYWORDS: resolveAuthCallback, OPEN_REDIRECT_GUARD,
 *   RETURN_TO_AFTER_AUTH
 *
 * WHAT:  Validates a raw `?callbackURL=` value into an in-app destination, or
 *        null when it is absent or not ours to navigate to.
 * WHY:   OPEN_REDIRECT_GUARD. This value arrives from the URL bar, so it is
 *        attacker-controlled: an unchecked `?callbackURL=https://evil.example`
 *        turns our own sign-in page into a credible phishing hop, on our
 *        domain, that hands the visitor to someone else the moment they
 *        authenticate. Only a SITE-RELATIVE path is accepted.
 *        `//evil.example` and `/\evil.example` are rejected explicitly: both
 *        are protocol-relative URLs that browsers resolve to another ORIGIN
 *        while still starting with a slash, so a naive `startsWith('/')` check
 *        lets them straight through. That single missing case is the whole
 *        vulnerability.
 *        Returning null rather than throwing keeps a mangled link harmless —
 *        the caller falls back to its normal destination instead of erroring in
 *        the user's face on a page that otherwise works.
 *        The `Route` cast is the honest boundary of TYPED_ROUTE_GUARANTEE, the
 *        same one PORTAL_PATH makes: a value read at runtime cannot be checked
 *        against the route tree. Confined to this one function so no caller
 *        repeats it — and a callback naming a route that does not exist simply
 *        404s after login rather than corrupting anything.
 * WHERE: Called by the (auth) route pages to seed AuthScreen's callbackURL.
 */
export function resolveAuthCallback(raw: string | string[] | undefined): Route | null {
  /* A repeated ?callbackURL= arrives as an array. Ambiguous intent, and the
   * usual shape of someone probing the parser — take none of them. */
  if (typeof raw !== 'string') return null

  const value = raw.trim()
  if (value.length === 0) return null
  /* Control characters and whitespace can smuggle a second header/URL past a
   * naive parser; a legitimate in-app path never contains them. */
  if (/[\x00-\x20\x7f]/.test(value)) return null

  if (!value.startsWith('/')) return null
  /* Protocol-relative: browsers read both as "another origin". */
  if (value.startsWith('//') || value.startsWith('/\\')) return null

  /* The cast is the honest boundary of TYPED_ROUTE_GUARANTEE: `Route` is a
   * literal union generated into .next/types by `next build`, and a value read
   * at runtime cannot be checked against it.
   *
   * NECESSARY_DESPITE_LINT: eslint reports this as an unnecessary assertion
   * whenever .next/types is absent or stale, because `Route` degrades to
   * `string` and the cast looks redundant. It is not — `next build` fails
   * without it. Trust the build over the rule here; see the eslint override
   * for this file. */
  return value as Route
}

/**
 * SOURCE OF TRUTH KEYWORDS: authRouteWithCallback, RETURN_TO_AFTER_AUTH
 *
 * WHAT:  An auth route with the return destination attached, or the bare route
 *        when there is nothing to return to.
 * WHY:   The one place the callback is ENCODED, so a destination carrying its
 *        own query string (`/accept-invitation?id=…`) survives the round trip
 *        instead of being truncated at the first `&`. Hand-built links get this
 *        wrong, and the invitation link is exactly that shape.
 * WHERE: The accept-invitation screen's sign-in / create-account buttons, and
 *        the auth form's sign-in ⇄ sign-up cross-links.
 */
export function authRouteWithCallback(route: Route, callbackURL: string | null): Route {
  if (callbackURL === null || callbackURL.length === 0) return route
  /* No `as Route` here: Route already admits a query string appended to a known
   * route, so asserting would be flagged as redundant — and a redundant
   * assertion is exactly what hides the day the type stops admitting it. */
  return `${route}?${AUTH_CALLBACK_PARAM}=${encodeURIComponent(callbackURL)}`
}
