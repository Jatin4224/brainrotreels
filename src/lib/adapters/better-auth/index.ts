/*

 */

import "server-only";

/**
 * SOURCE OF TRUTH KEYWORDS: betterAuthAdapter, BETTER_AUTH_CAPABILITIES,
 *   BETTER_AUTH_FULL_ACCESS_ROLE, PROVIDER_ISOLATION
 *
 * WHAT:  The Better Auth + Prisma + Stripe implementation of AuthAdapter — the
 *        open-source default that preserves this template's original behavior
 *        exactly.
 * WHY:   Every rule the app used to hard-code now lives here as a translation:
 *        the literal role string `owner` becomes `hasFullAccess`, and the local
 *        Prisma Subscription row becomes an AdapterTier. Nothing about the
 *        semantics changed — only where the provider vocabulary is allowed to
 *        appear. PROVIDER_ISOLATION: this module asserts at import time that
 *        Better Auth is the selected provider, so it can never initialise
 *        alongside a second provider even if a stray static import pulls it
 *        in.
 * WHERE: Loaded lazily by getAuthAdapter() in src/lib/adapters/index.ts when
 *        NEXT_PUBLIC_AUTH_PROVIDER is "better-auth" (or unset). Reads the
 *        session via src/lib/better-auth/auth.ts, memberships via
 *        src/services/membership.service.ts, permissions via
 *        ../shared/resolve-permissions.ts, and the tier from the local
 *        Subscription table.
 */

import { cache } from "react";

import { assertProviderActive } from "../provider";
import { resolveOrganizationRolePermissions } from "../shared/resolve-permissions";
import { betterAuthMembership } from "./membership";
import type {
  AdapterCapabilities,
  AdapterMembership,
  AdapterSession,
  AdapterTier,
  AuthAdapter,
} from "../types";
import { getCachedSession } from "@/lib/better-auth/auth";
import { getUserMemberships } from "@/services/membership.service";
import { prisma } from "@/lib/config/prisma";
import { PLANS, PLAN_KEYS, type PlanKey } from "@/lib/config/plans";

/* PROVIDER_ISOLATION runtime backstop — see src/lib/adapters/provider.ts. */
assertProviderActive("better-auth");

/**
 * SOURCE OF TRUTH KEYWORDS: BETTER_AUTH_FULL_ACCESS_ROLE
 *
 * WHAT:  The one role string Better Auth treats as unrestricted.
 * WHY:   Declared once, here, at the provider boundary. This is the ONLY place
 *        in the codebase allowed to know that Better Auth spells full access
 *        "owner" — everything above reads AdapterMembership.hasFullAccess.
 * WHERE: Used by toMembership below; mirrors `creatorRole` in auth.ts.
 */
const BETTER_AUTH_FULL_ACCESS_ROLE = "owner";

/**
 * SOURCE OF TRUTH KEYWORDS: BETTER_AUTH_CAPABILITIES
 *
 * WHAT:  What this provider can do.
 * WHY:   Better Auth owns none of these concerns, so the app implements them
 *        itself: a single transferable owner, its own invitation emails, and its
 *        own organization records.
 * WHERE: Read by the UI wrappers and by getAdapterCapabilities().
 */
const BETTER_AUTH_CAPABILITIES: AdapterCapabilities = {
  ownershipTransfer: true,
  providerInvitations: false,
  /* Better Auth stores organizations in this app's own tables. */
  appManagedOrganizations: true,
};

const isPlanKey = (value: string): value is PlanKey =>
  (PLAN_KEYS as readonly string[]).includes(value);

async function getSession(): Promise<AdapterSession | null> {
  const session = await getCachedSession();
  if (!session?.user) return null;

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image ?? null,
      emailVerified: session.user.emailVerified,
    },
    activeOrganizationId: session.session.activeOrganizationId ?? null,
  };
}

/* The single translation point for Better Auth's role vocabulary. */
function toMembership(
  row: Awaited<ReturnType<typeof getUserMemberships>>[number],
): AdapterMembership {
  return {
    organizationId: row.organizationId,
    organization: {
      id: row.organization.id,
      name: row.organization.name,
      slug: row.organization.slug,
      logo: row.organization.logo ?? null,
    },
    role: row.role,
    hasFullAccess: row.role === BETTER_AUTH_FULL_ACCESS_ROLE,
    createdAt: row.createdAt,
  };
}

async function getMemberships(userId: string): Promise<AdapterMembership[]> {
  const rows = await getUserMemberships(userId);
  return rows.map(toMembership);
}

/**
 * SOURCE OF TRUTH KEYWORDS: getBetterAuthTier
 *
 * WHAT:  Resolves an org's plan from the newest local Subscription row, with the
 *        portal bypass and the lapse guards.
 * WHY:   Moved verbatim from the old getOrganizationTier so behavior is
 *        unchanged: portal orgs bypass billing entirely; an unknown plan key, a
 *        past periodEnd, or a lapsed trial all fall back to free. Wrapped in
 *        React `cache()` so the many gate checks in one request collapse to one
 *        pair of queries.
 * WHERE: EntitlementAdapter.getTier for this provider.
 */
const getBetterAuthTier = cache(
  async (organizationId: string): Promise<AdapterTier> => {
    const freeTier: AdapterTier = {
      tier: "free",
      planName: PLANS.free.name,
      isOnTrial: false,
      subscription: null,
    };

    /* Platform-admin bypass FIRST: a portal org gets the hidden unlimited
     * `portal` tier regardless of any subscription row. */
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { isPortalOrganization: true },
    });
    if (organization?.isPortalOrganization) {
      return {
        tier: "portal",
        planName: PLANS.portal.name,
        isOnTrial: false,
        subscription: null,
      };
    }

    const subscription = await prisma.subscription.findFirst({
      where: { referenceId: organizationId },
      orderBy: { createdAt: "desc" },
    });
    if (!subscription) return freeTier;

    const rawPlan = subscription.plan.toLowerCase();
    if (!isPlanKey(rawPlan)) {
      console.warn(
        `[adapters/better-auth] subscription ${subscription.id} references unknown plan "${subscription.plan}" — defaulting to 'free'`,
      );
      return freeTier;
    }
    if (rawPlan === "free") return freeTier;
    /* `portal` is granted via the isPortalOrganization bypass above, never via a
     * subscription row — a subscription claiming it is treated as free. */
    if (rawPlan === "portal") return freeTier;

    const now = new Date();
    if (subscription.periodEnd && subscription.periodEnd < now) return freeTier;

    const isOnTrial =
      subscription.status === "trialing" &&
      subscription.trialEnd !== null &&
      subscription.trialEnd > now;
    if (subscription.status === "trialing" && !isOnTrial) return freeTier;

    return {
      tier: rawPlan,
      planName: PLANS[rawPlan].name,
      isOnTrial,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        periodEnd: subscription.periodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
        subscriptionId: subscription.stripeSubscriptionId,
      },
    };
  },
);

/**
 * SOURCE OF TRUTH KEYWORDS: betterAuthAdapter
 *
 * WHAT:  The assembled Better Auth bundle.
 * WHERE: Imported dynamically by src/lib/adapters/index.ts.
 */
export const betterAuthAdapter: AuthAdapter = {
  id: "better-auth",
  capabilities: BETTER_AUTH_CAPABILITIES,
  identity: { getSession },
  tenancy: {
    getMemberships,
    resolvePermissions: resolveOrganizationRolePermissions,
    ...betterAuthMembership,
  },
  entitlement: { getTier: getBetterAuthTier },
};
