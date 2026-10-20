/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: CREDIT_LEDGER_KINDS, creditLedgerKindSchema,
 *   CreditLedgerKind, CostBreakdown, CostLine, costBreakdownSchema,
 *   CREDIT_PACKS, CreditPackKey, creditPackKeySchema, purchaseCreditsSchema,
 *   listLedgerSchema, CREDITABLE_KINDS, CreditableKind, SIGN_BY_KIND,
 *   LEDGER_NOT_A_COUNTER
 *
 * WHAT:  The vocabulary of the credit system — what a ledger row can be, what
 *        an estimate looks like, what may be bought, and the input schema of
 *        every `credits.*` procedure.
 *
 * WHY:   LEDGER_NOT_A_COUNTER. These types exist because `UsageMetrics` could
 *        not express this: a counter increments and decrements, and paid work
 *        here needs a hold (money reserved before the cost is known), a commit
 *        (the real cost, learned afterwards) and a release (the difference, or
 *        the whole thing when the work failed). The five kinds below ARE that
 *        vocabulary, and everything else in the phase is built on them.
 *
 *        Why the types live here rather than beside the service: CLAUDE.md
 *        puts every custom type in lib/types, and these specifically have to
 *        be importable by the CLIENT — the cost on a button, the ledger table
 *        and the insufficient-credits state all read them, and none of them
 *        may drag `server-only` Prisma code into a page bundle.
 * WHERE: Consumed by src/lib/credits/, src/services/credits.service.ts,
 *        src/trpc/routers/credits.ts and the credits screen.
 *        Re-exported from src/lib/types.
 */

import { z } from 'zod'

/**
 * SOURCE OF TRUTH KEYWORDS: CREDIT_LEDGER_KINDS, creditLedgerKindSchema,
 *   CreditLedgerKind, SIGN_BY_KIND, HOLD_COMMIT_RELEASE
 *
 * WHAT:  Every reason a credit can move.
 * WHY:   HOLD_COMMIT_RELEASE is the shape that makes "nobody is charged for a
 *        video that was not made" enforceable rather than aspirational:
 *
 *          purchase — the customer paid money for credits.
 *          grant    — we gave them credits (plan allowance, support gesture).
 *          hold     — reserved before paid work starts, so a second job cannot
 *                     spend the same credits while the first is running.
 *          commit   — the real cost, written when the work finished.
 *          release  — a hold reversed, in full on failure or in part when the
 *                     work cost less than estimated.
 *
 *        `purchase` and `grant` are separate although both add credits,
 *        because the difference is the only thing that answers "how much have
 *        we given away this month" — and that is a question somebody asks the
 *        first time the free tier is too generous. Merging them is cheap now
 *        and unrecoverable later: the information is gone.
 * WHERE: CreditLedger.kind.
 */
export const CREDIT_LEDGER_KINDS = ['purchase', 'grant', 'hold', 'commit', 'release'] as const

export const creditLedgerKindSchema = z.enum(CREDIT_LEDGER_KINDS)

export type CreditLedgerKind = z.infer<typeof creditLedgerKindSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: SIGN_BY_KIND, BALANCE_IS_A_SUM
 *
 * WHAT:  Which direction each kind moves the balance.
 * WHY:   BALANCE_IS_A_SUM. `delta` is stored SIGNED so a balance is
 *        `SUM(delta)` with no branching — which is what lets the reconcile
 *        cron compare the cache against the ledger in one query, and what
 *        makes a new kind impossible to add without deciding its direction.
 *        This record is the decision, written once; the service multiplies an
 *        absolute amount by it rather than each call site remembering to pass
 *        a negative number, because the call site that forgets produces a
 *        refund where a charge was meant.
 * WHERE: src/services/credits.service.ts, when it writes a row.
 */
export const SIGN_BY_KIND: Readonly<Record<CreditLedgerKind, 1 | -1>> = {
  purchase: 1,
  grant: 1,
  release: 1,
  hold: -1,
  commit: -1,
}

/**
 * SOURCE OF TRUTH KEYWORDS: CostLine, CostBreakdown, costBreakdownSchema,
 *   BREAKDOWN_NEVER_A_BARE_TOTAL
 *
 * WHAT:  What a piece of paid work is estimated to cost, itemised.
 * WHY:   BREAKDOWN_NEVER_A_BARE_TOTAL, and the phase asks for it in those
 *        words. A bare number is unarguable: a customer who thinks a render
 *        cost too much has nothing to point at, and an operator comparing
 *        estimate against actual has nothing to diff. The lines are what make
 *        the review screen itemisable and the admin dashboard useful.
 *
 *        `total` is carried rather than derived at every call site, so the
 *        number the customer was SHOWN and the number they were CHARGED are
 *        one value that travelled together. Deriving it twice is how a
 *        rounding rule changes in one place only.
 * WHERE: Returned by estimate() in src/lib/credits/estimate.ts; stored in
 *        Render.costBreakdown; rendered by the cost-on-the-button label.
 */
export const costLineSchema = z
  .object({
    label: z.string().min(1),
    credits: z.number().int(),
  })
  .strict()

export type CostLine = z.infer<typeof costLineSchema>

