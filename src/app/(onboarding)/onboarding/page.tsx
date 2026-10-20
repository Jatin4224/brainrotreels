/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: OnboardingPage
 *
 * WHAT:  /onboarding route — server-guarded entry to the org-creation wizard.
 *        Sends anonymous users to sign-in and portal owners to /portal;
 *        otherwise renders the provider's onboarding surface. Reachable both as the
 *        forced destination for a user with no org AND intentionally via the
 *        org switcher's "Create organization" (an existing user creating an
 *        additional org) — so it does NOT redirect users who already have an
 *        org away, which would make that action flash back to the dashboard.
 * WHERE: Redirect target of the dashboard layout / ONBOARDING_INCOMPLETE
 *        handler, and of the team-switcher "Create organization". Reads
 *        getCachedSession; routes via AUTH_ROUTES / PORTAL_PATH.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/adapters/session";
import { AUTH_ROUTES, PORTAL_PATH, isPortalOwnerEmail } from "@/lib/config";
import { Onboarding } from "@/components/global/providers/server";

export const metadata: Metadata = {
  title: "Get started",
};

export default async function OnboardingPage() {
  const session = await getServerSession();
  if (!session) redirect(AUTH_ROUTES.signIn);

  /* Platform-admin owner shouldn't create a tenant org — send them to /portal,
   * which bootstraps their portal workspace. */
  if (isPortalOwnerEmail(session.user.email)) redirect(PORTAL_PATH);

  /* ONBOARDING_IS_THE_ONLY_FUNNEL: this route stays reachable WITH an existing
   * organization under every provider, on purpose — the sidebar switcher's
   * "Create organization" links here to add another, and every new tenant must
   * pass through the plan + payment steps rather than appearing for free.
   * The post-sign-up duplicate is prevented upstream instead: sign-up lands on
   * the dashboard, and the dashboard layout only sends users here when they
   * genuinely have no organization. */
  return <Onboarding />;
}
