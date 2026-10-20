/*

 */

import type { Route } from "next";

/**
 * SOURCE OF TRUTH KEYWORDS: portalConfig, isPortalEnabled, isPortalOwnerEmail,
 *   PORTAL_PATH
 *
 * WHAT:  Env-driven config for the platform-admin portal — whether it's on, the
 *        designated owner email that bootstraps the first admin, and the route
 *        prefix.
 * WHY:   One place resolves the portal env so the rest of the app reads
 *        constants. `isPortalOwnerEmail` is the single source of truth for "is
 *        this the operator": an exact, case-insensitive, trimmed match — no
 *        wildcards or partial matching (a security boundary). The owner email
 *        is server-only (NOT NEXT_PUBLIC), so client callers always see it as
 *        empty and the real gate runs server-side.
 * WHERE: Read by src/services/portal.service.ts (admin resolution + auto-
 *        provision), the /portal layout, and the dashboard/onboarding portal
 *        redirects.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PORTAL_PATH, portalRoute, TYPED_ROUTE_GUARANTEE
 *
 * WHAT:  The portal's base path and the one way to build a path beneath it.
 * WHY:   TYPED_ROUTE_GUARANTEE holds everywhere the destination is written in
 *        the source — the compiler checks it against the route tree. It CANNOT
 *        hold here: the prefix comes from an env var, so no type can know what
 *        it will be at runtime. The assertion is the honest boundary of that
 *        guarantee, and it is confined to these two lines so no caller has to
 *        repeat it. Everything else in the app stays checked.
 * WHERE: portalRoute() is used by the portal sidebar; PORTAL_PATH by the portal
 *        layout and the dashboard/onboarding redirects.
 */
export const PORTAL_PATH = (process.env["PORTAL_PATH_PREFIX"] ||
  "/portal") as Route;

/* NECESSARY_DESPITE_LINT: see resolveAuthCallback in auth-routes.ts. `Route`
 * is only a literal union once `next build` has generated .next/types; without
 * it the assertion reads as redundant and eslint flags it, but the build fails
 * if it is removed. */
export const portalRoute = (suffix: string): Route =>
  `${PORTAL_PATH}${suffix}` as Route;

export const portalConfig = {
  enabled: process.env["PORTAL_ENABLED"] === "true",
  initialOwnerEmail: process.env["PORTAL_INITIAL_OWNER_EMAIL"] || "",
  pathPrefix: PORTAL_PATH,
} as const;

/**
 * SOURCE OF TRUTH KEYWORDS: isPortalEnabled
 *
 * WHAT:  True when PORTAL_ENABLED=true.
 * WHERE: Gate before any portal operation / route.
 */
export function isPortalEnabled(): boolean {
  return portalConfig.enabled;
}

/**
 * SOURCE OF TRUTH KEYWORDS: isPortalOwnerEmail
 *
 * WHAT:  True when the email exactly matches PORTAL_INITIAL_OWNER_EMAIL
 *        (case-insensitive, trimmed) and the portal is enabled.
 * WHY:   The operator's email bootstraps the first portal admin with no manual
 *        DB seeding. Exact match only — security boundary.
 * WHERE: portal.service admin resolution + auto-provision.
 */
export function isPortalOwnerEmail(email: string): boolean {
  if (!portalConfig.enabled || !portalConfig.initialOwnerEmail) return false;
  return (
    email.toLowerCase().trim() ===
    portalConfig.initialOwnerEmail.toLowerCase().trim()
  );
}
