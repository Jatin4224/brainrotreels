/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: creditsRouter, credits.getBalance,
 *   credits.listLedger, credits.purchase, credits.getPacks,
 *   PACK_PRICE_IS_SERVER_SIDE, PAYMENT_BEFORE_CREDITS, LEDGER_NOT_A_COUNTER
 *
 * WHAT:  The surface for reading a workspace's credit balance and history, and
 *        for buying more.
 *
 * WHY:   LEDGER_NOT_A_COUNTER — nothing here is auto-gated or auto-counted by
 *        the procedure factory, and that is the point. `credits` declares
 *        neither `limit` nor `flag` in src/lib/resources.ts (see the note on
 *        that entry), so the factory gates nothing and bumps nothing; the
 *        balance lives in the ledger and the refusals are thrown by hand with
 *        `ERROR_CODES.INSUFFICIENT_CREDITS`.
 *
 *        PACK_PRICE_IS_SERVER_SIDE. The client names a PACK, never an amount
 *        and never a price. A client that could name its own credit amount
 *        could buy ten thousand credits for the price of five hundred, and a
 *        client that could name its own price could buy them for nothing. The
 *        pack key is looked up here, the Stripe price comes from the
 *        environment, and the credit amount comes from the code.
 *
 *        PAYMENT_BEFORE_CREDITS: the PaymentIntent is confirmed BEFORE a
 *        single credit is written. A failed card therefore produces no ledger
 *        row at all, rather than a grant that has to be clawed back — and
 *        clawing back credits that have already been spent on a render is not
 *        possible, which is why the ordering is not negotiable.
 *
 *        The flow follows the EXISTING billing surface: this codebase has no
 *        Stripe Checkout route and no Customer Portal, it has a custom
 *        Elements form (src/components/global/billing/), so a top-up is a
 *        PaymentIntent against a card the customer already attached — exactly
 *        as `billing.createSubscription` does. Introducing a Checkout redirect
 *        here would be a second payment flow for one product.
 * WHERE: Mounted as `credits` in src/trpc/routers/_app.ts. Reads and writes
 *        through src/services/credits.service.ts.
 */

import { TRPCError } from "@trpc/server";

import { createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import { getStripeClient, isStripeConfigured } from "@/lib/config";
import { ensureStripeCustomer } from "@/services/payment.service";
import * as creditsService from "@/services/credits.service";
import {
  CREDIT_PACKS,
  getBalanceSchema,
  listLedgerSchema,
  purchaseCreditsSchema,
  type CreditPackKey,
} from "@/lib/types";

/**
 * SOURCE OF TRUTH KEYWORDS: packPriceId, PACK_PRICE_IS_ENV_DRIVEN
 *
 * WHAT:  The Stripe price id configured for one pack.
 * WHY:   Read here, server-side, from the env var the pack NAMES — the pack
 *        table itself is imported by client code and must not read secrets.
 *        A pack with no price configured is simply not purchasable, which is
 *        the right failure: the alternative is a purchase that succeeds
 *        against a price of zero.
 * WHERE: `purchase` and `getPacks` below.
 */
function packPriceId(packKey: CreditPackKey): string | null {
  const key = CREDIT_PACKS[packKey].priceEnvKey;
  const value = process.env[key]?.trim();
  return value !== undefined && value.length > 0 ? value : null;
}

export const creditsRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: credits.getBalance
   *
   * WHAT:  What this workspace can spend right now.
   * WHY:   Holds are already deducted, because a hold IS a negative ledger row
   *        — so this is spendable balance and no caller has to remember to
   *        subtract anything in flight.
   * WHERE: The credits screen, and the cost label on every spending button.
   */
  getBalance: protectedProcedure({
    requirePermission: permissions.CREDITS_READ,
  })
    .input(getBalanceSchema)
    .query(async ({ ctx, input }) => ({
      balance: await creditsService.getBalance(input.organizationId, ctx.db),
    })),

  /**
   * SOURCE OF TRUTH KEYWORDS: credits.getPacks, LOCKED_NOT_HIDDEN
   *
   * WHAT:  The top-up products, with whether each one can actually be bought.
   * WHY:   `available` is computed rather than the unconfigured packs being
   *        filtered out, for the same reason the render panel shows locked
   *        resolutions: an operator who has configured two of three prices
   *        should SEE that the third is missing, not find it silently absent.
   *        The price id itself never leaves the server — the client needs to
   *        know a pack is purchasable, not which Stripe object backs it.
   * WHERE: The top-up cards on the credits screen.
   */
  getPacks: protectedProcedure({ requirePermission: permissions.CREDITS_READ })
    .input(getBalanceSchema)
    .query(() =>
      (Object.keys(CREDIT_PACKS) as CreditPackKey[]).map((key) => ({
        key,
        label: CREDIT_PACKS[key].label,
        credits: CREDIT_PACKS[key].credits,
        available: isStripeConfigured() && packPriceId(key) !== null,
      })),
    ),

  /**
   * SOURCE OF TRUTH KEYWORDS: credits.listLedger, LEDGER_EXPLAINS_THE_BALANCE
   *
   * WHAT:  A page of every credit movement, newest first.
   * WHY:   LEDGER_EXPLAINS_THE_BALANCE. This is not a nicety — the balance is
   *        a single number that goes down on its own while renders run, and
   *        without a readable history the only answer to "where did my credits
   *        go" is a support ticket. Every row carries its kind, its reference
   *        and its metadata, so a `-12` can be read back as "a 1080p render of
   *        this project".
   * WHERE: The ledger table on the credits screen.
   */
  listLedger: protectedProcedure({
    requirePermission: permissions.CREDITS_READ,
    paginate: true,
  })
    .input(listLedgerSchema)
    .query(async ({ ctx, input }) => {
      const { skip, take, pageSize } = ctx.pagination;
      const page = await creditsService.listLedger(
        ctx.db,
        { organizationId: input.organizationId, kind: input.kind },
        { skip, take },
      );
      /* SERVER_TOTAL_PAGES — against the pageSize the FACTORY clamped to, as
       * in every other paginated list in this codebase. */
      return {
        ...page,
        totalPages: Math.max(1, Math.ceil(page.total / pageSize)),
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: credits.purchase, PAYMENT_BEFORE_CREDITS,
   *   REPLAY_SAFE_TOP_UP
   *
   * WHAT:  Charges the customer's card and adds the pack's credits.
   * WHY:   PAYMENT_BEFORE_CREDITS — see the file header. The intent is created
   *        AND confirmed first; only a `succeeded` status writes a ledger row.
   *
   *        `confirm: true` with `off_session: true` because the card is
   *        already attached and the customer is present in the app — this is a
   *        one-click top-up, not a checkout. A card that needs 3-D Secure
   *        comes back `requires_action` rather than succeeding, and that is
   *        surfaced as a refusal rather than silently retried: handling SCA
   *        properly needs a client-side confirmation step, and pretending a
   *        pending payment succeeded would grant credits for money that may
   *        never arrive. Grep SCA_IS_A_REFUSAL_FOR_NOW.
   *
   *        REPLAY_SAFE_TOP_UP: the ledger write is keyed on the payment intent
   *        id and `purchase` refuses a second row for one that already exists,
   *        so a double-submit cannot double-grant even before the webhook's
   *        own event dedupe is involved.
   * WHERE: The top-up buttons on the credits screen.
   */
  purchase: protectedProcedure({
    requirePermission: permissions.CREDITS_PURCHASE,
    /* A card charge plus a Stripe round trip; the default 10s is tight when
     * Stripe is slow, and a timeout here means money taken with no credits. */
    txTimeout: 20_000,
  })
    .input(purchaseCreditsSchema)
    .mutation(async ({ ctx, input }) => {
      if (!isStripeConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Payments are not configured, so credits cannot be bought.",
        });
      }

      const priceId = packPriceId(input.packKey);
      if (priceId === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `The ${CREDIT_PACKS[input.packKey].label} is not available for purchase.`,
        });
      }

      const stripe = getStripeClient();

      /* The price is read FROM STRIPE rather than taken from input or from a
       * number in this codebase — Stripe is where money lives, and a local
       * copy of an amount would drift from what the customer is actually
       * charged the first time somebody edits the price in the dashboard. */
      const price = await stripe.prices.retrieve(priceId);
      if (price.unit_amount === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "That credit pack is misconfigured and cannot be bought.",
        });
      }

      const customerId = await ensureStripeCustomer(input.organizationId, {
        email: ctx.user.email,
        name: ctx.user.name,
      });

      const intent = await stripe.paymentIntents.create({
        customer: customerId,
        amount: price.unit_amount,
        currency: price.currency,
        payment_method: input.paymentMethodId,
        confirm: true,
        off_session: true,
        /* Read back by the webhook, which is the second line of defence if
         * this request dies between the charge and the ledger write. */
        metadata: {
          organizationId: input.organizationId,
          packKey: input.packKey,
          credits: String(CREDIT_PACKS[input.packKey].credits),
          userId: ctx.user.id,
        },
      });

      /* SCA_IS_A_REFUSAL_FOR_NOW — anything but an outright success is treated
       * as "no money arrived", which is the only safe reading of a pending
       * payment when the next thing we would do is hand over credits. */
      if (intent.status !== "succeeded") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            intent.status === "requires_action"
              ? "This card needs extra verification. Please use a different card."
              : "That payment did not go through. Please try another card.",
        });
      }

      const row = await creditsService.purchase(ctx.db, {
        organizationId: input.organizationId,
        amount: CREDIT_PACKS[input.packKey].credits,
        paymentIntentId: intent.id,
        packKey: input.packKey,
      });

      return {
        /* Null means the webhook got there first — the credits are already on
         * the balance, so this is a success from the customer's point of view
         * and the UI says nothing special about it. */
        granted: row !== null,
        credits: CREDIT_PACKS[input.packKey].credits,
        balance: await creditsService.getBalance(input.organizationId, ctx.db),
      };
    }),
});
