<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 05 — credits and entitlements

`docs/14-phase4.md` describes the render that costs money. This page describes the money: a ledger
that reserves credits before paid work starts, charges what the work actually cost, and gives the
difference back without anybody touching it.

Read this before any phase that spends on the customer's behalf — 06 (script), 07 (TTS), 08
(alignment) and generated footage all charge on this ledger. Read **A ledger, not a counter** first;
it is the decision everything else follows from.

> ## ⚠ The rates are placeholders
>
> `CREDIT_RATES` in `src/lib/credits/estimate.ts` is internally consistent and shaped like a real
> tariff, but **no number in it has been priced.** Nothing has been compared against what a Lambda
> render, a TTS second or a generated image actually costs, or against what the plans sell for. The
> same is true of the three sizes in `CREDIT_PACKS`.
>
> This was built to be one edit: the rates are a single constant and the maths is a pure function,
> so there is no arithmetic scattered through routers or components to hunt down. **Do not charge
> anybody until that edit happens.**

## The one-sentence version

Every credit movement is an append-only `CreditLedger` row; `Organization.creditBalance` is a cache
of their sum written in the same transaction; and paid work is always **hold → commit + partial
release**, or **hold → release** when it failed.

## Where the code lives

| Path | Contains | Server-only? |
| --- | --- | --- |
| `src/lib/types/credits.ts` | kinds, packs, breakdown, input schemas | no — the client reads it |
| `src/lib/credits/estimate.ts` | the tariff and the maths | **no — pure** |
| `src/services/credits.service.ts` | every write that moves credits | yes |
| `src/trpc/routers/credits.ts` | balance, packs, ledger, purchase | yes |
| `src/inngest/functions/credits-reconcile.ts` | the nightly audit | yes |

The estimator is pure for one concrete reason: **the cost on a button and the amount held on the
server must come from the same function.** A second implementation anywhere shows a customer one
price and charges another. Anything needing the database lives in the service, which imports it.

## Rule 1 — a ledger, not a counter

`UsageMetrics` increments on create and decrements on delete, and that is all it can express. Paid
work here has three properties a counter has no vocabulary for:

- a render's **true cost is unknown until it finishes**,
- a **failed render must give the money back**,
- a **top-up must survive a plan change**.

Expressing that on a counter means hand-written compensation on every failure path, and the first
failed render gets it wrong.

So the two systems sit side by side **on purpose**:

| | Lives on | Gated by |
| --- | --- | --- |
| countable objects — `projects`, `renders`, `storage` | the registry's `limit` | the procedure factory, automatically |
| variable-cost work — render minutes, TTS seconds, footage | `CreditLedger` | a hand-thrown `INSUFFICIENT_CREDITS` |

This is why **`credits` declares neither `limit` nor `flag`** in `src/lib/resources.ts`. That looks
like an omission and is the opposite: declaring a limit would make the factory gate and bump a
second, parallel number that disagrees with the ledger within one failed render. Grep
`CREDITS_HAVE_NO_LIMIT`.

`purchase` is also its own permission rather than `create` — partly because the factory auto-gates
on the path verb `create`, and partly because spending real money is genuinely a different
authority from making things. A workspace can reasonably let a member render while reserving
top-ups to whoever owns the card.

### The error contract already existed

`ERROR_CODES.INSUFFICIENT_CREDITS` and its `{ resource, required, available, message }` cause have
been declared in `src/lib/errors/index.ts` since Phase 00 **with zero producers**. This phase is
their first. Do not invent a new code — the client narrows on this one to render the top-up prompt.

## Rule 2 — hold, commit, release

```
hold     −12   before the work starts          money reserved
commit    −9   when it finished, real cost     charged what it cost
release   +3   the difference                  given back
```

or, when it failed:

```
hold     −12
release  +12   the whole thing
```

The **hold** is what stops a second render spending credits the first has already reserved —
without it, five concurrent renders each check a balance that covers one of them and all five
proceed. The **release** is what makes "nobody is charged for a video that was not made" true
without a human touching anything.

`commit` takes an **actual cost** rather than just confirming the hold. Simply confirming would
charge the estimate forever, which makes every estimate a maximum and every efficiency improvement
invisible to the customer. An actual cost **above** the hold is committed in full — capping it
would mean the business silently eats every underestimate, and the overspend is exactly the signal
that the estimator needs fixing. Grep `PARTIAL_RELEASE`.

### A hold is settled exactly once

