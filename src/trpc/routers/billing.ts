/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: billingRouter
 *
 * WHAT:  Stripe billing — read the plan catalogue with live prices, read the
 *        current plan + payment methods, create a subscription (custom Elements
 *        flow), manage payment methods, and cancel / reactivate / upgrade.
 * WHY:   Built on protectedProcedure so auth + billing:* permission gates +
 *        audit are automatic. The DB Subscription row is written by the webhook
 *        (the single writer), not these handlers — mutations here only talk to
 *        Stripe. txTimeout is raised on createSubscription because the handler
 *        makes several sequential Stripe calls inside the factory's tx.
 *        DOWNGRADE_REQUIRES_CLEANUP: upgradeOrganization refuses a move DOWN
 *        that would strand the tenant over the target plan's caps — see
 *        ensureDowngradeIsSafe.
 * WHERE: Mounted as `billing` in src/trpc/routers/_app. Services:
 *        payment.service (customer/cards), config/stripe (client), plans
 *        (price ids), feature-gate (current tier).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter } from "../init";
import { protectedProcedure, authProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import {
  createSubscriptionSchema,
  upgradeSubscriptionSchema,
  paymentMethodIdSchema,
} from "@/lib/types";
import {
  getStripeClient,
  isStripeConfigured,
  getPlanPriceId,
  PLANS,
  type PlanKey,
} from "@/lib/config";
import { getDowngradeBlockers, getOrganizationTier } from "@/lib/feature-gate";
import {
  ensureStripeCustomer,
  resolveExistingStripeCustomerId,
  listPaymentMethods,
  listPlanPrices,
  attachPaymentMethod,
  setDefaultPaymentMethod,
  detachPaymentMethod,
  getOrganizationSubscription,
} from "@/services/payment.service";
import {
  hasUserAnyTrialUsedFingerprint,
  hasUserUsedFreeTrial,
  storeCardFingerprint,
} from "@/services/card-fingerprint.service";

const orgInput = z.object({ organizationId: z.string().min(1) });

function ensureConfigured(): void {
  if (!isStripeConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Billing is not configured. Set STRIPE_SECRET_KEY to enable it.",
    });
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: ensureDowngradeIsSafe, DOWNGRADE_REQUIRES_CLEANUP,
 *   getDowngradeBlockers, DowngradeBlocker
 *
 * WHAT:  Refuses a plan change that would leave the organization above the
 *        target plan's caps, naming exactly what has to come down first.
 * WHY:   DOWNGRADE_REQUIRES_CLEANUP. Once the downgrade lands the tenant is over
 *        its cap with nothing deleted, new creates blocked by
 *        protectedProcedure, and no lever to recover — deferring to the period
 *        end only relocates that, because the same excess is still there at the
 *        deadline. Blocking at the moment of intent is the only version that
 *        resolves, because the user still holds the higher plan and can act.
 *        THE BOUNDARY IS HERE, not in the dialog. The dialog's guard is an
 *        affordance that explains the refusal early; this is what makes it true
 *        for a direct tRPC call, a stale client, or a second tab.
 *        Over-cap usage blocks; LOSING A FLAG FEATURE DOES NOT. Feature loss
 *        cannot be resolved by deleting anything, so treating it as a blocker
 *        would trap a customer on a plan they want to leave — it is disclosed in
 *        the dialog and the switch proceeds.
 *        Names no resource: the blockers are DERIVED FROM RESOURCES, so a
 *        resource added to the registry tomorrow is enforced here unchanged.
 * WHERE: Called by upgradeOrganization below, before any Stripe write. Same read
 *        the dialog uses through usage.getDowngradeBlockerMap.
 */
async function ensureDowngradeIsSafe(
  organizationId: string,
  targetPlan: PlanKey,
): Promise<void> {
  const blockers = await getDowngradeBlockers(organizationId, targetPlan);
  const mustResolve = blockers.filter((blocker) => !blocker.isFeatureLoss);
  if (mustResolve.length === 0) return;

  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      `${PLANS[targetPlan].name} does not cover everything this organization is ` +
      `using. Reduce the following first: ` +
      mustResolve
        .map(
          (blocker) =>
            `${blocker.name} (using ${blocker.current}, allows ${blocker.allowed})`,
        )
        .join("; "),
  });
}

