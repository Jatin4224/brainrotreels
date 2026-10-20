/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getFeatureGates, checkFeatureGate,
 *   checkBooleanFeature, FeatureGateData, getOrganizationTier, OrganizationTier,
 *   AUTO_DERIVED_FROM_RESOURCES, PROVIDER_NEUTRAL_ENTITLEMENT
 *
 * WHAT:  Plan-tier resolution and feature-gate computation.
 * WHY:   Gate ENFORCEMENT belongs to the procedure builder — callers never
 *        invoke checkFeatureGate/checkBooleanFeature directly. They're
 *        exported only so protectedProcedure can call them from its
 *        AUTO_DERIVED_FROM_RESOURCES step (no `requireLimit` /
 *        `requireFlag` opt-in; the path + RESOURCES decides).
 *        getFeatureGates exists for the UI to render at-limit affordances.
 *        PROVIDER_NEUTRAL_ENTITLEMENT: the tier is resolved through the
 *        EntitlementAdapter, so who SOLD the plan (Stripe today, a provider's own
 *        billing product tomorrow) is invisible here. Everything below the tier
 *        lookup — the limit maths, the trial axis, the counters — is app-owned
 *        and identical under every provider, because billing providers do not
 *        offer numeric quotas (seats at best).
 * WHERE: protectedProcedure (src/trpc/procedures/protected.ts) calls
 *        checkFeatureGate/checkBooleanFeature; usage router exposes
 *        getFeatureGates; FeatureGate component consumes the result.
 *        Tier comes from src/lib/adapters.
 */

import { cache } from "react";
import { prisma } from "@/lib/config/prisma";
import {
  RESOURCES,
  formatLimitValue,
  getUpgradeMessage,
  getResourceLimitForPlan,
  getResourceFlagForPlan,
  LIMIT_RESOURCE_KEYS,
  FLAG_RESOURCE_KEYS,
  type LimitResourceKey,
  type FlagResourceKey,
  type ResourceKey,
} from "@/lib/resources";
import { getAuthAdapter, type AdapterTier } from "@/lib/adapters";
import { getUsageMetrics } from "@/services/usage.service";
import { effectiveUsage } from "./usage-period";
import { PLAN_ORDER, type PlanKey } from "@/lib/config/plans";

type FeatureGateCheckResult = {
  allowed: boolean;
  reason?: string;
  currentUsage?: number;
  limit?: number;
  /* The plan the refusal was measured against, and the registry's own sentence
   * about what to do next. Both travel with the refusal so protectedProcedure
   * can put them on the structured error WITHOUT re-resolving the tier. */
  plan: PlanKey;
  upgradeMessage: string;
};

type UsageMetricsData = {
  resourceKey: LimitResourceKey;
  currentUsage: number;
  limit: number | null;
  available: number | null;
  percentage: number | null;
};

export type FeatureGateData = {
  usage: number;
  limit: number | null;
  atLimit: boolean;
  isUnlimited: boolean;
  featureName: string;
  /**
   * SOURCE OF TRUTH KEYWORDS: upgradeMessage, UPGRADE_COPY_FROM_REGISTRY
   *
   * The resource's own upgrade sentence, resolved against the plan this
   * organization is on — "Upgrade to Pro to invite more teammates". It ships
   * with EVERY gate, not only the ones currently at their limit, so a UI that
   * opens the upgrade modal never has to guess at the copy or re-derive the
   * next plan client-side. Written once on the registry entry; see
   * getUpgradeMessage in src/lib/resources.ts.
   */
  upgradeMessage: string;
};

/**
 * SOURCE OF TRUTH KEYWORDS: OrganizationTier
 *
 * WHAT:  The resolved plan summary for an organization.
 * WHY:   An alias of AdapterTier so the app keeps ONE tier shape no matter which
 *        provider produced it. The old shape leaked `stripeSubscriptionId`; the
 *        adapter contract names it `subscriptionId` because a different billing
 *        provider issues a different kind of id.
 * WHERE: Returned by getOrganizationTier; consumed by the billing router.
 */
export type OrganizationTier = AdapterTier;

