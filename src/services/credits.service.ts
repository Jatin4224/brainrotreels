/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: hold, commit, release, grant, purchase,
 *   getBalance, listLedger, sumLedger, appendLedgerRow,
 *   LEDGER_AND_CACHE_IN_ONE_TRANSACTION, HOLD_COMMIT_RELEASE,
 *   DOUBLE_COMMIT_REFUSED, BALANCE_IS_A_SUM, DbClient
 *
 * WHAT:  Every write that moves credits, and the reads that report them.
 *
 * WHY:   LEDGER_AND_CACHE_IN_ONE_TRANSACTION is the invariant this entire file
 *        exists to hold. `Organization.creditBalance` is a CACHE of
 *        `SUM(CreditLedger.delta)`, never an independent number, so every
 *        write appends a ledger row and updates the cache in the SAME
 *        transaction. Nothing outside this file may touch `creditBalance` —
 *        grep it and you have found every writer.
 *
 *        The nightly `credits.reconcile` cron compares the two. It REPORTS
 *        drift rather than repairing it, and that is deliberate: drift means a
 *        transaction boundary is wrong somewhere, and silently healing the
 *        symptom would hide the bug while it kept happening. A repaired
 *        balance with an unexplained cause is worse than a wrong one somebody
 *        is looking at.
 *
 *        HOLD_COMMIT_RELEASE. Paid work is always: `hold` the estimate before
 *        anything starts → `commit` the real cost when it finished, with a
 *        compensating `release` for the difference → or `release` the whole
 *        hold if it failed. The hold is what stops a second render spending
 *        credits the first has already reserved, and the release is what makes
 *        "nobody is charged for a video that was not made" true without a
 *        human touching anything.
 *
 *        DOUBLE_COMMIT_REFUSED. A hold may be settled exactly once. Both
 *        `commit` and `release` check for an existing settlement against the
 *        `holdId` and refuse a second — because the paths that call them (a
 *        workflow step that retries, a webhook delivered twice, a timeout
 *        racing a late success) genuinely do fire twice, and a hold settled
 *        twice either charges a customer two renders for one video or refunds
 *        a render they received.
 *
 *        BALANCE_IS_A_SUM: `delta` is stored signed (SIGN_BY_KIND), so the
 *        truth is one `SUM` with no branching and the reconcile query is one
 *        line. Callers pass POSITIVE amounts and the sign is applied here, so
 *        a call site cannot accidentally refund where it meant to charge.
 *
 *        Business rules — whether a workspace may spend, what a thing costs,
 *        whether a retry is allowed — live in the router and the workflows.
 *        This file moves credits and refuses impossible movements.
 * WHERE: src/trpc/routers/credits.ts, src/trpc/routers/renders.ts,
 *        src/inngest/functions/project-render.ts and credits-reconcile.ts.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma";
import { prisma, type DbClient } from "@/lib/config/prisma";
import { settlementRows } from "@/lib/credits/settlement";
import {
  SIGN_BY_KIND,
  type CreditLedgerKind,
  type CreditPackKey,
} from "@/lib/types/credits";

/**
 * SOURCE OF TRUTH KEYWORDS: CreditLedgerRow, LEDGER_LIST_SELECT
 *
 * WHAT:  The columns the credits screen renders.
 * WHY:   `metadata` IS included, unlike most list selects in this codebase —
 *        it is small (a kind, a cost breakdown, a pack name) and it is the
 *        only thing that turns "-12" into "Render, 1080p, 95 seconds". A
 *        ledger whose rows cannot be explained is a ledger that generates
 *        support tickets rather than answering them.
 * WHERE: listLedger below; the ledger table on the credits screen.
 */
export const LEDGER_LIST_SELECT = {
  id: true,
  delta: true,
  kind: true,
  refId: true,
  holdId: true,
  metadata: true,
  createdAt: true,
} as const satisfies Prisma.CreditLedgerSelect;

export type CreditLedgerRow = Prisma.CreditLedgerGetPayload<{
  select: typeof LEDGER_LIST_SELECT;
}>;

