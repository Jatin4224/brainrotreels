/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: APP_NAME, APP_SLUG, APP_URL, APP_DOMAIN,
 *   APP_DESCRIPTION, APP_METADATA_BASE, BRANDING, AUTH_ROUTES,
 *   REGISTRATION_OPEN, PLANS, PlanKey, PlanDefinition,
 *   AUTH_CALLBACK_PARAM, resolveAuthCallback, authRouteWithCallback,
 *   ROUTES, AppRouteKey, PLAN_ORDER, BillingInterval, getPlanPriceId,
 *   getPlanByPriceId, getNextPlan, isPaidPlan, portalConfig, isPortalEnabled,
 *   isPortalOwnerEmail, PORTAL_PATH, portalRoute,
 *   THE_BARREL_IS_CLIENT_SAFE
 *
 * WHAT:  Barrel re-export for the CLIENT-SAFE `src/lib/config/*` modules.
 * WHY:   Single import surface (`@/lib/config`) so consumers don't depend on
 *        the per-concern split, and so branding, auth-routes, plans, routes and
 *        the registration flag can be regrouped without ripple edits.
 *
 *        THE_BARREL_IS_CLIENT_SAFE, and that is now a rule rather than a
 *        coincidence. It used to re-export the prisma singleton and the Stripe
 *        and Resend clients alongside the branding constants — and nineteen
 *        client components import this file for `ROUTES`, `BRANDING` or
 *        `PLANS`. The result was the whole generated Prisma client, 291 KB of
 *        it, in the browser bundle of every page: `globalThis.__prisma ?? new
 *        PrismaClient` shipped to first paint. It did not crash only because
 *        the browser build's constructor is a Proxy that throws on property
 *        access and nothing touched it.
 *
 *        So the server-only modules are deliberately NOT re-exported here.
 *        They carry `import "server-only"` themselves, which makes a client
 *        component importing one a BUILD error rather than a silent payload,
 *        and they are imported from their own leaf paths:
 *
 *          import { prisma } from "@/lib/config/prisma";
 *          import { getStripeClient } from "@/lib/config/stripe";
 *          import { getResendClient } from "@/lib/config/resend";
 *
 *        Keep it that way. Adding a re-export of one of them here would
 *        re-break every page's bundle at once, and nothing would fail.
 * WHERE: Imported broadly across the app, from both server and client code.
 */

export {
  APP_NAME,
  APP_SLUG,
  APP_URL,
  APP_DOMAIN,
  APP_DESCRIPTION,
  APP_METADATA_BASE,
  BRANDING,
} from "./branding";
export {
  AUTH_ROUTES,
  AUTH_CALLBACK_PARAM,
  resolveAuthCallback,
  authRouteWithCallback,
} from "./auth-routes";
export type { AuthRouteKey } from "./auth-routes";
export { ROUTES } from "./routes";
export type { AppRouteKey } from "./routes";
export { REGISTRATION_OPEN } from "./registration";
export {
  PLAN_KEYS,
  PLANS,
  PLAN_ORDER,
  isPaidPlan,
  getPlanPriceId,
  getPlanByPriceId,
  getNextPlan,
} from "./plans";
export type { PlanKey, PlanDefinition, BillingInterval } from "./plans";
export {
  portalConfig,
  isPortalEnabled,
  isPortalOwnerEmail,
  PORTAL_PATH,
  portalRoute,
} from "./portal";