Both `commit` and `release` check for an existing settlement against the `holdId` and refuse a
second. This is not defensive styling — **every caller is a path that genuinely fires twice**: a
retried workflow step, a webhook delivered twice, a timeout racing a late success. A hold settled
twice either charges two renders for one video or refunds a render the customer received.

They return `false` rather than throwing, because a second call is **normal** and must be a no-op,
not an error that fails an otherwise healthy run. The check covers both kinds, not just `commit` —
a hold that was released must not then be committed, which is the ordering a timeout racing a late
webhook produces. Grep `DOUBLE_COMMIT_REFUSED`.

### Callers pass positive amounts

`delta` is stored **signed** (`SIGN_BY_KIND`), so a balance is `SUM(delta)` with no branching —
which is what lets the reconcile query be one line. The service applies the sign itself, so a call
site cannot accidentally refund where it meant to charge. Grep `BALANCE_IS_A_SUM`.

## Rule 3 — the balance is a cache, and it is audited

`Organization.creditBalance` is a cache of the ledger sum, **never an independent number**. Every
write appends a row and updates the cache in the *same transaction*; nothing outside
`credits.service.ts` touches it. Grep `LEDGER_AND_CACHE_IN_ONE_TRANSACTION` and you have found
every writer.

It exists because the alternative is summing an append-only, unbounded table on the request path:
a workspace that has been rendering for a year would pay for thousands of rows every time it asked
"can I afford this".

**Holds are already deducted**, because a hold *is* a negative row. So the balance is spendable
balance, not gross, and no caller has to remember to subtract anything in flight.

### reconcile reports, it does not repair

The cache can only diverge from the ledger if a **transaction boundary is wrong in code**. Healing
the number would remove the only evidence the bug exists while it carried on producing it — a
repaired balance with an unexplained cause is worse than a wrong one somebody is looking at. Grep
`REPORT_DONT_REPAIR`.

It hunts a **second** failure separately, which balance reconciliation alone would never see:

> **A stranded hold leaves the ledger and the cache in perfect agreement.** Both say the money is
> gone. The customer is quietly short, no render ever used it, and nothing is inconsistent.

It is reachable whenever a workflow dies between holding and settling in a way `onFailure` cannot
catch. Age is the signal — only holds older than three hours are reported, comfortably past the
45-minute render timeout, so a render legitimately in flight is never flagged. Grep
`STRANDED_HOLD`.

Both halves are **SQL aggregates**, not rows read into the process. A job that loads an unbounded
ledger to add it up fails on the night it is most needed.

It runs daily, unlike `usage.reset`'s hourly: that job is idempotent tidy-up whose lateness costs a
customer their quota, this one produces a report a human must act on.

## Rule 4 — refuse in the request, hold in the workflow

**The brief implies both happen together. They must not.**

A hold placed in `renders.create` would sit inside that request's **10-second Prisma transaction**,
and a request that timed out *after* holding would strand the money with no workflow in existence
to release it. Separating them means the hold and everything that can release it live in the same
durable run.

| Where | What | Why there |
| --- | --- | --- |
| `renders.create` | refuse on the estimate | the customer is watching; a refusal must leave no row |
| `project.render` → `hold-credits` | reserve the money | same run as every path that can refund it |

The cost of the gap is that a balance can move in between — which a concurrent render does
routinely. So the hold path treats `InsufficientCreditsError` as **permanent**: the balance will
not grow by itself, and retrying three times produces the same refusal three times. Grep
`HOLD_IN_THE_WORKFLOW`.

The refusal sits **after** the reuse check and **before** the row is created. After reuse, because
a render that costs nothing must not be refused for lack of credits — the customer already paid for
that file. Before the row, because a queued `Render` that was never affordable shows in the panel
as a render about to start that never will.

## Rule 5 — no failure path forgets the refund

There are **fourteen** places in `project-render.ts` that can end a render badly: a missing secret,
a broken document, a stale cache key, a provider refusal, a timeout, an unreadable webhook, the
failure handler. Every one has to refund, and *"remember to call release too"* is a rule that holds
until somebody adds the fourteenth.

So **the only bare `failRender` call left in that file is the one inside the helper.** All fourteen
callers go through `failRenderAndRelease`, and refunding is not something a caller can omit — which
is checkable in one command:

```bash
grep -c 'await failRender(' src/inngest/functions/project-render.ts   # must be 1
```

Grep `NO_PATH_FORGETS_THE_REFUND`.

It finds the hold by **render id**, not by a `holdId` argument, because most of those paths cannot
have been handed one — `onFailure` receives only the original event, and a replayed step gets fresh
locals. One lookup rule reachable from everywhere beats a value half the paths do not have.

