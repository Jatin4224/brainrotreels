# Phase 05 — Credits and entitlements

**Depends on:** Phase 04.

## Goal

Make money work end to end. Paid work is always preceded by a hold, committed at its real cost, and
released automatically on failure. Nobody is ever charged for a video that was not made.

## Why credits are not `UsageMetrics`

`UsageMetrics` counts things: it increments on create, decrements on delete, and that is all it can
express. A render's true cost is unknown until it finishes, a failed render must give the money
back, and a top-up must survive a plan change. A counter has no vocabulary for a hold, a partial
commit or a refund — attempting it means hand-written compensation on every failure path, and the
first failed render would get it wrong.

So the two live side by side. Countable product objects (`projects`, `renders`, `storage`) stay on
the registry and its automatic gates. Variable-cost work (TTS seconds, alignment, render minutes,
generated footage) goes on the ledger.

**The client contract already exists.** `ERROR_CODES.INSUFFICIENT_CREDITS` and its
`StructuredErrorCause` variant `{ resource, required, available, message }` are declared in
`src/lib/errors/index.ts` with zero producers. This phase is their first producer. Do not invent a
new error code.

## Registry

```ts
credits: {
  name: 'Credits',
  description: 'Credit balance and purchase history',
  permissions: ['read', 'purchase'],
  nav: {
    label: 'Credits',
    href: '/dashboard/settings/credits',
    icon: 'CreditCard',
    section: 'settings',
  },
  audit: {
    describe: { purchase: 'Purchased {input.packKey} credits' },
  },
  rateLimit: {
    purchase: { count: 10, window: '1 m' },
  },
}
```

## Data

```prisma
model CreditLedger {
  id             String   @id @default(cuid())
  organizationId String
  delta          Int      // negative for hold/commit, positive for purchase/grant/release
  kind           String   // purchase | grant | hold | commit | release
  refId          String?  // renderId, jobId, stripe payment intent
  holdId         String?  // links commit/release back to its hold
  metadata       Json?
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([organizationId, createdAt])
  @@index([holdId])
  @@index([refId])
  @@map("credit_ledger")
}

model StripeEvent {
  id          String   @id          // the Stripe event id
  type        String
  processedAt DateTime @default(now())

  @@map("stripe_event")
}
```

Add `creditBalance Int @default(0)` to `Organization` as a **cache of the ledger sum**, written in
the same transaction as the ledger row. `StripeEvent` closes the replay gap described below.

## Build

1. **`src/lib/credits/estimate.ts`** — pure maths, no I/O.
   `base(kind) + perSecond(kind) × duration + aiImages × imageCost + premiumVoiceSurcharge`.
   Returns a **breakdown**, never a bare total, so the review screen can itemise it and the admin
   dashboard can compare estimate against actual.
2. **`src/services/credits.service.ts`** — `import 'server-only'`, pure Prisma, taking `db` first.
   `hold`, `commit`, `release`, `grant`, `purchase`, `getBalance`. Every write appends a ledger row
   and updates `Organization.creditBalance` in the same transaction.
3. **Hold semantics.** `hold` writes a negative row of kind `hold` and returns its id. `commit`
   takes that id plus the actual cost: it writes `commit` for the real amount and a compensating
   `release` for the difference. `release` reverses the hold in full. Double-commit is refused by
   checking for an existing `commit` or `release` against the `holdId`.
4. **Wire into the workflows.** Hold before the paid step in `project.generate` and
   `project.render`; commit in `finalize` with the measured cost; release in `onFailure` and on
   cancel. `onFailure` is the safety net — if it is not wired, a crash strands the money.
5. **Refuse early.** `renders.create` checks the balance against the estimate and throws
   `createStructuredError('FORBIDDEN', ..., { errorCode: ERROR_CODES.INSUFFICIENT_CREDITS, ... })`
   before any provider is called. Populate `Render.creditsCharged` and `costBreakdown` in finalize.
6. **Close the Stripe replay gap.** The webhook at `src/app/api/stripe/webhook/route.ts` has no
   event-id dedupe table today; replay safety is incidental, resting on upsert-by-subscription-id,
   and `markUserFingerprintsAsTrialUsed` genuinely re-runs on every replay. Insert the `StripeEvent`
   row first and bail if it already exists. Credits make this urgent: a replayed top-up that grants
   twice is a direct loss.
7. **Top-up products.** Credit packs as Stripe prices, purchased through the existing Elements flow
   in `src/components/global/billing/` — note there is no Checkout route and no Customer Portal in
   this codebase, so follow the custom flow that is already there.
8. **`credits.reconcile`** — nightly Inngest cron comparing `Organization.creditBalance` to the
   ledger sum and reporting drift. Drift means a transaction boundary is wrong somewhere; the job
   reports rather than silently repairs.
9. **Credits page** at `/dashboard/settings/credits`: balance, usage bar, top-up packs, and the
   ledger rendered through the Phase 00 `<DataTable>`.
10. **Cost on the button.** Every credit-spending action shows its cost in the label —
    `Generate (12 credits)` — and switches to `Top up credits` when the balance is short.

## Contracts

```ts
export function estimate(input: EstimateInput): CostBreakdown
export interface CostBreakdown { total: number; lines: { label: string; credits: number }[] }

export async function hold(db: DbClient, organizationId: string, amount: number, refId: string): Promise<string>
export async function commit(db: DbClient, holdId: string, actualCost: number): Promise<void>
export async function release(db: DbClient, holdId: string): Promise<void>
export async function getBalance(organizationId: string): Promise<number>
```

## Done when

- [ ] A forced render failure returns the exact credits held, with no manual action.
- [ ] A render costing less than estimated commits the real cost and releases the remainder.
- [ ] Committing the same hold twice is refused.
- [ ] Replaying a Stripe webhook twice adds credits once, and the trial fingerprint is marked once.
- [ ] Rendering with too few credits is refused before any provider call, and the client renders the
      insufficient-credits state from the existing error cause.
- [ ] `credits.reconcile` reports zero drift after a day of mixed activity.
- [ ] Every credit-spending button shows its cost.

## Not in this phase

Usage-based invoicing, team billing, per-seat credit pools.
