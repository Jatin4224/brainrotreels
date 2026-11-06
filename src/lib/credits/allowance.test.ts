/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: allowance test, CREDIT_ALLOWANCES,
 *   signupGrantFor, monthlyAllowanceFor, allowancePeriodRef,
 *   allowanceIdempotencyKey, AN_ALLOWANCE_IS_GRANTED_ONCE_PER_PERIOD
 *
 * WHAT:  The credit-allowance policy — the per-plan figures, and the two
 *        ledger keys that decide how often a grant can happen.
 *
 * WHY:   The keys are the part worth asserting. `allowancePeriodRef` is what
 *        the hourly query filters on, and `allowanceIdempotencyKey` is what
 *        the unique index refuses a second time — so a bug in either is not a
 *        wrong number on a screen, it is a workspace granted a month's credits
 *        every hour, or never granted at all. Neither failure is visible in a
 *        type.
 *
 *        The two properties the code depends on are asserted over EVERY plan
 *        rather than spot-checked, because `monthlyAllowanceFor` returning
 *        undefined for a plan nobody listed would grant NaN credits — a
 *        balance that then compares false against every threshold.
 *
 *        The figures themselves are PLACEHOLDERS, so the tests deliberately
 *        assert their SHAPE (non-negative integers, paid ≥ free) rather than
 *        their values. Pinning the numbers would mean editing tests to price
 *        the product, which is how a test stops meaning anything.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { PLAN_KEYS } from "@/lib/config/plans";
import {
  CREDIT_ALLOWANCES,
  PLANS_WITH_MONTHLY_ALLOWANCE,
  allowanceIdempotencyKey,
  allowancePeriodRef,
  monthlyAllowanceFor,
  signupGrantFor,
  signupIdempotencyKey,
} from "./allowance";

const utc = (year: number, month: number) => new Date(Date.UTC(year, month, 1));

describe("CREDIT_ALLOWANCES", () => {
  it("covers every plan, so no plan can grant NaN", () => {
    for (const plan of PLAN_KEYS) {
      expect(CREDIT_ALLOWANCES[plan]).toBeDefined();
      expect(Number.isFinite(signupGrantFor(plan))).toBe(true);
      expect(Number.isFinite(monthlyAllowanceFor(plan))).toBe(true);
    }
  });

  it("is non-negative integers throughout — a fractional credit cannot be granted", () => {
    for (const plan of PLAN_KEYS) {
      for (const amount of [signupGrantFor(plan), monthlyAllowanceFor(plan)]) {
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gives a new free workspace enough to finish one video", () => {
    /* The whole point of the welcome grant: `script` and `tts` each cost a
     * base of 1 credit, so a zero balance fails at the FIRST stage and the
     * product cannot be tried at all. The exact figure is a placeholder; that
     * it is spendable is not. */
    expect(signupGrantFor("free")).toBeGreaterThan(0);
  });

  it("never gives a paid plan less each month than the plan below it", () => {
    /* Zipped into pairs rather than indexed, so the comparison needs no
     * non-null assertion to satisfy `noUncheckedIndexedAccess`. */
    const ladder = ["free", "starter", "pro", "enterprise"] as const;
    const pairs = ladder
      .slice(1)
      .map((plan, index) => [ladder[index], plan] as const);

    for (const [lower, higher] of pairs) {
      if (lower === undefined) continue;
      expect(monthlyAllowanceFor(higher)).toBeGreaterThanOrEqual(
        monthlyAllowanceFor(lower),
      );
    }
  });

  it("lists exactly the plans with a recurring allowance", () => {
    for (const plan of PLAN_KEYS) {
      expect(PLANS_WITH_MONTHLY_ALLOWANCE.includes(plan)).toBe(
        monthlyAllowanceFor(plan) > 0,
      );
    }
  });
});

describe("allowancePeriodRef", () => {
  it("is the same for every workspace in one month", () => {
    /* Shared ON PURPOSE — it is what lets the hourly job find the workspaces
     * it has not granted with one indexed filter instead of one query each. */
    expect(allowancePeriodRef(utc(2026, 10))).toBe(
      allowancePeriodRef(utc(2026, 10)),
    );
  });

  it("changes at the month boundary", () => {
    expect(allowancePeriodRef(utc(2026, 11))).not.toBe(
      allowancePeriodRef(utc(2026, 10)),
    );
  });

  it("zero-pads the month, so no two months can share a shape", () => {
    /* "2026-9" and "2026-09" would compare and sort as different strings for
     * the same month, which is how one month gets granted twice. */
    expect(allowancePeriodRef(utc(2026, 8))).toBe("allowance:2026-09");
    expect(allowancePeriodRef(utc(2026, 11))).toBe("allowance:2026-12");
  });

  it("reads the date in UTC, so the boundary does not move with the server", () => {
    /* 1 Jan 2027 00:30 UTC is still December where the server sits in UTC-5.
     * Keyed on local time, those workspaces would be granted January's
     * allowance twice — once before the local boundary and once after. */
    expect(allowancePeriodRef(new Date("2027-01-01T00:30:00Z"))).toBe(
      "allowance:2027-01",
    );
  });
});

describe("allowanceIdempotencyKey", () => {
  it("is unique per workspace per month", () => {
    const a = allowanceIdempotencyKey("org_1", utc(2026, 10));
    expect(allowanceIdempotencyKey("org_2", utc(2026, 10))).not.toBe(a);
    expect(allowanceIdempotencyKey("org_1", utc(2026, 11))).not.toBe(a);
  });

  it("is stable for one workspace within a month", () => {
    /* AN_ALLOWANCE_IS_GRANTED_ONCE_PER_PERIOD: two runs in the same month must
     * produce the SAME key, or the unique index has nothing to refuse. */
    expect(allowanceIdempotencyKey("org_1", utc(2026, 10))).toBe(
      allowanceIdempotencyKey("org_1", new Date(Date.UTC(2026, 10, 27, 13))),
    );
  });

  it("cannot collide with a welcome grant or a Stripe payment intent", () => {
    /* One nullable unique column serves all three, so the namespaces have to
     * be disjoint — see the note on CreditLedger.idempotencyKey. */
    const allowance = allowanceIdempotencyKey("org_1", utc(2026, 10));
    expect(allowance).not.toBe(signupIdempotencyKey("org_1"));
    expect(allowance.startsWith("allowance:")).toBe(true);
    expect(signupIdempotencyKey("org_1").startsWith("signup:")).toBe(true);
    expect(allowance.startsWith("pi_")).toBe(false);
  });
});

describe("signupIdempotencyKey", () => {
  it("is per workspace and carries no period", () => {
    /* A workspace is created once; the key is what stops a retried creation
     * handing out a second welcome balance. */
    expect(signupIdempotencyKey("org_1")).toBe(signupIdempotencyKey("org_1"));
    expect(signupIdempotencyKey("org_2")).not.toBe(
      signupIdempotencyKey("org_1"),
    );
  });
});