That same lookup is what makes the hold step **idempotent**. Inngest retries steps, and a retry
that placed a second hold would leave the first unsettled forever, with the ledger and the cache
still agreeing — so reconcile would report nothing. Grep `ORPHANED_HOLD`.

The refund is **best-effort around the status write**: if releasing throws, the render is still
marked failed and the error is logged. Letting it propagate would leave a render stuck on
`rendering` forever because its *refund* did not work — two problems instead of one. The reconcile
cron catches the stranded hold.

## Rule 6 — the charge and the video commit together

`finalize` writes the asset rows, the `completed` status, the ledger commit and
`Render.creditsCharged`/`costBreakdown` in **one transaction**. The moment those are two
transactions, both of these are reachable:

- a **committed charge with no video** — a customer paying for nothing, which is the exact thing
  this phase exists to prevent, and
- a video with no charge.

The cost is **re-estimated from the real output** rather than reusing the held amount. Today they
are equal because a render's duration is known before it starts; they stop being equal the moment
anything makes the real length differ from the planned one, and `commit` already handles that.
Charging the hold instead would make every estimate a flat price and hide the divergence
permanently. Grep `CHARGE_WHAT_IT_COST`.

## Rule 7 — the Stripe replay gap is closed

Stripe delivers **at least once** and replays on its own schedule, so every handler in
`src/app/api/stripe/webhook/route.ts` runs more than once in normal operation. Until this phase
that was survivable **by luck**: upserting by subscription id happens to be idempotent, and
`markUserFingerprintsAsTrialUsed` — which genuinely re-runs — was harmless only because re-marking
a used trial as used changes nothing.

Credits remove the luck. A replayed top-up that grants twice is a direct, unrecoverable loss.

**The INSERT is the check.** `StripeEvent`'s primary key is the event id, so the database refuses
the second write — rather than a read-then-write, where two concurrent deliveries both read "not
seen" and both proceed. `P2002` is the *success* case: somebody else already has it.

It is recorded **before** the handlers run, which takes a deliberate trade:

> An event that fails mid-handler is never retried, because it is already marked seen. We take that
> on purpose — **money that was not granted is recoverable by hand; money granted twice is not.**
> The 500 tells Stripe to retry, the retry is refused as a duplicate, and the event is in the logs
> for a human.

Grep `STRIPE_EVENT_DEDUPE`.

### A top-up is granted twice over, on purpose

`credits.purchase` writes the ledger row in the same request that charges the card. **And**
`payment_intent.succeeded` grants it again if that request died in between — a deploy, a timeout, a
dropped connection, leaving the customer paid-up with nothing.

Both are safe because `purchase` is keyed on the payment intent id and refuses a second row for one
it has seen. The two close **different** holes:

| Lock | Stops |
| --- | --- |
| `StripeEvent` | one *delivery* being processed twice |
| `refId` on the ledger | two *different* events being read as one top-up |

A replayed grant is unrecoverable, so it is worth two locks. Grep `REPLAY_SAFE_TOP_UP`.

### Payment before credits, always

The PaymentIntent is created **and confirmed** before a single credit is written. A failed card
produces no ledger row at all, rather than a grant that has to be clawed back — and clawing back
credits already spent on a render is not possible, which is why the ordering is not negotiable.

**SCA is a refusal, not a retry.** A card returning `requires_action` is reported as a failed
top-up rather than carried through a client-side confirmation step. Handling 3-D Secure properly
needs that step; pretending a pending payment succeeded would grant credits for money that may
never arrive. Worth revisiting once a real card population exists. Grep
`SCA_IS_A_REFUSAL_FOR_NOW`.

The flow follows the **existing** billing surface — this codebase has no Checkout route and no
Customer Portal, it has a custom Elements form — so a top-up is a PaymentIntent against an
already-attached card, exactly as `billing.createSubscription` works.

## The estimator

```ts
estimate({ kind, durationSeconds, resolution, aiImages, premiumVoice }) → CostBreakdown
```

It returns a **breakdown, never a bare total**. A customer who thinks a render cost too much needs
something to point at, and "12 credits" is unarguable in the bad sense. An operator comparing
estimate against actual needs something to diff.

Three properties the code depends on:

- **Rounds up, once, at the end.** Credits are integers — a fractional credit cannot be held — and
  rounding down means every short render is charged less than it costs, a slow leak nobody
  attributes. Rounding once rather than per line keeps the lines honest: three lines of 0.4 cost 2,
  not 3.
