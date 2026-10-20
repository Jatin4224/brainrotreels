/**
 * SOURCE OF TRUTH KEYWORDS: settlementRows, settlementNet,
 *   NET_IS_THE_ACTUAL_COST, RELEASE_REVERSES_THE_WHOLE_HOLD, settlement tests
 *
 * WHAT:  Whether settling a hold charges what the work actually cost.
 *
 * WHY:   This is a REGRESSION TEST for a bug that shipped. The phase brief
 *        describes the compensating release as being "for the difference",
 *        which double-charges every job because the hold has already deducted
 *        the estimate. It was caught by a probe against a real database, not
 *        by review, and it is exactly the kind of mistake somebody re-reading
 *        the brief would reintroduce.
 *
 *        So the assertions are written against the PROPERTY — the net equals
 *        the actual cost — rather than against the row shapes. The rows are an
 *        implementation detail; what a customer is charged is not.
 * WHERE: Run by `npm test`. Guards src/lib/credits/settlement.ts.
 */

import { describe, expect, it } from "vitest";

import { settlementNet, settlementRows } from "./settlement";

/**
 * `toBe` uses Object.is, which distinguishes -0 from +0 — and `-actual` is -0
 * whenever the work cost nothing. That distinction has no meaning for a credit
 * balance, so both sides are normalised. Adding 0 turns -0 into +0 and leaves
 * every other value alone.
 */
const zeroSafe = (value: number): number => value + 0;

describe("settlementNet", () => {
  /**
   * NET_IS_THE_ACTUAL_COST — the one invariant. Whatever was estimated, the
   * ledger's total movement must equal what the work cost.
   */
  it("always nets to the actual cost, whatever was held", () => {
    const cases: [held: number, actual: number][] = [
      [12, 9], // cheaper than estimated — the original bug
      [12, 12], // exactly as estimated
      [12, 20], // dearer than estimated
      [12, 0], // cost nothing after all
      [0, 0], // a free job
      [0, 5], // held nothing, cost something
      [1000, 1], // wildly over-estimated
    ];

    for (const [held, actual] of cases) {
      expect(
        zeroSafe(settlementNet(held, actual)),
        `held ${held}, actual ${actual}`,
      ).toBe(zeroSafe(-actual));
    }
  });

  it("nets to the actual cost across a wide sweep", () => {
    /* The bug only showed at particular values, so this walks a range rather
     * than trusting a handful of examples. */
    for (let held = 0; held <= 60; held += 1) {
      for (let actual = 0; actual <= 60; actual += 7) {
        expect(zeroSafe(settlementNet(held, actual)), `${held}/${actual}`).toBe(
          zeroSafe(-actual),
        );
      }
    }
  });

  it("charges in full when the work cost more than was held", () => {
    /* The business must not silently eat an underestimate — the overspend is
     * the signal that the estimator needs fixing. */
    expect(settlementNet(10, 25)).toBe(-25);
  });
});

describe("settlementRows", () => {
  it("reverses the WHOLE hold, not the difference", () => {
    /* RELEASE_REVERSES_THE_WHOLE_HOLD. If this ever reads 3 again, the
     * double-charge is back. */
    const rows = settlementRows(12, 9);
    const release = rows.find((row) => row.kind === "release");
    expect(release?.amount).toBe(12);
  });

  it("writes a commit for the real amount", () => {
    const rows = settlementRows(12, 9);
    expect(rows.find((row) => row.kind === "commit")?.amount).toBe(9);
  });

  it("writes no commit row when the work cost nothing", () => {
    /* A zero-delta row is a row that says nothing; the release alone already
     * reads as "held, then settled at nothing". */
    const rows = settlementRows(12, 0);
    expect(rows.some((row) => row.kind === "commit")).toBe(false);
    expect(rows.find((row) => row.kind === "release")?.amount).toBe(12);
  });

  it("emits only positive amounts, leaving the sign to the kind", () => {
    /* The service applies SIGN_BY_KIND once. A negative here would double-
     * negate and refund where a charge was meant. */
    for (const [held, actual] of [
      [12, 9],
      [0, 5],
      [50, 50],
    ] as const) {
      for (const row of settlementRows(held, actual)) {
        expect(row.amount, `${held}/${actual}`).toBeGreaterThan(0);
      }
    }
  });

  it("rounds to whole credits, because the column is an integer", () => {
    const rows = settlementRows(12.4, 9.6);
    for (const row of rows) {
      expect(Number.isInteger(row.amount)).toBe(true);
    }
  });

  it("never produces a negative amount from nonsense input", () => {
    for (const row of settlementRows(-5, -10)) {
      expect(row.amount).toBeGreaterThan(0);
    }
    expect(zeroSafe(settlementNet(-5, -10))).toBe(0);
  });
});
