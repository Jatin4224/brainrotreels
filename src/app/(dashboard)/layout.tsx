/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: DashboardLayout
 *
 * WHAT:  Server layout for every authenticated dashboard route — the single
 *        auth + onboarding gate, then the sidebar shell (SidebarProvider +
 *        AppSidebar + SidebarInset).
 * WHY:   Doing auth ONCE in the layout (not per page) keeps the redirect logic
 *        in one place: anonymous → sign-in, no-org → onboarding, and — see
 *        ROUTE_AUTHORIZATION below — not-permitted → dashboard. It also
 *        PREFETCHES the queries the sidebar + user menu depend on
 *        (active org, memberships, feature gates, profile, plan catalogue,
 *        trial history) and hydrates them, so the sidebar and the upgrade
 *        surfaces render their final state immediately from cache instead of
 *        popping in — or correcting themselves — after client fetches.
 * WHERE: Wraps src/app/(dashboard)/**. Renders the sidebar from
 *        src/components/global/sidebar.
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";

import { getSidebarNav } from "@/lib/resources";
import { permissions } from "@/lib/permissions";
import { getFeatureGates } from "@/lib/feature-gate";

import { getServerSession } from "@/lib/adapters/session";
import { createTRPCContext } from "@/trpc/init";
import { getQueryClient, trpc } from "@/trpc/server";
import {
  AUTH_ROUTES,
  ROUTES,
  PORTAL_PATH,
  isPortalOwnerEmail,
  prisma,
} from "@/lib/config";
import {
  ensurePersonalWorkspace,
  workspaceNameFor,
} from "@/services/organization.service";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/global/sidebar";
import { PlanOverageBanner } from "@/components/global/plan-overage-banner";
import { OrgSwitcher, UserMenu } from "@/components/global/providers/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (!session) redirect(AUTH_ROUTES.signIn);

  const ctx = await createTRPCContext();
  await ctx.resolveAuth();
  const activeOrganization = await ctx.getActiveOrganization();
  if (!activeOrganization) {
    /* A fresh platform-admin owner (no org yet) belongs in /portal, which
     * bootstraps their portal org — not the tenant onboarding flow. */
    if (isPortalOwnerEmail(session.user.email)) redirect(PORTAL_PATH);

    /* PERSONAL_WORKSPACE — a solo creator has no team to name, so one
     * workspace is created for them rather than asking.
     *
     * Here, and not in a Better Auth `databaseHooks.user.create.after`, for
     * three reasons: AuthAdapter has no onUserCreated seam, so a second
     * provider would silently never get a workspace; a throw in that hook
     * aborts sign-up, turning a transient database blip into "registration is
     * broken"; and it fires for the portal owner too, who must NOT get a
     * tenant org — a rule this branch already encodes one line above.
     *
     * No setActive call: that is a client action, and getActiveOrganization
     * already falls back to the first membership, so the new workspace is
     * live immediately. session.activeOrganizationId stays null until the
     * user first uses the switcher, which is correct for a single workspace.
     *
     * On failure fall through to onboarding, which stays reachable as the
     * recovery path and can report the error properly. */
    let created = false;
    try {
      await ensurePersonalWorkspace(prisma, {
        userId: session.user.id,
        name: workspaceNameFor(session.user),
      });
      created = true;
    } catch (error) {
      console.error("[dashboard] personal workspace creation failed", error);
    }

    /* Redirect rather than re-reading the context. `createTRPCContext` and its
     * membership lookups are React cache()d for the REQUEST, so calling
     * getActiveOrganization() again here returns the same memoised null that
     * sent us down this branch — the workspace exists in the database and the
     * page still bounces to onboarding. A fresh request gets a fresh cache.
     *
     * Outside the try on purpose: redirect() signals by throwing, and the
     * catch above would swallow it. */
    if (created) redirect(ROUTES.dashboard);

    redirect(ROUTES.onboarding);
  }

  /* ─────────────────────────────────────────────────────────────────────
   * ROUTE_AUTHORIZATION — the page-level twin of protectedProcedure's gate.
   *
   * protectedProcedure protects DATA, and that is enough whenever a page's
   * content comes through tRPC. It is NOT enough when a page renders a
   * component that fetches its own data outside tRPC — a provider-hosted
   * pricing table talking to the provider straight from the browser. Pasting
   * /dashboard/settings/billing showed the plans to a member without
   * `billing:read`: nothing bypassed the gate, the content never went through
   * it.
   *
   * Enforced HERE, once, from the SAME registry declaration the sidebar uses
   * to hide the link (`nav.requirePermission` / `nav.requireFlag`). Adding a
   * page with a `nav` entry gates it automatically; there is no per-page
   * function to remember, which is the whole point of the registry.
   * ───────────────────────────────────────────────────────────────────── */
  const pathname = (await headers()).get("x-pathname") ?? "";
  const navItem = getSidebarNav()
    .flatMap((section) => section.items)
    /* Longest href first so /settings/billing wins over a /settings parent. */
    .sort((a, b) => b.href.length - a.href.length)
    .find(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    );

  if (navItem) {
    const permitted =
      activeOrganization.hasFullAccess ||
      activeOrganization.permissions.includes(navItem.requirePermission);
    if (!permitted) redirect(ROUTES.dashboard);

    if (navItem.requireFlag) {
      /* Same computation the procedure factory and <FeatureGate> read, so the
       * page cannot disagree with the server about plan availability. */
      const gates = await getFeatureGates(activeOrganization.id);
      if (gates.gates[navItem.key]?.atLimit) redirect(ROUTES.dashboard);
    }
  }

  /* Prefetch everything the sidebar/user-menu read, then hydrate — the client
   * components resolve from cache on first paint (no flicker). */
  const queryClient = getQueryClient();
  /* Same question billing.getSubscription asks server-side; asked here from the
   * membership already in hand rather than by letting a prefetch fail. */
  const canReadBilling =
    activeOrganization.hasFullAccess ||
    activeOrganization.permissions.includes(permissions.BILLING_READ);
  await Promise.all([
    queryClient.prefetchQuery(
      trpc.organization.getActiveOrganization.queryOptions(),
    ),
    queryClient.prefetchQuery(
      trpc.organization.getUserOrganizations.queryOptions(),
    ),
    queryClient.prefetchQuery(
      trpc.usage.getFeatureGates.queryOptions({
        organizationId: activeOrganization.id,
      }),
    ),
    queryClient.prefetchQuery(trpc.user.getProfile.queryOptions()),
    /* OVER_PLAN_STATE — prefetched so the banner is decided before first paint.
     * Fetching it client-side would flash a red bar onto every page load in the
     * normal case, or worse, show nothing for a beat while the org is over. */
    queryClient.prefetchQuery(
      trpc.usage.getPlanOverages.queryOptions({
        organizationId: activeOrganization.id,
      }),
    ),
    /* UPGRADE_STATE_IS_PRERENDERED — the plan catalogue and this user's trial
     * history. Both feed the sidebar nudge AND the upgrade modal's header, and
     * BOTH change what that copy says: "Upgrade your plan" and "Start your free
     * trial" are the same screen answered with different facts. Resolving them
     * client-side let the modal render one answer and then visibly correct
     * itself. Prefetched here so the first paint is already the final one.
     * Cheap despite talking to the billing provider — listPlanPrices is
     * memoised process-wide (PRICE_CATALOGUE_TTL). */
    queryClient.prefetchQuery(trpc.billing.getAvailablePlans.queryOptions()),
    queryClient.prefetchQuery(trpc.billing.getTrialEligibility.queryOptions()),
    /* The billing interval behind the "switch to yearly" nudge. Permission-
     * gated on the server, so it is only prefetched for someone who may read
     * it — prefetching it for anyone else would just cache a FORBIDDEN. */
    ...(canReadBilling
      ? [
          queryClient.prefetchQuery(
            trpc.billing.getSubscription.queryOptions({
              organizationId: activeOrganization.id,
            }),
          ),
        ]
      : []),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {/* APP_BANNER_OFFSET — the banner is a peer of the whole shell, not of the
          page content, so it spans the sidebar too and pushes the app down
          rather than scrolling away inside one column. */}
      <PlanOverageBanner />
      <SidebarProvider>
        <AppSidebar orgSwitcher={<OrgSwitcher />} userMenu={<UserMenu />} />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </HydrationBoundary>
  );
}
