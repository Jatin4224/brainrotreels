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
