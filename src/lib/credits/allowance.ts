/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: CREDIT_ALLOWANCES, PLACEHOLDER_CREDIT_ALLOWANCES,
 *   signupGrantFor, monthlyAllowanceFor, allowancePeriodRef,
 *   allowanceIdempotencyKey, signupIdempotencyKey, ALLOWANCE_IS_PURE,
 *   AN_ALLOWANCE_IS_GRANTED_ONCE_PER_PERIOD
 *
 * WHAT:  How many credits a workspace is GIVEN — once when it is created, and
 *        once per calendar month for its plan — plus the ledger keys that make
 *        each of those grants happen exactly once.
 *
 * WHY:   `grant` existed in the credits service with ZERO callers, so the only
 *         way credits could ever reach a workspace was a real Stripe payment.
 *         A new workspace therefore started on a zero balance and failed at
 *         the FIRST pipeline stage — `script` and `tts` each cost a base of 1
 *         credit — which made the product untestable without hand-writing a
 *         ledger row. This module is the policy half of closing that.
 *
 *        ALLOWANCE_IS_PURE — no I/O, no clock, no database. It takes a plan
 *        and returns numbers, which is what lets the same figures appear on a
 *        pricing card, in the signup grant and in the monthly cron without
 *        three implementations. The period is passed IN rather than read from
 *        a clock here, so the cron and a test can both say which month they
 *        mean.
 *
 *        ⚠ THE NUMBERS ARE PLACEHOLDERS, exactly as `CREDIT_RATES` in
 *        ./estimate.ts is, and for the same reason: nobody has priced them.
 *        They are internally consistent — a free workspace gets enough to
 *        finish one short video and see the product work, each paid tier gets
 *        more than the one below — and that is ALL they are. Setting real
 *        figures is one edit to PLACEHOLDER_CREDIT_ALLOWANCES and nothing
 *        else, because every consumer reads it through the helpers below.
 *
 *        Deliberately NOT in src/lib/config/plans.ts. That module is
 *        env-driven display data for pricing cards and is client-safe; this is
 *        credit policy and belongs beside the tariff it is spent against.
 * WHERE: `createOrganization` (the signup grant), the `credits.allowance`
 *        workflow (the monthly one), and the allowance tests.
 */

import { PLAN_KEYS, type PlanKey } from "@/lib/config/plans";

export interface PlanCreditAllowance {
  /** Granted once, when the workspace is created. */
  signup: number;
  /** Granted once per calendar month while the workspace is on this plan. */
  monthly: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: PLACEHOLDER_CREDIT_ALLOWANCES, CREDIT_ALLOWANCES
 *
 * ⚠ PLACEHOLDERS. See the file header before charging anybody.
 *
 * Two properties the CODE depends on, which real figures must preserve: every
 * value is a non-negative integer (a fractional credit cannot be granted), and
 * a plan with no allowance says `0` rather than being absent — a missing entry
 * would make `monthlyAllowanceFor` return undefined and grant NaN.
 */
export const PLACEHOLDER_CREDIT_ALLOWANCES: Readonly<
  Record<PlanKey, PlanCreditAllowance>
> = {
  /* Enough to write a script, narrate it, time the captions and render once —
   * the point is that a new workspace can reach a finished video without a
   * card, because a product nobody can try is a product nobody buys. */
  free: { signup: 100, monthly: 0 },
  starter: { signup: 100, monthly: 500 },
  pro: { signup: 100, monthly: 2_000 },
  enterprise: { signup: 100, monthly: 10_000 },
  /**
   * THE_PORTAL_STILL_PAYS_IN_CREDITS. `isPortalOrganization` grants the
   * operator workspace the unlimited plan TIER, which gates features — it does
   * not touch the credit ledger, because the ledger is a count of real
   * provider spend and an operator's renders cost exactly what a customer's
   * do. So the portal gets an allowance rather than an exemption: the spend
   * stays visible in `credits.listLedger` instead of becoming an untracked
   * hole in the cost reporting the Phase 05 reconciler exists to produce.
   *
   * Large enough that an operator never hits it while testing or reproducing a
   * customer's problem, which is the only thing this number has to achieve.
   */
  portal: { signup: 10_000, monthly: 50_000 },
};

export const CREDIT_ALLOWANCES = PLACEHOLDER_CREDIT_ALLOWANCES;

/** The one-off welcome grant for a workspace starting on `plan`. */
export function signupGrantFor(plan: PlanKey): number {
  return CREDIT_ALLOWANCES[plan].signup;
}

/** The recurring monthly grant for a workspace on `plan`. 0 means none. */
export function monthlyAllowanceFor(plan: PlanKey): number {
  return CREDIT_ALLOWANCES[plan].monthly;
}

/** Every plan that receives a recurring allowance at all. */
export const PLANS_WITH_MONTHLY_ALLOWANCE: readonly PlanKey[] = PLAN_KEYS.filter(
  (plan) => CREDIT_ALLOWANCES[plan].monthly > 0,
);

/**
 * SOURCE OF TRUTH KEYWORDS: allowancePeriodRef,
 *   AN_ALLOWANCE_IS_GRANTED_ONCE_PER_PERIOD
 *
 * WHAT:  The ledger `refId` shared by every allowance grant for one month.
 *
 * WHY:   Shared ON PURPOSE, and it is what makes the cron cheap. The job runs
 *        HOURLY (see usageResetFunction for why a monthly cron is worse), so
 *        it needs to find the workspaces that have not been granted THIS
 *        month without asking once per workspace. A refId that names only the
 *        period lets that be a single indexed `none:` filter; the per-workspace
 *        uniqueness lives in the idempotency key below.
 * WHERE: The allowance workflow's query, and the grant it writes.
 */
export function allowancePeriodRef(periodStart: Date): string {
  const year = periodStart.getUTCFullYear();
  /* Padded so "2026-9" cannot sort or compare as a different shape to
   * "2026-09", and UTC so the boundary does not move with the server. */
  const month = String(periodStart.getUTCMonth() + 1).padStart(2, "0");
  return `allowance:${year}-${month}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: allowanceIdempotencyKey,
 *   AN_ALLOWANCE_IS_GRANTED_ONCE_PER_PERIOD, THE_DATABASE_IS_THE_GUARANTEE
 *
 * WHAT:  The globally unique key for one workspace's grant in one month.
 *
 * WHY:   AN_ALLOWANCE_IS_GRANTED_ONCE_PER_PERIOD, enforced by the unique index
 *        on `CreditLedger.idempotencyKey` rather than by the query that found
 *        the workspace. The cron fires every hour and two runs can overlap, so
 *        a filter alone would grant a second allowance the moment one run read
 *        the table before another had written to it. With this key the second
 *        insert is refused by Postgres — which matters more here than almost
 *        anywhere, because a duplicated allowance is credits given away with
 *        nothing to attribute them to.
 * WHERE: The allowance workflow.
 */
export function allowanceIdempotencyKey(
  organizationId: string,
  periodStart: Date,
): string {
  return `${allowancePeriodRef(periodStart)}:${organizationId}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: signupIdempotencyKey
 *
 * The welcome grant's key. Carries no period: a workspace is created once, so
 * this is what stops a retried creation — or a second call against an
 * organization that already exists — handing out a second welcome balance.
 */
export function signupIdempotencyKey(organizationId: string): string {
  return `signup:${organizationId}`;
}
