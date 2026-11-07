/**
 * SOURCE OF TRUTH KEYWORDS: isPublicRoute, isUnauthenticatedSurface,
 *   PUBLIC_ROUTES, PUBLIC_MARKETING_SURFACE, HOME_IS_PUBLIC,
 *   public-routes tests
 *
 * WHAT:  Unit tests for the public-surface matchers the AuthRedirectObserver
 *        asks before bouncing anyone to sign-in.
 * WHY:   Two cases here are the whole bug class, so they are asserted
 *        explicitly rather than folded into a generic happy path. First, `/`
 *        must be public — that regression redirected the LANDING PAGE to
 *        sign-in for every anonymous visitor. Second, `/` must NOT match as a
 *        PREFIX: if it did, the dashboard would count as a public surface and a
 *        signed-out user would sit on a broken dashboard forever instead of
 *        being sent to sign in. The second failure is invisible in a browser
 *        until someone's session expires.
 * WHERE: Run by `npm test`. Covers src/lib/config/public-routes.ts.
 */

import { describe, expect, it } from "vitest";

import { AUTH_ROUTES } from "./auth-routes";
import {
  PUBLIC_ROUTES,
  isPublicRoute,
  isUnauthenticatedSurface,
} from "./public-routes";

describe("isPublicRoute", () => {
  it("treats the landing page as public (HOME_IS_PUBLIC)", () => {
    expect(isPublicRoute(PUBLIC_ROUTES.home)).toBe(true);
  });

  it("matches every marketing route and its children", () => {
    expect(isPublicRoute(PUBLIC_ROUTES.pricing)).toBe(true);
    expect(isPublicRoute("/docs/api")).toBe(true);
    expect(isPublicRoute("/legal/terms")).toBe(true);
  });

  /* The load-bearing carve-out: `/` is exact-match only. */
  it("does not treat every path as public just because it starts with a slash", () => {
    expect(isPublicRoute("/dashboard")).toBe(false);
    expect(isPublicRoute("/dashboard/projects")).toBe(false);
    expect(isPublicRoute("/onboarding")).toBe(false);
  });

  it("does not match a route that merely shares a prefix", () => {
    expect(isPublicRoute("/pricing-internal")).toBe(false);
    expect(isPublicRoute("/docsearch")).toBe(false);
  });
});

describe("isUnauthenticatedSurface", () => {
  it("covers the auth screens", () => {
    expect(isUnauthenticatedSurface(AUTH_ROUTES.signIn)).toBe(true);
    expect(isUnauthenticatedSurface(AUTH_ROUTES.signUp)).toBe(true);
    expect(isUnauthenticatedSurface("/accept-invitation")).toBe(true);
  });

  it("covers the marketing pages", () => {
    expect(isUnauthenticatedSurface("/")).toBe(true);
    expect(isUnauthenticatedSurface("/pricing")).toBe(true);
  });

  it("leaves the authenticated app alone so an expired session still redirects", () => {
    expect(isUnauthenticatedSurface("/dashboard")).toBe(false);
    expect(isUnauthenticatedSurface("/dashboard/settings/billing")).toBe(false);
  });
});