async function requireCustomerId(organizationId: string): Promise<string> {
  const customerId = await resolveExistingStripeCustomerId(organizationId);
  if (!customerId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No billing customer for this organization",
    });
  }
  return customerId;
}

export const billingRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: getAvailablePlans, AvailablePlan,
   *   PRICES_LIVE_IN_STRIPE, UpgradeModal
   *
   * WHAT:  Every purchasable plan with its live monthly/yearly amount.
   * WHY:   Runs on authProcedure (identity, no org scope) for the same reason
   *        user.getProfile does: the answer does not depend on which
   *        organization is active, so demanding an organizationId would be a
   *        tenant boundary around data that has no tenant. Nothing here is
   *        tenant data — it is the same price list a marketing page would show.
   *        Deliberately not permission-gated either: ANY member can hit a plan
   *        limit, and gating the catalogue behind `billing:read` would show the
   *        person who hit the wall a pricing grid with no prices in it. BUYING
   *        is what's gated, on createSubscription / upgradeOrganization below.
   * WHERE: <UpgradeContent /> in src/components/global/upgrade-modal.
   */
  getAvailablePlans: authProcedure.query(async () => listPlanPrices()),

  /**
   * SOURCE OF TRUTH KEYWORDS: getTrialEligibility, TRIAL_ABUSE_PREVENTION,
   *   hasUserAnyTrialUsedFingerprint
   *
   * WHAT:  Whether this USER can still start a free trial anywhere.
   * WHY:   The pricing cards must not advertise "14-day trial" to someone who
   *        has already had one — they would click expecting no charge and be
   *        charged, which createSubscription refuses outright (TRIAL_ALREADY_USED).
   *        Reading it up front turns a hard refusal at the payment step into copy
   *        that was honest from the first screen. Card-level fingerprint checks
   *        still run server-side at purchase; this is the user-level half, which
   *        is the only half knowable before a card is chosen.
   *        Also authProcedure: trial history belongs to the USER, not to one of
   *        their organizations — a trial burned in one workspace is burned
   *        everywhere, which is the whole point of the fingerprint check.
   * WHERE: <UpgradeContent /> strips trial badges when this is true.
   */
  getTrialEligibility: authProcedure.query(async ({ ctx }) => ({
    hasUsedTrial: await hasUserAnyTrialUsedFingerprint(ctx.user.id),
  })),

  getSubscription: protectedProcedure({
    requirePermission: permissions.BILLING_READ,
  })
    .input(orgInput)
    .query(async ({ input }) => {
      const [tier, subscription] = await Promise.all([
        getOrganizationTier(input.organizationId),
        getOrganizationSubscription(input.organizationId),
      ]);
      /* Interval is inferred from the period length (a yearly period spans
       * well over 60 days), matching how the tier resolver reasons about it. */
      let billingInterval: "monthly" | "yearly" | null = null;
      if (subscription?.periodStart && subscription.periodEnd) {
        const days =
          (subscription.periodEnd.getTime() -
            subscription.periodStart.getTime()) /
          (1000 * 60 * 60 * 24);
        billingInterval = days > 60 ? "yearly" : "monthly";
      }

      return {
        tier: tier.tier,
        planName: tier.planName,
        isOnTrial: tier.isOnTrial,
        billingInterval,
        subscription: subscription
          ? {
              plan: subscription.plan,
              status: subscription.status,
              periodEnd: subscription.periodEnd,
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
              trialEnd: subscription.trialEnd,
            }
          : null,
      };
    }),

  getPaymentMethods: protectedProcedure({
    requirePermission: permissions.BILLING_READ,
  })
    .input(orgInput)
    .query(async ({ input }) => listPaymentMethods(input.organizationId)),

  /* Custom Elements flow: client collects the card → paymentMethodId → here we
   * create the customer, attach the card as default, and create the
   * subscription. The webhook writes the DB Subscription row. */
  createSubscription: protectedProcedure({
    requirePermission: permissions.BILLING_CREATE,
    txTimeout: 20_000,
    audit: { entity: "subscription", action: "create" },
  })
    .input(createSubscriptionSchema)
    .mutation(async ({ ctx, input }) => {
      ensureConfigured();
      const priceId = getPlanPriceId(input.planKey, input.billingInterval);
      if (!priceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No Stripe price configured for ${input.planKey} (${input.billingInterval})`,
        });
      }

      const stripe = getStripeClient();
      const userId = ctx.user.id;
      const customerId = await ensureStripeCustomer(input.organizationId, {
        email: ctx.user.email,
        name: ctx.user.name,
      });

      await attachPaymentMethod(customerId, input.paymentMethodId, true);

      const trialDays = PLANS[input.planKey].trialDays;

      /* Trial-abuse prevention: a trial is granted only if the plan offers one
       * AND neither this user nor this physical card (Stripe fingerprint) has
       * used a trial before. */
      const [userHasUsedTrial, cardHasUsedTrial] = await Promise.all([
        hasUserAnyTrialUsedFingerprint(userId),
        hasUserUsedFreeTrial(userId, input.paymentMethodId),
      ]);
      const shouldApplyTrial =
        trialDays > 0 && !userHasUsedTrial && !cardHasUsedTrial;

      /* The UI promised a trial but the card/user already used one — record the
       * card as used and refuse, so we never silently charge instead. */
      if (input.expectTrial && (userHasUsedTrial || cardHasUsedTrial)) {
        await storeCardFingerprint(userId, input.paymentMethodId, true);
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A free trial has already been used with this card.",
        });
      }

      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        default_payment_method: input.paymentMethodId,
        /* Persist the card as the customer default so renewals charge it. */
        payment_settings: { save_default_payment_method: "on_subscription" },
        /* userId is read by the webhook to mark the trial consumed once Stripe
         * confirms the subscription is trialing. */
        metadata: {
          organizationId: input.organizationId,
          planKey: input.planKey,
          userId,
        },
        ...(shouldApplyTrial
          ? {
              trial_period_days: trialDays,
              payment_behavior: "default_incomplete",
            }
          : { payment_behavior: "error_if_incomplete" }),
        expand: ["latest_invoice.payment_intent"],
      });

      /* Record the fingerprint. If we granted a trial, store it as NOT-yet-used
       * (the webhook flips it to used once Stripe confirms trialing). If a trial
       * was available but blocked, mark used now so it can't be reclaimed. For
       * no-trial plans, don't burn trial eligibility. Mirrors funnelmods. */
      const fingerprintUsed = shouldApplyTrial ? false : trialDays > 0;
      await storeCardFingerprint(
        userId,
        input.paymentMethodId,
        fingerprintUsed,
      );

      return { subscriptionId: subscription.id, status: subscription.status };
    }),

  addPaymentMethod: protectedProcedure({
    requirePermission: permissions.BILLING_UPDATE,
    audit: { entity: "subscription", action: "addPaymentMethod" },
  })
    .input(
      orgInput.extend({
        paymentMethodId: paymentMethodIdSchema,
        makeDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      ensureConfigured();
      const customerId = await ensureStripeCustomer(input.organizationId, {
        email: ctx.user.email,
        name: ctx.user.name,
      });
      await attachPaymentMethod(
        customerId,
        input.paymentMethodId,
        input.makeDefault ?? false,
      );
      return { success: true };
    }),

  setDefaultPaymentMethod: protectedProcedure({
    requirePermission: permissions.BILLING_UPDATE,
    audit: { entity: "subscription", action: "setDefaultPaymentMethod" },
  })
    .input(orgInput.extend({ paymentMethodId: paymentMethodIdSchema }))
    .mutation(async ({ input }) => {
      ensureConfigured();
      const customerId = await requireCustomerId(input.organizationId);
      await setDefaultPaymentMethod(customerId, input.paymentMethodId);
      return { success: true };
    }),

  deletePaymentMethod: protectedProcedure({
    requirePermission: permissions.BILLING_DELETE,
    audit: { entity: "subscription", action: "deletePaymentMethod" },
  })
    .input(orgInput.extend({ paymentMethodId: paymentMethodIdSchema }))
    .mutation(async ({ input }) => {
      ensureConfigured();
      /* Tenant guard lives in the service signature: detachPaymentMethod REQUIRES
       * the org's customerId and no-ops (returns false) for a card it doesn't own,
       * so a billing-admin can't detach another tenant's card by passing its id. */
      const customerId = await requireCustomerId(input.organizationId);
      const detached = await detachPaymentMethod(
        customerId,
        input.paymentMethodId,
      );
      if (!detached) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That payment method does not belong to this organization",
        });
      }
      return { success: true };
    }),

  cancelSubscription: protectedProcedure({
    requirePermission: permissions.BILLING_UPDATE,
    audit: { entity: "subscription", action: "cancel" },
  })
    .input(orgInput)
    .mutation(async ({ ctx, input }) => {
      ensureConfigured();
      const subscription = await getOrganizationSubscription(
        input.organizationId,
      );
      if (!subscription?.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active subscription to cancel",
        });
      }
      const stripe = getStripeClient();
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      /* Optimistic local reflection; the webhook will reconcile authoritatively. */
      await ctx.db.subscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: true },
      });
      return { success: true };
    }),

  reactivateSubscription: protectedProcedure({
    requirePermission: permissions.BILLING_UPDATE,
    audit: { entity: "subscription", action: "reactivate" },
  })
    .input(orgInput)
    .mutation(async ({ ctx, input }) => {
      ensureConfigured();
      const subscription = await getOrganizationSubscription(
        input.organizationId,
      );
      if (!subscription?.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No subscription to reactivate",
        });
      }
      const stripe = getStripeClient();
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });
      await ctx.db.subscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: false },
      });
      return { success: true };
    }),

  /* Change plan/interval on an existing subscription with proration, or create
   * a fresh one if none is active. The webhook syncs the resulting row. */
  upgradeOrganization: protectedProcedure({
    requirePermission: permissions.BILLING_UPDATE,
    txTimeout: 20_000,
    audit: { entity: "subscription", action: "upgrade" },
  })
    .input(upgradeSubscriptionSchema)
    .mutation(async ({ input }) => {
      ensureConfigured();
      /* Before ANY Stripe write — a refused downgrade must leave the
       * subscription exactly as it was. */
      await ensureDowngradeIsSafe(input.organizationId, input.planKey);
      const priceId = getPlanPriceId(input.planKey, input.billingInterval);
      if (!priceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No Stripe price configured for ${input.planKey} (${input.billingInterval})`,
        });
      }

      const stripe = getStripeClient();
      const subscription = await getOrganizationSubscription(
        input.organizationId,
      );

      if (subscription?.stripeSubscriptionId) {
        const current = await stripe.subscriptions.retrieve(
          subscription.stripeSubscriptionId,
        );
        const itemId = current.items.data[0]?.id;
        if (!itemId) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Subscription item missing",
          });
        }
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          items: [{ id: itemId, price: priceId }],
          proration_behavior: "always_invoice",
          metadata: {
            organizationId: input.organizationId,
            planKey: input.planKey,
          },
          ...(current.status === "trialing"
            ? { trial_end: "now" as const }
            : {}),
        });
        return {
          subscriptionId: subscription.stripeSubscriptionId,
          status: "updated",
        };
      }

      const customerId = await requireCustomerId(input.organizationId);
      const created = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: "error_if_incomplete",
        /* Charges the customer's existing default payment method and keeps it
         * as default for renewals. */
        payment_settings: { save_default_payment_method: "on_subscription" },
        metadata: {
          organizationId: input.organizationId,
          planKey: input.planKey,
        },
        expand: ["latest_invoice.payment_intent"],
      });
      return { subscriptionId: created.id, status: created.status };
    }),
});