- **The lines always add up to the total.** A bill that does not reconcile makes a customer
  distrust every number on it, including the correct ones. The rounding remainder goes on the
  largest line, where a credit is the smallest proportion of what is shown. Grep
  `LINES_MUST_ADD_UP`.
- **Bad input cannot produce a bad charge.** A negative duration would produce a negative line and
  therefore a job that *pays* the customer; a NaN (a zero frame rate divided through) would be
  held, committed and displayed without anything throwing. Both collapse to the base charge.

`estimateRenderCost` exists so the three places that price a render — the refusal, the hold and the
commit — cannot disagree. Grep `ONE_CALLER_ONE_SHAPE`.

## The UI

| Surface | Shows |
| --- | --- |
| `/dashboard/settings/credits` | balance, top-up packs, the full ledger via the Phase 00 `<DataTable>` |
| the render panel | `Render video (12 credits)`, switching to `Top up credits` when short |

**The ledger is not an afterthought.** A credit balance goes *down on its own* while renders run,
which no other number in this app does — so without a readable history the only answer to "where
did my credits go" is a support ticket. Every row names its kind and, through its metadata, what it
was for. Grep `LEDGER_EXPLAINS_THE_BALANCE`.

The cost on the button comes from **`renders.estimate`**, a server query, through the same
estimator the refusal and the hold use. A cost computed in the browser would be a second
implementation of pricing, and the first rate change would have the button promising one price
while the handler charged another. It returns the balance alongside the cost so the two numbers
being compared were read at the same instant.

When the balance is short the button **navigates to the credits screen** rather than firing a
request the server will refuse. A disabled `Render (12 credits)` tells a customer they cannot
proceed but not what to do about it.

Two display decisions worth keeping:

- **`hold` renders as "Reserved", not as a charge.** Otherwise every customer with a render in
  flight thinks they have been billed twice.
- **Signed numbers are kept** (`+500`, `−12`) rather than rendered as "added/removed", because a
  ledger showing signed numbers can be checked by adding it up — which is exactly what somebody
  querying their balance wants to do.

## Status

Phase 05's box in `docs/phases/PROGRESS.md` is **unticked**, and there are two independent reasons.

**The Neon database went unreachable partway through the phase** — TCP connects on 5432 but
Postgres does not answer. It was healthy when the migration applied, so it is on Neon's side (a
suspended project or exhausted free-tier compute), not in this branch.

**Phase 04's AWS gap is still open**, so no render has ever completed — meaning no hold has ever
been committed by a real render.

What **is** verified: the estimator's 13 tests, written against *properties* rather than the
placeholder numbers — whole totals, never negative, longer costs more, 1080p costs more than 720p,
lines always add up, the resolution multiplier applies only to renders, and NaN/negative/Infinite
durations collapse to the base charge. `next build` is clean with the credits route present, the
suite is 423 green, and the migration is applied and drift-free.

What is **not**: every one of the seven "done when" checks. A forced failure returning the exact
credits held; a cheaper-than-estimated render committing the real cost; double-commit refused; a
replayed Stripe webhook granting once; reconcile reporting zero drift; and the insufficient-credits
refusal firing in a real request.

**No database-backed test file was committed**, deliberately. All 24 existing test files are pure
units and nothing in the suite touches Prisma; adding one would start a new pattern (CLAUDE.md rule
1) and make `npm test` depend on a live database. The ledger semantics were to be proven by a
throwaway probe the way Phase 04's webhook was — that probe is what the outage blocked.

## What Phase 05 did not finish

- **Real prices.** See the warning at the top.
- **A plan's monthly credit allowance.** `grant` exists and is the right mechanism, but nothing
  calls it on a subscription renewal — so today credits only arrive by purchase. The brief does not
  ask for it and the registry has no field for it; it belongs with the pricing decision.
- **Usage-based invoicing, team billing, per-seat credit pools.** Explicitly out of scope.
- **Only `render` is a real creditable kind.** `script`, `tts`, `alignment` and `footage` are
  declared in `CREDITABLE_KINDS` with rates, because the phases that add them charge on this same
  ledger — a rate table with a hole in it is easier to see than a missing case.

## Where to go next

`docs/phases/06-script-generation.md`. What it inherits:

- **`hold` / `commit` / `release` already work for any kind.** Pass `kind: 'script'` and a
  duration; nothing in the service is render-specific.
- **`onFailure` is the safety net, and it must be wired.** If a generation workflow does not
  release on failure, a crash strands the customer's credits — and the ledger and cache will still
  agree, so reconcile will report nothing.
- **Cost goes on the button.** Every credit-spending action shows its price, from a server query
  through `estimate()`, never computed client-side.
