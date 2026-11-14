/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: billingIntervalSchema, planKeySchema,
 *   createSubscriptionSchema, upgradeSubscriptionSchema,
 *   paymentMethodIdSchema, CreateSubscriptionValues, UpgradeSubscriptionValues
 *
 * WHAT:  Zod schemas + inferred types for the billing inputs (create / upgrade
 *        subscription, payment-method ops).
 * WHY:   One contract per input surface (CLAUDE.md). planKey/interval validate
 *        against the literal unions from src/lib/config/plans so a bad tier or
 *        interval can't reach Stripe.
 * WHERE: Imported by src/trpc/routers/billing.ts and the billing / onboarding
 *        UI. Re-exported via src/lib/types.
 */

import { z } from "zod";

import type { BillingInterval, PlanKey } from "@/lib/config/plans";
import type { ResourceKey } from "@/lib/resources";

const organizationIdSchema = z.string().min(1, "Organization ID is required.");

export const billingIntervalSchema = z.enum(["monthly", "yearly"]);

/* `free` is excluded — you don't create a Stripe subscription for free. */
export const planKeySchema = z.enum(["starter", "pro", "enterprise"]);

export const paymentMethodIdSchema = z
  .string()
  .min(1, "Payment method is required.");

export const createSubscriptionSchema = z.object({
  organizationId: organizationIdSchema,
  planKey: planKeySchema,
  billingInterval: billingIntervalSchema,
  paymentMethodId: paymentMethodIdSchema,
  /* What the UI promised: true when it showed a free-trial offer. The server
   * uses it to surface a clear TRIAL_ALREADY_USED error (rather than silently
   * charging) when the card/user has already consumed a trial. */
  expectTrial: z.boolean().optional(),
});

export const upgradeSubscriptionSchema = z.object({
  organizationId: organizationIdSchema,
  planKey: planKeySchema,
  billingInterval: billingIntervalSchema,
});

/**
 * SOURCE OF TRUTH KEYWORDS: PurchasablePlanKey, isPurchasablePlan, planKeySchema
 *
 * WHAT:  The plans a user can actually check out with, and the guard that
 *        narrows an arbitrary PlanKey to one.
 * WHY:   Derived from planKeySchema rather than re-listing the paid tiers, so
 *        the pricing UI, the router input and this guard can never disagree
 *        about what is buyable. The UI renders `free` and could be handed
 *        `portal`; the guard is where that becomes a compile-time-safe
 *        narrowing instead of a cast.
 * WHERE: <UpgradeContent /> before calling billing.createSubscription /
 *        billing.upgradeOrganization.
 */
export type PurchasablePlanKey = z.infer<typeof planKeySchema>;

export function isPurchasablePlan(plan: string): plan is PurchasablePlanKey {
  return planKeySchema.safeParse(plan).success;
}

export type CreateSubscriptionValues = z.infer<typeof createSubscriptionSchema>;
export type UpgradeSubscriptionValues = z.infer<
  typeof upgradeSubscriptionSchema
>;

/**
 * SOURCE OF TRUTH KEYWORDS: PlanPrice, AvailablePlan, PRICES_LIVE_IN_STRIPE,
 *   getAvailablePlans, UpgradeModal, PricingCard
 *
 * WHAT:  One plan as the pricing UI needs it — identity and trial length from
 *        PLANS, the two recurring amounts read live from the billing provider.
 * WHY:   PRICES_LIVE_IN_STRIPE. An amount typed into this repo is a copy of a
 *        number the payment provider already owns, and the copy is wrong the
 *        first time anyone edits the price in the dashboard — including for
 *        customers already on that price. So the card reads the amount from the
 *        provider and everything ELSE (caps, flags, trial length, plan name)
 *        from the registry, which is the side the app owns. `amount` is in the
 *        currency's MINOR unit exactly as the provider states it, so no rounding
 *        happens before formatCurrency, which is the one place that knows how
 *        many decimals a currency has.
 *        Both prices are nullable: a plan whose price id is unset, or a Stripe
 *        account that isn't configured yet, must render as "not available"
 *        rather than crash the pricing grid on a fresh clone.
 * WHERE: Produced by listPlanPrices (src/services/payment.service.ts), served by
 *        billing.getAvailablePlans, rendered by <PricingCard />.
 */