/**
 * SOURCE OF TRUTH KEYWORDS: getOrganizationTier, PROVIDER_NEUTRAL_ENTITLEMENT
 *
 * WHAT:  Resolves an org's effective plan tier + subscription summary.
 * WHY:   The single read-point for "what plan is this org on right now". The
 *        lapse/trial/portal rules now live inside each EntitlementAdapter,
 *        because they are inherently provider-shaped: Better Auth reads the
 *        local Subscription row and its periodEnd, while a provider that owns
 *        billing would read its own subscription with its own trial flag. Every
 *        one returns the same AdapterTier, so nothing downstream changes. Still wrapped in `cache()` here so the many gate checks in a
 *        single request share one adapter round-trip.
 * WHERE: Used internally by the gate computations and by the billing router
 *        (src/trpc/routers/billing.ts). Implementations live in
 *        src/lib/adapters/<provider>/index.ts.
 */
export const getOrganizationTier = cache(
  async (organizationId: string): Promise<OrganizationTier> => {
    const adapter = await getAuthAdapter();
    return adapter.entitlement.getTier(organizationId);
  },
);

const getAllUsageMetrics = cache(async (organizationId: string) => {
  const tier = await getOrganizationTier(organizationId);
  const metrics = await prisma.usageMetrics.findMany({
    where: { organizationId },
  });

  const entries = LIMIT_RESOURCE_KEYS.map(
    (resourceKey): [LimitResourceKey, UsageMetricsData] => {
      const metric = metrics.find((m) => m.featureKey === resourceKey);
      /* PERIODIC_USAGE — see checkFeatureGate. The UI must agree with the
       * server's gate, so the same staleness rule is applied here. */
      const currentUsage = effectiveUsage(
        resourceKey,
        metric?.currentUsage ?? 0,
        metric?.lastResetAt,
      );
      const limit = getResourceLimitForPlan(resourceKey, tier.tier);
      const isUnlimited = !Number.isFinite(limit);

      return [
        resourceKey,
        {
          resourceKey,
          currentUsage,
          limit: isUnlimited ? null : limit,
          available: isUnlimited ? null : Math.max(0, limit - currentUsage),
          percentage:
            isUnlimited || limit === 0 ? null : (currentUsage / limit) * 100,
        },
      ];
    },
  );
  /* `Object.fromEntries` returns `Record<string, UsageMetricsData>` — TS can't
   * narrow the key union from the input tuple type. The cast forges the key
   * back to LimitResourceKey, which is sound here because `entries` is built
   * from LIMIT_RESOURCE_KEYS (every key in the union, no extras). */
  return Object.fromEntries(entries) as Record<
    LimitResourceKey,
    UsageMetricsData
  >;
});

/**
 * SOURCE OF TRUTH KEYWORDS: getFeatureGates, FeatureGateData
 *
 * WHAT:  Per-resource gate map (atLimit / isUnlimited / usage) for the UI.
 * WHY:   The UI needs a single boolean per resource to render disabled-state
 *        affordances; the server re-checks every mutation, so this is UX only.
 * WHERE: Exposed via usage.getFeatureGates; consumed by <FeatureGate>.
 */
export const getFeatureGates = cache(async (organizationId: string) => {
  const [tierData, usageMetrics] = await Promise.all([
    getOrganizationTier(organizationId),
    getAllUsageMetrics(organizationId),
  ]);

  const gates: Partial<Record<ResourceKey, FeatureGateData>> = {};

  for (const resourceKey of LIMIT_RESOURCE_KEYS) {
    const def = RESOURCES[resourceKey];
    const metrics = usageMetrics[resourceKey];
    const limit = getResourceLimitForPlan(resourceKey, tierData.tier);
    const isUnlimited = !Number.isFinite(limit);
    const usage = metrics?.currentUsage ?? 0;
    const blockedByTrial =
      tierData.isOnTrial && !def.limit.availableOnFreeTrial;
    const atLimit = blockedByTrial || (!isUnlimited && usage >= limit);

    gates[resourceKey] = {
      usage,
      limit: isUnlimited ? null : limit,
      atLimit,
      isUnlimited,
      featureName: def.name,
      upgradeMessage: getUpgradeMessage(resourceKey, tierData.tier),
    };
  }

  for (const resourceKey of FLAG_RESOURCE_KEYS) {
    const def = RESOURCES[resourceKey];
    const enabled = getResourceFlagForPlan(resourceKey, tierData.tier);
    const blockedByTrial = tierData.isOnTrial && !def.flag.availableOnFreeTrial;

    gates[resourceKey] = {
      usage: 0,
      limit: null,
      atLimit: blockedByTrial || !enabled,
      isUnlimited: false,
      featureName: def.name,
      upgradeMessage: getUpgradeMessage(resourceKey, tierData.tier),
    };
  }

  return {
    tier: tierData.tier,
    planName: tierData.planName,
    isOnTrial: tierData.isOnTrial,
    gates,
  };
});

