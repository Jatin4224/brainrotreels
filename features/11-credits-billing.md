> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 11 — Credits, entitlements and billing

## Goal
Money works end to end: plans, entitlements, credit estimates, holds, commits, refunds and purchases.

## Depends on
Phases 02, 10.

## Deliverables
- `credit_ledger` table and credit service
- Entitlements service used by both UI and API
- Stripe subscriptions, top-ups and webhooks
- Billing page

## Steps
1. `credit_ledger(id, userId, delta, kind, refId, metadata)`, append-only, `kind` ∈ `purchase | grant | hold | commit | release`.
2. Credit service: `estimate(doc|plan)`, `hold(userId, amount, refId)`, `commit(holdId, actualCost)`, `release(holdId)`. Balance cache updated in the same transaction; nightly reconciliation job.
3. Estimate formula: `base(kind) + perSecond(kind) × duration + aiImages × imageCost + premiumVoiceSurcharge`. Return a breakdown, not just a total.
4. Entitlements service: one function `can(user, feature)` covering background catalog size, premium voices, motion access, API access, resolution, watermark, concurrent jobs, daily generations. UI and API both call it.
5. Wire holds into the Inngest workflows: hold on approval, commit in `finalize`, release in `onFailure` and on cancel.
6. Stripe: three plans, monthly and quarterly prices, credit top-up products, Checkout, Customer Portal, webhook handler that is idempotent by Stripe event ID.
7. Watermark applied at render time when `can(user, 'watermark_free')` is false.
8. Billing page: plan, balance with usage bar, renewal date, plan comparison, top-ups, invoices, ledger table.
9. Every credit-spending button shows the cost on the button.

## Acceptance criteria
- A forced render failure returns the exact credits held, with no manual action.
- Replaying a Stripe webhook twice adds credits once.
- A free user sees locked features with upgrade prompts, and the API refuses them too.
- Nightly reconciliation reports zero drift between cached balance and ledger sum.

## Out of scope
Team billing, usage-based invoicing.