/**
 * SOURCE OF TRUTH KEYWORDS: InsufficientCreditsError, REFUSAL_IS_NOT_A_CRASH
 *
 * WHAT:  A spend that the balance cannot cover, carrying both numbers.
 * WHY:   REFUSAL_IS_NOT_A_CRASH. A workspace that cannot afford a render is an
 *        ordinary, expected outcome — not an exception in the "something broke"
 *        sense — and the caller has to turn it into a specific client contract
 *        (`ERROR_CODES.INSUFFICIENT_CREDITS` with `required` and `available`,
 *        which the UI renders as a top-up prompt). A bare Error would force
 *        every caller to parse a message to rebuild those two numbers.
 *
 *        It is thrown rather than returned because it must be impossible to
 *        ignore: the one thing worse than refusing a render is proceeding with
 *        a hold that silently took the balance negative.
 * WHERE: Thrown by `hold`; caught in src/trpc/routers/renders.ts and the
 *        render workflow.
 */
export class InsufficientCreditsError extends Error {
  readonly required: number;
  readonly available: number;

  constructor(required: number, available: number) {
    super(`This workspace has ${available} credits and needs ${required}.`);
    this.name = "InsufficientCreditsError";
    this.required = required;
    this.available = available;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: appendLedgerRow, LEDGER_AND_CACHE_IN_ONE_TRANSACTION
 *
 * WHAT:  The ONE function that writes a credit movement.
 * WHY:   Every public function below goes through this, so the invariant —
 *        a ledger row and the cache update, together, always — is implemented
 *        once rather than five times. Five copies is five chances for one of
 *        them to update the cache and forget the row, which is precisely the
 *        drift the reconcile cron would then report with no way to attribute.
 *
 *        It takes a POSITIVE `amount` and applies SIGN_BY_KIND itself. A
 *        caller passing a negative number for a hold would double-negate and
 *        REFUND, which is the kind of bug that only shows up in the money.
 *
 *        It does NOT open its own transaction. The caller supplies `db`, which
 *        is either the request's transaction (so the movement commits with the
 *        row that caused it) or a transaction the caller opened. Opening one
 *        here would make a hold commit independently of the render it was for.
 * WHERE: Every write in this file.
 */
async function appendLedgerRow(
  db: DbClient,
  args: {
    organizationId: string;
    kind: CreditLedgerKind;
    /** Always POSITIVE. The sign comes from the kind. */
    amount: number;
    refId?: string | null;
    holdId?: string | null;
    metadata?: Prisma.InputJsonValue | undefined;
  },
): Promise<CreditLedgerRow> {
  const magnitude = Math.round(Math.abs(args.amount));
  const delta = magnitude * SIGN_BY_KIND[args.kind];

  const row = await db.creditLedger.create({
    data: {
      organizationId: args.organizationId,
      kind: args.kind,
      delta,
      ...(args.refId != null ? { refId: args.refId } : {}),
      ...(args.holdId != null ? { holdId: args.holdId } : {}),
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    },
    select: LEDGER_LIST_SELECT,
  });

  /* The cache, in the same transaction. `increment` rather than a read-then-
   * write, so two concurrent movements cannot both read the old value and
   * clobber each other — the database does the arithmetic under its own row
   * lock. This is also why the cache can be trusted between reconcile runs. */
  await db.organization.update({
    where: { id: args.organizationId },
    data: { creditBalance: { increment: delta } },
  });

  return row;
}

/**
 * SOURCE OF TRUTH KEYWORDS: getBalance, BALANCE_FROM_THE_CACHE
 *
 * WHAT:  What this workspace can spend right now.
 * WHY:   BALANCE_FROM_THE_CACHE — reads `Organization.creditBalance`, not a
 *        SUM over the ledger. The ledger is append-only and unbounded, so
 *        summing it on the request path means a workspace that has been
 *        rendering for a year pays for thousands of rows every time it asks
 *        "can I afford this". The cache is maintained in the same transaction
 *        as every row (LEDGER_AND_CACHE_IN_ONE_TRANSACTION) and audited nightly
 *        by the reconcile cron, which is what makes trusting it reasonable.
 *
 *        Holds are already subtracted, because a hold IS a negative row. So
 *        this is spendable balance, not gross balance, and no caller has to
 *        remember to deduct anything.
 * WHERE: `credits.getBalance`, the refusal in `renders.create`, the credits
 *        screen.
 */
export async function getBalance(
  organizationId: string,
  db: DbClient = prisma,
): Promise<number> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { creditBalance: true },
  });
  return org?.creditBalance ?? 0;
}

/**
 * SOURCE OF TRUTH KEYWORDS: sumLedger, RECONCILE_SOURCE_OF_TRUTH
 *
 * WHAT:  The real balance, computed from the ledger.
 * WHY:   The number `getBalance` is supposed to equal. Separated so the
 *        reconcile cron can compare the two, and so nothing on the request
 *        path can reach for it by accident — an aggregate over an unbounded
 *        append-only table is exactly what the cache exists to avoid.
 * WHERE: src/inngest/functions/credits-reconcile.ts only.
 */
