/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: useUpgradeNudge, UpgradeNudge, UpgradeNudgeReason,
 *   UPGRADE_NUDGE_COPY, SidebarUpgradeNudge, getYearlySavings, NOTHING_TO_SELL
 *
 * WHAT:  The single most useful upgrade this organization could make right now,
 *        as one short sentence — or null when there is nothing honest to offer.
 * WHY:   NOTHING_TO_SELL is a real answer and the hard part of this hook. An
 *        organization on the top plan, billed yearly, has bought everything;
 *        showing it a permanent "upgrade" line would be an advert for a product
 *        it already owns, and the user learns to stop reading that corner of the
 *        screen — which costs us the ONE moment the line matters.
 *        The order below is the order of what the org would actually gain:
 *        a trial is time-limited, so it outranks everything; a free plan is the
 *        biggest jump; a monthly payer is offered money back before being asked
 *        for more; and only then is a higher tier suggested.
 *        Every fact is read, never assumed — the tier from the same gate map the
 *        server enforces, the interval from the subscription, the discount from
 *        the provider's own prices. Nothing here names a plan or a price.
 *        Returns null until the reads it needs have landed, so the line appears
 *        once, already correct, rather than appearing and then rewording itself
 *        (all of them are prefetched by the dashboard layout).
 * WHERE: <SidebarUpgradeNudge />; available to any surface that wants the same
 *        one-line pitch.
 */

import { formatCurrency } from "@/lib/utils";
import {
  BRANDING,
  PLANS,
  getNextPlan,
  isPaidPlan,
  type PlanKey,
} from "@/lib/config";
import { trpc } from "@/trpc/react-provider";
import { permissions } from "@/lib/permissions";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { getYearlySavings } from "./pricing-math";

export type UpgradeNudgeReason = "trial" | "free" | "yearly" | "tier";

/**
 * SOURCE OF TRUTH KEYWORDS: UpgradeNudge, UpgradeNudgeVariant, TWO_VOLUMES
 *
 * WHAT:  The nudge to show, discriminated by how loudly it should be shown.
 * WHY:   TWO_VOLUMES. A visitor who has never paid — free plan, or mid-trial —
 *        has not made the decision the product is asking for, so that nudge is
 *        a card with a button. A paying customer moving between tiers or
 *        billing periods HAS decided; that nudge is one muted line, because a
 *        permanent advert pointed at an existing customer is how a UI teaches
 *        someone to stop looking at a corner of the screen.
 *        A union rather than an optional-fields bag so the renderer cannot read
 *        a card field off an inline nudge — the compiler decides which shape is
 *        legal, not a runtime check.
 *        `targetPlan` is the plan being SOLD and is deliberately not always the
 *        next tier: a Pro trial converts to Pro. `message` exists on both
 *        because the collapsed sidebar has room for a tooltip and nothing else.
 * WHERE: <SidebarUpgradeNudge /> renders it; the CTA opens the upgrade modal
 *        already on `targetPlan`.
 */
export type UpgradeNudge =
  | {
      variant: "inline";
      reason: "tier" | "yearly";
      targetPlan: PlanKey;
      /** One line, ready to render. */
      message: string;
    }
  | {
      variant: "card";
      reason: "free" | "trial";
      targetPlan: PlanKey;
      /** Tooltip text when the sidebar is collapsed to icons. */
      message: string;
      /** The plan they are on now — "Free", "Pro trial". */
      currentPlanLabel: string;
      body: string;
      ctaLabel: string;
    };

const NUDGE_QUERY_OPTIONS = { staleTime: 5 * 60 * 1000 } as const;

export function useUpgradeNudge(): UpgradeNudge | null {
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const canReadBilling = hasPermission(permissions.BILLING_READ);

  const gatesQuery = trpc.usage.getFeatureGates.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: organizationId !== undefined, ...NUDGE_QUERY_OPTIONS },
  );
  const plansQuery = trpc.billing.getAvailablePlans.useQuery(
    undefined,
    NUDGE_QUERY_OPTIONS,
  );
  /* Only a billing reader can be told which interval they are on; for everyone
   * else the yearly branch is simply unreachable and the tier branch answers. */
  const subscriptionQuery = trpc.billing.getSubscription.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled: organizationId !== undefined && canReadBilling,
      ...NUDGE_QUERY_OPTIONS,
    },
  );

  const gates = gatesQuery.data;
  const plans = plansQuery.data;
  if (!gates || !plans) return null;

  const tier: PlanKey = gates.tier;
  /* The hidden platform-admin tier is not on the ladder and is not sold. */
  if (tier === "portal") return null;

  const nextPlan = getNextPlan(tier);

  /* A trial converts to the plan being trialled — the user is already using
   * that tier, and offering them the one above it would be selling past what
   * they came to buy. Free upgrades to the next rung instead. */
  if (gates.isOnTrial) {
    return buildCardNudge(
      "trial",
      tier,
      `${gates.planName} ${BRANDING.upgradeNudge.trialPlanSuffix}`,
    );
  }

  if (!isPaidPlan(tier)) {
    /* A free plan with nothing above it is a single-tier product — there is
     * nothing to upgrade TO, so say nothing. */
    if (!nextPlan) return null;
    return buildCardNudge("free", nextPlan, gates.planName);
  }

  /* Money back before money out: a monthly payer is offered the yearly discount
   * on the plan they are ALREADY on before being asked to move up a tier. */
  if (subscriptionQuery.data?.billingInterval === "monthly") {
    /* Undefined when the org's plan is hidden from the catalogue; no prices
     * means no discount to quote, which the next branch handles. */
    const currentPlan = plans.find((plan) => plan.key === tier);
    const savings = currentPlan ? getYearlySavings(currentPlan) : null;
    if (savings) {
      return {
        variant: "inline",
        reason: "yearly",
        /* The same plan, bought for a year instead of a month. */
        targetPlan: tier,
        message: BRANDING.upgradeNudge.yearlyBody.replace(
          "{amount}",
          formatCurrency(savings.amount, savings.currency),
        ),
      };
    }
  }

  if (nextPlan) {
    return {
      variant: "inline",
      reason: "tier",
      targetPlan: nextPlan,
      message: interpolate(BRANDING.upgradeNudge.tierBody, nextPlan),
    };
  }

  /* Top plan, billed yearly — they already have everything we sell. */
  return null;
}

/* The card's three strings all name the same plan, so they are built together
 * from one interpolation rather than three call sites that could drift. */
function buildCardNudge(
  reason: "free" | "trial",
  targetPlan: PlanKey,
  currentPlanLabel: string,
): UpgradeNudge {
  const ctaLabel = interpolate(BRANDING.upgradeNudge.cardCtaLabel, targetPlan);
  return {
    variant: "card",
    reason,
    targetPlan,
    currentPlanLabel,
    body: interpolate(BRANDING.upgradeNudge.cardBody, targetPlan),
    ctaLabel,
    /* Collapsed, the card is one icon — the CTA is the only line worth keeping. */
    message: ctaLabel,
  };
}

function interpolate(template: string, plan: PlanKey): string {
  return template.replace("{targetPlan}", PLANS[plan].name);
}