export interface PlanPrice {
  /** Minor units (cents) as the provider states them. */
  amount: number;
  /** ISO 4217, lower-case, as returned by the provider. */
  currency: string;
  interval: BillingInterval;
}

export interface AvailablePlan {
  key: PlanKey;
  name: string;
  description: string;
  icon: string;
  showPlan: boolean;
  trialDays: number;
  isFree: boolean;
  monthlyPrice: PlanPrice | null;
  yearlyPrice: PlanPrice | null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: DowngradeBlocker, DowngradeBlockerMap,
 *   DOWNGRADE_REQUIRES_CLEANUP, TYPES_LIVE_IN_LIB_TYPES
 *
 * WHAT:  Everything an organization is currently using that a target plan would
 *        not allow — the reasons a downgrade must be refused — and the per-plan
 *        map of them the billing screen reads.
 *
 * WHY:   TYPES_LIVE_IN_LIB_TYPES, and here that is a security boundary rather
 *        than tidiness. These two describe the SHAPE of a gate decision, while
 *        computing one needs Prisma — so they used to live in
 *        src/lib/feature-gate.ts beside the queries. That module could not then
 *        take `import 'server-only'`, because the billing screen's client
 *        components import these types from it; the whole gate decider stayed
 *        importable from a browser bundle to keep two type imports working.
 *        Moving the types here costs nothing (`import type` is erased either
 *        way) and let the decider be sealed.
 * WHERE: Produced by getDowngradeBlockers / getDowngradeBlockerMap in
 *        src/lib/feature-gate.ts; consumed by the usage router, the downgrade
 *        guard on the billing screen, plan-selector and usage-limit-list.
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

export type DowngradeBlockerMap = Partial<Record<PlanKey, DowngradeBlocker[]>>;

/**
 * SOURCE OF TRUTH KEYWORDS: ENTITLED_SUBSCRIPTION_STATUSES,
 *   ENTITLED_STATUSES_ARE_AN_ALLOWLIST, SUBSCRIPTION_STATUS_IS_A_STRING
 *
 * WHAT:  The `Subscription.status` values that still carry a paid plan's
 *        entitlements.
 *
 * WHY:   ENTITLED_STATUSES_ARE_AN_ALLOWLIST. An entitlement resolver that reads
 *        the status column for one value and ignores the rest hands the paid
 *        tier to `canceled`, `unpaid`, `incomplete` and `incomplete_expired`
 *        subscriptions for as long as `periodEnd` is in the future — which is
 *        how a cancelled customer keeps full access until their old period runs
 *        out. Listing what IS entitled means a status nobody anticipated
 *        withholds the plan instead of granting it.
 *
 *        `past_due` is included on purpose. The provider retries a failed charge
 *        over several days, and cutting off a customer whose card is about to
 *        succeed is the worse error; `canceled` is excluded because nothing is
 *        still being attempted. That is a BUSINESS decision, which is why it is
 *        declared here as data rather than buried in an adapter's control flow.
 *
 *        SUBSCRIPTION_STATUS_IS_A_STRING: the Prisma column is a `String` with
 *        no enum block, so this list is the only thing standing between a
 *        provider's new status value and an accidental entitlement.
 * WHERE: Every EntitlementAdapter's getTier — currently
 *        src/lib/adapters/better-auth/index.ts. A provider that owns
 *        subscriptions should map its own statuses onto these before comparing.
 */
export const ENTITLED_SUBSCRIPTION_STATUSES: readonly string[] = [
  "active",
  "trialing",
  "past_due",
];