export const costBreakdownSchema = z
  .object({
    total: z.number().int().nonnegative(),
    lines: z.array(costLineSchema),
  })
  .strict()

export type CostBreakdown = z.infer<typeof costBreakdownSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: CREDITABLE_KINDS, creditableKindSchema,
 *   CreditableKind
 *
 * WHAT:  The kinds of work that cost credits.
 * WHY:   A closed union rather than a free string, so a future phase cannot
 *        invent a chargeable action that the estimator has never heard of and
 *        silently charge zero for it. Only `render` is real today; the rest
 *        are declared because the phases that add them (06 script, 07 TTS, 08
 *        alignment, and generated footage) each charge on the same ledger, and
 *        a rate table with a hole in it is easier to see than a missing case.
 * WHERE: estimate()'s input; the `kind` on a hold's metadata.
 */
export const CREDITABLE_KINDS = ['render', 'script', 'tts', 'alignment', 'footage'] as const

export const creditableKindSchema = z.enum(CREDITABLE_KINDS)

export type CreditableKind = z.infer<typeof creditableKindSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: CREDIT_PACKS, CreditPackKey, creditPackKeySchema,
 *   PACK_PRICE_IS_ENV_DRIVEN
 *
 * WHAT:  The top-up products, and the env var holding each one's Stripe price.
 * WHY:   PACK_PRICE_IS_ENV_DRIVEN, exactly as plan prices are (see
 *        `PLANS[].stripe` in src/lib/config/plans.ts): the price is created in
 *        the Stripe dashboard and named by an env var, so the same code ships
 *        to any Stripe account. The CREDIT AMOUNT is in code because it is a
 *        product fact the app has to honour, while the money is in Stripe
 *        because that is where money belongs — and a pack with no price id
 *        configured is simply not purchasable rather than purchasable for
 *        nothing.
 *
 *        `priceEnvKey` is the var NAME rather than a read of it, because this
 *        module is imported by client code and a server-side read here would
 *        either leak or resolve to undefined in the browser. The server reads
 *        it; the client only needs to know which packs exist and how big they
 *        are.
 *
 *        THE AMOUNTS ARE PLACEHOLDERS — see PLACEHOLDER_CREDIT_RATES in
 *        src/lib/credits/estimate.ts. They are shaped so bigger packs are
 *        better value, which is the only property the code depends on; the
 *        actual numbers are a pricing decision.
 * WHERE: `credits.purchase`; the top-up cards on the credits screen.
 */
export const CREDIT_PACKS = {
  small: { credits: 500, label: 'Starter pack', priceEnvKey: 'STRIPE_CREDIT_PACK_SMALL_PRICE' },
  medium: { credits: 2_000, label: 'Creator pack', priceEnvKey: 'STRIPE_CREDIT_PACK_MEDIUM_PRICE' },
  large: { credits: 10_000, label: 'Studio pack', priceEnvKey: 'STRIPE_CREDIT_PACK_LARGE_PRICE' },
} as const satisfies Record<string, { credits: number; label: string; priceEnvKey: string }>

export type CreditPackKey = keyof typeof CREDIT_PACKS

export const CREDIT_PACK_KEYS = Object.keys(CREDIT_PACKS) as readonly CreditPackKey[]

export const creditPackKeySchema = z.enum(
  Object.keys(CREDIT_PACKS) as [CreditPackKey, ...CreditPackKey[]],
)

/**
 * SOURCE OF TRUTH KEYWORDS: purchaseCreditsSchema, listLedgerSchema,
 *   getBalanceSchema, LEDGER_PAGE_SIZE
 *
 * WHAT:  The input contract of every `credits.*` procedure.
 * WHY:   `paymentMethodId` mirrors the existing billing flow exactly (see
 *        `createSubscriptionSchema`): this codebase has no Stripe Checkout
 *        route and no Customer Portal, it has a custom Elements form, so a
 *        top-up is a PaymentIntent against a card the customer already
 *        attached. Inventing a Checkout redirect here would be a second
 *        payment flow for one product.
 *
 *        There is deliberately no `credits` or `amount` field. The amount
 *        comes from the PACK, server-side — a client that could name its own
 *        amount could buy ten thousand credits for the price of five hundred.
 * WHERE: src/trpc/routers/credits.ts.
 */
export const LEDGER_PAGE_SIZE = 20

export const purchaseCreditsSchema = z.object({
  organizationId: z.string().min(1),
  packKey: creditPackKeySchema,
  paymentMethodId: z.string().min(1),
})

export type PurchaseCreditsValues = z.infer<typeof purchaseCreditsSchema>

export const listLedgerSchema = z.object({
  organizationId: z.string().min(1),
  /* `page`/`pageSize` are read by the procedure factory's pagination, not by
   * the handler — declared here because the factory reads them off the RAW
   * input, so a schema that omitted them would strip them before it looked.
   * Same shape as listProjectsSchema and listAssetsSchema. */
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
  kind: creditLedgerKindSchema.optional(),
})

export type ListLedgerValues = z.infer<typeof listLedgerSchema>

export const getBalanceSchema = z.object({
  organizationId: z.string().min(1),
})