/**
 * SOURCE OF TRUTH KEYWORDS: checkFeatureGate
 *
 * WHAT:  Can this organization consume `incrementBy` more of a limit resource?
 * WHY:   Used ONLY by the procedure builder's AUTO_DERIVED_FROM_RESOURCES
 *        gating on `<resource>.create`. Routers never call this directly and
 *        never opt in — the registry entry's `limit` IS the contract.
 *        Returns `allowed: true` immediately for unlimited tiers, so there is
 *        no need (or option) to "skip" the check.
 * WHERE: Called from src/trpc/procedures/protected.ts during the auth →
 *        permission → limit chain.
 */
export async function checkFeatureGate(
  organizationId: string,
  resourceKey: LimitResourceKey,
  incrementBy: number = 1,
): Promise<FeatureGateCheckResult> {
  const def = RESOURCES[resourceKey];
  const tier = await getOrganizationTier(organizationId);
  const upgradeMessage = getUpgradeMessage(resourceKey, tier.tier);

  if (tier.isOnTrial && !def.limit.availableOnFreeTrial) {
    return {
      allowed: false,
      reason: `${def.name} is not available during your free trial. Upgrade to a paid plan to access it.`,
      plan: tier.tier,
      upgradeMessage,
    };
  }

  const limit = getResourceLimitForPlan(resourceKey, tier.tier);
  if (!Number.isFinite(limit))
    return { allowed: true, plan: tier.tier, upgradeMessage };

  const metrics = await getUsageMetrics(organizationId, resourceKey);
  /* PERIODIC_USAGE: a counter from a closed window reads as zero. The
   * usage.reset cron tidies the rows, but the gate must be correct whether or
   * not it has run — a stalled cron would otherwise leave every customer on a
   * permanently exhausted quota. */
  const currentUsage = effectiveUsage(
    resourceKey,
    metrics?.currentUsage ?? 0,
    metrics?.lastResetAt,
  );

  if (currentUsage + incrementBy > limit) {
    return {
      allowed: false,
      reason: `You have reached your plan limit for ${def.name}. Current usage: ${currentUsage}/${limit}. Upgrade your plan to continue.`,
      currentUsage,
      limit,
      plan: tier.tier,
      upgradeMessage,
    };
  }

  return {
    allowed: true,
    currentUsage,
    limit,
    plan: tier.tier,
    upgradeMessage,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkBooleanFeature
 *
 * WHAT:  Is this flag-resource available for this organization right now — plus
 *        the plan it was judged against and the registry's upgrade sentence, so
 *        a refusal can be explained without a second tier read.
 * WHY:   Used ONLY by the procedure builder's AUTO_DERIVED_FROM_RESOURCES
 *        flag gating — runs automatically for every verb on a resource whose
 *        RESOURCES entry declares a `flag`. Routers never call this directly
 *        and never declare `requireFlag` — declaring the `flag` on the
 *        registry entry is the only way to wire it.
 * WHERE: Called from src/trpc/procedures/protected.ts.
 */
export async function checkBooleanFeature(
  organizationId: string,
  resourceKey: FlagResourceKey,
): Promise<{ enabled: boolean; plan: PlanKey; upgradeMessage: string }> {
  const def = RESOURCES[resourceKey];
  const tier = await getOrganizationTier(organizationId);
  const upgradeMessage = getUpgradeMessage(resourceKey, tier.tier);
  const blockedByTrial = tier.isOnTrial && !def.flag.availableOnFreeTrial;
  return {
    enabled: blockedByTrial
      ? false
      : getResourceFlagForPlan(resourceKey, tier.tier),
    plan: tier.tier,
    upgradeMessage,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: DowngradeBlocker, getDowngradeBlockers,
 *   DOWNGRADE_REQUIRES_CLEANUP
 *
 * WHAT:  Everything an organization is currently using that a target plan would
 *        not allow — the reasons a downgrade must be refused.
 * WHY:   DOWNGRADE_REQUIRES_CLEANUP. Letting a downgrade through leaves the
 *        tenant permanently over its cap: nothing is deleted, new creates are
 *        blocked, and there is no lever to recover. Deferring the change to the
 *        period end only relocates that — at the deadline the same excess is
 *        still there. So the block happens at the moment of intent, while the
 *        user still has the higher plan and can act.
 *        DERIVED ENTIRELY FROM RESOURCES. Every limit resource is compared
 *        against the target plan's cap and every flag against the target plan's
 *        availability, so a resource added to the registry tomorrow is enforced
 *        here with no code change. Nothing in this file names a resource, and
 *        the user-facing copy comes from `name` and `unit` on the registry entry
 *        via formatLimitValue — the same helper the pricing cards use.
 * WHERE: Exposed through the usage router; consumed by the downgrade guard on
 *        the billing screen.
 */
export interface DowngradeBlocker {
  resource: ResourceKey;
  /** Display name from the registry entry. */
  name: string;
  /** What the organization is using now, pre-formatted for display. */
  current: string;
  /** What the target plan permits, pre-formatted, or null for a flag. */
  allowed: string | null;
  /** How many units must go before the downgrade can proceed. Null for flags. */
  excess: number | null;
  /** True when the target plan drops the feature entirely rather than capping it. */
  isFeatureLoss: boolean;
}

/* Every limit resource whose usage exceeds what `plan` permits, in the shape the
 * UI renders. Shared by the downgrade check (measured against the plan being
 * moved TO) and the overage check (measured against the plan the org is already
 * ON) so both read one implementation and one copy source. Walks
 * LIMIT_RESOURCE_KEYS — it names no resource. */
function collectLimitExcess(
  usageMetrics: Record<LimitResourceKey, UsageMetricsData>,
  plan: PlanKey,
): DowngradeBlocker[] {
  const excess: DowngradeBlocker[] = [];

  for (const resourceKey of LIMIT_RESOURCE_KEYS) {
    const def = RESOURCES[resourceKey];
    const usage = usageMetrics[resourceKey]?.currentUsage ?? 0;
    const allowed = getResourceLimitForPlan(resourceKey, plan);
    if (!Number.isFinite(allowed) || usage <= allowed) continue;

    excess.push({
      resource: resourceKey,
      name: def.name,
      current: formatLimitValue(usage, def.name, def.limit),
      allowed: formatLimitValue(allowed, def.name, def.limit),
      excess: usage - allowed,
      isFeatureLoss: false,
    });
  }

  return excess;
}

export const getDowngradeBlockers = cache(
  async (
    organizationId: string,
    targetPlan: PlanKey,
  ): Promise<DowngradeBlocker[]> => {
    const [tier, usageMetrics] = await Promise.all([
      getOrganizationTier(organizationId),
      getAllUsageMetrics(organizationId),
    ]);

    /* Only a move DOWN can strand a tenant over its cap. */
    if (PLAN_ORDER.indexOf(targetPlan) >= PLAN_ORDER.indexOf(tier.tier))
      return [];

    const blockers: DowngradeBlocker[] = collectLimitExcess(
      usageMetrics,
      targetPlan,
    );

    for (const resourceKey of FLAG_RESOURCE_KEYS) {
      const def = RESOURCES[resourceKey];
      const haveNow = getResourceFlagForPlan(resourceKey, tier.tier);
      const haveAfter = getResourceFlagForPlan(resourceKey, targetPlan);
      /* Losing a feature is not something the user can "clean up" — it is
       * surfaced so the consequence is explicit, not so it can be resolved. */
      if (!haveNow || haveAfter) continue;

      blockers.push({
        resource: resourceKey,
        name: def.name,
        current: "Included",
        allowed: null,
        excess: null,
        isFeatureLoss: true,
      });
    }

    return blockers;
  },
);

/**
 * SOURCE OF TRUTH KEYWORDS: DowngradeBlockerMap, getDowngradeBlockerMap,
 *   WHOLE_LADDER_IN_ONE_READ
 *
 * WHAT:  Blockers for EVERY purchasable plan, in one round trip.
 * WHY:   WHOLE_LADDER_IN_ONE_READ. The plan picker shows the entire ladder at
 *        once, so it needs every plan's verdict at once — querying per selection
 *        would put a loading gap in the middle of the interaction, and the guard
 *        has to fail CLOSED during that gap, which reads as a plan flickering
 *        between available and blocked as the user clicks around. One read also
 *        lets a blocked plan be marked on its own card BEFORE it is picked,
 *        rather than only being refused afterwards.
 *        Keyed by PlanKey rather than `string` so a caller cannot look a plan up
 *        by a name that is not a plan. PARTIAL because PLAN_ORDER is only the
 *        purchasable ladder — the hidden portal tier is not in it.
 *        Still registry-driven — it just calls getDowngradeBlockers per plan.
 * WHERE: Exposed through the usage router; consumed by <ChangePlanDialog />.
 *        ENFORCEMENT is separate and server-side, in billing.upgradeOrganization.
 */
export type DowngradeBlockerMap = Partial<Record<PlanKey, DowngradeBlocker[]>>;

/**
 * SOURCE OF TRUTH KEYWORDS: getPlanOverages, PlanOverageState, OVER_PLAN_STATE,
 *   DOWNGRADE_REQUIRES_CLEANUP
 *
 * WHAT:  What the organization is using beyond what its CURRENT plan allows.
 * WHY:   OVER_PLAN_STATE. The guard on the plan-change dialog is a UX
 *        affordance; billing.upgradeOrganization is the boundary. Neither covers
 *        every route INTO the state: a plan can also change from a Stripe-side
 *        edit, a webhook replaying a cancellation, a support action, or an admin
 *        editing the plan's features. Chasing each new surface is a losing game,
 *        so this detects the state from the OUTCOME instead.
 *        So enforcement is not what this fixes — protectedProcedure already
 *        refuses every create past the cap, AUTO_DERIVED_FROM_RESOURCES,
 *        whatever route the org took to get there. What was missing is that
 *        nobody was TOLD. This is the single read that detects the state from
 *        the outcome instead of the cause: usage vs. the plan in force, so it
 *        covers bypass routes we have not thought of.
 *        Limits only. A flag the plan no longer includes is already invisible
 *        everywhere it matters and cannot be "reduced", so listing it here
 *        would give the user an instruction they cannot follow.
 *        DERIVED FROM RESOURCES via collectLimitExcess — a resource added to
 *        the registry tomorrow is reported here with no code change.
 * WHERE: Exposed by the usage router; prefetched in the dashboard layout and
 *        rendered by <PlanOverageBanner />.
 */
export const getPlanOverages = cache(
  async (organizationId: string): Promise<DowngradeBlocker[]> => {
    const [tier, usageMetrics] = await Promise.all([
      getOrganizationTier(organizationId),
      getAllUsageMetrics(organizationId),
    ]);
    return collectLimitExcess(usageMetrics, tier.tier);
  },
);

export const getDowngradeBlockerMap = cache(
  async (organizationId: string): Promise<DowngradeBlockerMap> => {
    const entries = await Promise.all(
      PLAN_ORDER.map(async (plan): Promise<[PlanKey, DowngradeBlocker[]]> => [
        plan,
        await getDowngradeBlockers(organizationId, plan),
      ]),
    );
    /* Built by reduce rather than Object.fromEntries: fromEntries widens the key
     * back to `string`, which is the typing this map exists to avoid. */
    return entries.reduce<DowngradeBlockerMap>((map, [plan, blockers]) => {
      map[plan] = blockers;
      return map;
    }, {});
  },
);