export async function sumLedger(
  organizationId: string,
  db: DbClient = prisma,
): Promise<number> {
  const result = await db.creditLedger.aggregate({
    where: { organizationId },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}

/**
 * SOURCE OF TRUTH KEYWORDS: hold, HOLD_BEFORE_PAYING, InsufficientCreditsError
 *
 * WHAT:  Reserves credits before paid work starts. Returns the hold's id.
 *
 * WHY:   HOLD_BEFORE_PAYING. The hold is written BEFORE the provider is
 *        called, which is what makes the balance mean "what you can still
 *        spend" rather than "what you had before the three renders currently
 *        running". Without it, five concurrent renders each check a balance
 *        that covers one of them and all five proceed.
 *
 *        The id returned is the LEDGER ROW's id, and it is what `commit` and
 *        `release` are keyed on — so a hold is a real, auditable record from
 *        the moment it exists, not a token in memory that is lost if the
 *        process dies between reserving and spending.
 *
 *        The balance check and the row write are in the same transaction as
 *        whatever the caller is doing, so a refusal and a reservation cannot
 *        interleave. Note this is NOT protection against two transactions
 *        racing to spend the last credit — Postgres' default isolation allows
 *        both to read the same balance. That is accepted deliberately: the
 *        downside is a workspace going a few credits negative under exactly
 *        concurrent spends, which the next top-up absorbs and the reconcile
 *        cron will not even flag (the cache and the ledger still agree). The
 *        alternative, serialising every spend in a workspace, would make the
 *        render queue a single file for a case that costs pennies.
 * WHERE: `renders.create`; Phase 06/07's generate pipeline.
 */
export async function hold(
  db: DbClient,
  organizationId: string,
  amount: number,
  refId: string,
  metadata?: Prisma.InputJsonValue,
): Promise<string> {
  const required = Math.max(0, Math.round(amount));

  /* A zero-cost job still gets a hold row, so the hold/commit/release chain is
   * unbroken and `commit` has something to settle. A missing row would make
   * the commit path branch on "was there a hold", which is a branch that gets
   * it wrong the first time a rate is set to zero. */
  if (required > 0) {
    const available = await getBalance(organizationId, db);
    if (available < required) {
      throw new InsufficientCreditsError(required, available);
    }
  }

  const row = await appendLedgerRow(db, {
    organizationId,
    kind: "hold",
    amount: required,
    refId,
    ...(metadata !== undefined ? { metadata } : {}),
  });

  return row.id;
}

/**
 * SOURCE OF TRUTH KEYWORDS: commit, DOUBLE_COMMIT_REFUSED, PARTIAL_RELEASE
 *
 * WHAT:  Settles a hold at the work's real cost, giving back the difference.
 *
 * WHY:   PARTIAL_RELEASE is the whole reason `commit` takes an actual cost
 *        rather than just confirming the hold. A render estimated at 12 and
 *        delivered at 9 writes a `commit` of 9 and a `release` of 3 — the
 *        customer is charged what it cost, and the ledger says plainly why the
 *        other 3 came back. Simply "confirming" the hold would charge the
 *        estimate forever, which makes every estimate a maximum and every
 *        improvement in efficiency invisible to the customer.
 *
 *        An actual cost ABOVE the hold is committed in full. The alternative —
 *        capping at the held amount — would mean the business eats any
 *        underestimate silently, and the overspend is exactly the signal that
 *        the estimator needs fixing. It can take a balance negative; that is
 *        the honest record, and `hold` refuses the next job until it is
 *        topped up.
 *
 *        DOUBLE_COMMIT_REFUSED: returns `false` rather than throwing when the
 *        hold is already settled. Every caller of this is a path that
 *        genuinely fires twice — a retried workflow step, a webhook delivered
 *        twice, a timeout racing a late success — so a second call is NORMAL
 *        and must be a no-op, not an error that fails an otherwise healthy
 *        run. The boolean is there for the caller that wants to log it.
 * WHERE: The `finalize` step of src/inngest/functions/project-render.ts.
 */
export async function commit(
  db: DbClient,
  holdId: string,
  actualCost: number,
  metadata?: Prisma.InputJsonValue,
): Promise<boolean> {
  const holdRow = await db.creditLedger.findUnique({
    where: { id: holdId },
    select: {
      id: true,
      organizationId: true,
      delta: true,
      kind: true,
      refId: true,
    },
  });
  if (holdRow === null || holdRow.kind !== "hold") return false;

  if (await isSettled(db, holdId)) return false;

  /* The hold's delta is negative; its magnitude is what was reserved. */
  const held = Math.abs(holdRow.delta);
  const actual = Math.max(0, Math.round(actualCost));

  /**
   * SOURCE OF TRUTH KEYWORDS: RELEASE_REVERSES_THE_WHOLE_HOLD, settlementRows,
   *   NET_IS_THE_ACTUAL_COST
   *
   * The arithmetic is in `src/lib/credits/settlement.ts`, pure and unit
   * tested, because getting it wrong here moves real money and it ALREADY WAS
   * wrong once: the phase brief describes the compensating release as being
   * "for the difference", which double-charges every job — the hold has
   * already deducted the estimate, so `−12 − 9 + 3 = −18` for work that cost
   * 9. A probe against a real database caught it; review did not.
   *
   * The release therefore reverses the hold IN FULL, and the net across hold
   * plus settlement is exactly the actual cost in every case — including when
   * the work cost MORE than was held, which is charged in full rather than
   * silently absorbed.
   */
  for (const row of settlementRows(held, actual)) {
    await appendLedgerRow(db, {
      organizationId: holdRow.organizationId,
      kind: row.kind,
      amount: row.amount,
      refId: holdRow.refId,
      holdId,
      /* Only the commit carries the caller's metadata — it is the row that
       * describes the work; the release is bookkeeping. */
      ...(row.kind === "commit" && metadata !== undefined ? { metadata } : {}),
    });
  }

  return true;
}

/**
 * SOURCE OF TRUTH KEYWORDS: release, RELEASE_IS_THE_SAFETY_NET
 *
 * WHAT:  Reverses a hold in full. The money comes back.
 *
 * WHY:   RELEASE_IS_THE_SAFETY_NET, and it is the function that makes the
 *        phase's promise true: "nobody is ever charged for a video that was
 *        not made". It is called from the render workflow's failure paths AND
 *        from its `onFailure` handler — the latter being the net under a run
 *        that died without reaching any of its own error branches. If
 *        `onFailure` is not wired, a crash strands the customer's money with
 *        no record of why, and nothing will ever give it back.
 *
 *        Idempotent for the same reason `commit` is: the failure paths and the
 *        failure handler can both fire for one run, and a hold released twice
 *        would pay the customer for a render they never had.
 * WHERE: src/inngest/functions/project-render.ts — the failure branches and
 *        the onFailure handler.
 */
export async function release(
  db: DbClient,
  holdId: string,
  metadata?: Prisma.InputJsonValue,
): Promise<boolean> {
  const holdRow = await db.creditLedger.findUnique({
    where: { id: holdId },
    select: {
      id: true,
      organizationId: true,
      delta: true,
      kind: true,
      refId: true,
    },
  });
  if (holdRow === null || holdRow.kind !== "hold") return false;

  if (await isSettled(db, holdId)) return false;

  const held = Math.abs(holdRow.delta);
  if (held === 0) return true;

  await appendLedgerRow(db, {
    organizationId: holdRow.organizationId,
    kind: "release",
    amount: held,
    refId: holdRow.refId,
    holdId,
    ...(metadata !== undefined ? { metadata } : {}),
  });

  return true;
}

/**
 * SOURCE OF TRUTH KEYWORDS: isSettled, DOUBLE_COMMIT_REFUSED
 *
 * WHAT:  True when a hold already has a commit or a release against it.
 * WHY:   One query covering BOTH kinds, because the rule is "settled once",
 *        not "committed once" — a hold that was released must not then be
 *        committed, which is the ordering a timeout racing a late webhook
 *        produces. Checking only for a commit would allow exactly that.
 * WHERE: commit and release, before they write anything.
 */
async function isSettled(db: DbClient, holdId: string): Promise<boolean> {
  const existing = await db.creditLedger.findFirst({
    where: { holdId, kind: { in: ["commit", "release"] } },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: grant, GRANT_IS_NOT_A_PURCHASE
 *
 * WHAT:  Adds credits nobody paid us for.
 * WHY:   GRANT_IS_NOT_A_PURCHASE — a separate kind from `purchase` although
 *        both add credits, because the difference is the only thing that can
 *        answer "how much have we given away this month". That question gets
 *        asked the first time the free allowance turns out to be too generous,
 *        and if the two were merged the information would be gone rather than
 *        merely unreported.
 * WHERE: A plan's monthly allowance, and support gestures from the portal.
 */
export async function grant(
  db: DbClient,
  organizationId: string,
  amount: number,
  reason: string,
  refId?: string,
): Promise<CreditLedgerRow> {
  return appendLedgerRow(db, {
    organizationId,
    kind: "grant",
    amount,
    ...(refId !== undefined ? { refId } : {}),
    metadata: { reason },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: purchase, PURCHASE_IS_KEYED_ON_THE_PAYMENT,
 *   REPLAY_SAFE_TOP_UP
 *
 * WHAT:  Adds the credits a customer paid for.
 *
 * WHY:   REPLAY_SAFE_TOP_UP. `refId` is the Stripe payment intent id and this
 *        function REFUSES to write a second row for one that already exists.
 *        That is belt and braces beside the `StripeEvent` dedupe table — and
 *        both are wanted, because they close different holes: the event table
 *        stops one webhook DELIVERY being processed twice, and this stops two
 *        different events (a `succeeded` and a later `updated`, say) both
 *        being read as a top-up for the same payment. A replayed grant is a
 *        direct, unrecoverable loss, so it is worth two locks.
 *
 *        Returns null when it refused, so the caller can log a replay rather
 *        than reporting a success that did not happen.
 * WHERE: `credits.purchase`, and the Stripe webhook's payment-intent branch.
 */
export async function purchase(
  db: DbClient,
  args: {
    organizationId: string;
    amount: number;
    paymentIntentId: string;
    packKey: CreditPackKey;
  },
): Promise<CreditLedgerRow | null> {
  const existing = await db.creditLedger.findFirst({
    where: { refId: args.paymentIntentId, kind: "purchase" },
    select: { id: true },
  });
  if (existing !== null) return null;

  return appendLedgerRow(db, {
    organizationId: args.organizationId,
    kind: "purchase",
    amount: args.amount,
    refId: args.paymentIntentId,
    metadata: { packKey: args.packKey },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: listLedger, LEDGER_IS_NEWEST_FIRST
 *
 * WHAT:  A page of this workspace's credit history.
 * WHY:   Ordered by `createdAt` descending — the ledger is append-only, so
 *        there is no `updatedAt` to confuse it with, and the row somebody
 *        wants is almost always the most recent one.
 * WHERE: `credits.listLedger`; the table on the credits screen.
 */
export async function listLedger(
  db: DbClient,
  filters: { organizationId: string; kind?: CreditLedgerKind | undefined },
  page: { skip: number; take: number },
): Promise<{ rows: CreditLedgerRow[]; total: number }> {
  const where: Prisma.CreditLedgerWhereInput = {
    organizationId: filters.organizationId,
    ...(filters.kind !== undefined ? { kind: filters.kind } : {}),
  };

  const [rows, total] = await Promise.all([
    db.creditLedger.findMany({
      where,
      select: LEDGER_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: page.skip,
      take: page.take,
    }),
    db.creditLedger.count({ where }),
  ]);

  return { rows, total };
}

/**
 * SOURCE OF TRUTH KEYWORDS: findOpenHoldForRef, ORPHANED_HOLD
 *
 * WHAT:  The unsettled hold against a given reference, if there is one.
 * WHY:   ORPHANED_HOLD. A workflow that is retried from the top — which Inngest
 *        does — would otherwise place a SECOND hold for the same render, and
 *        the first would never be settled by anything: the run that created it
 *        no longer exists. The money would sit reserved forever, invisible,
 *        and the customer's balance would be quietly short with a correct
 *        ledger and a correct cache, so reconcile would report nothing.
 *        Looking for an existing open hold first is what makes the hold step
 *        idempotent.
 * WHERE: The `hold-credits` step of src/inngest/functions/project-render.ts.
 */
export async function findOpenHoldForRef(
  db: DbClient,
  refId: string,
): Promise<{ id: string; delta: number } | null> {
  const holds = await db.creditLedger.findMany({
    where: { refId, kind: "hold" },
    select: { id: true, delta: true },
    orderBy: { createdAt: "desc" },
  });
  if (holds.length === 0) return null;

  const settled = await db.creditLedger.findMany({
    where: {
      holdId: { in: holds.map((row) => row.id) },
      kind: { in: ["commit", "release"] },
    },
    select: { holdId: true },
  });
  const settledIds = new Set(settled.map((row) => row.holdId));

  return holds.find((row) => !settledIds.has(row.id)) ?? null;
}
