/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: background gating tests, backgroundAvailableOnPlan,
 *   plansUpTo, PREMIUM_IS_A_MIN_PLAN, LOCKED_NOT_HIDDEN, MIN_PLAN_IS_A_LADDER
 *
 * WHAT:  Tests for the two halves of the catalogue's plan gate — the one a
 *        lock badge uses and the one a query uses.
 *
 * WHY:   The two have to agree, and they are written in different languages:
 *        `backgroundAvailableOnPlan` compares ladder POSITIONS in TypeScript
 *        and `plansUpTo` produces an `IN (…)` list for SQL. A disagreement
 *        between them is a background the picker offers and the server refuses
 *        (or worse, the reverse), so the last test here checks them against
 *        each other over every pair rather than asserting each in isolation.
 *
 *        The unsafe direction is asserted explicitly: a `minPlan` this build
 *        does not recognise must LOCK, because a row written by a future
 *        release naming a plan we have never heard of must not be handed out
 *        for nothing — while a NULL `minPlan` must be free, because that is
 *        what every ungated row and every customer upload carries.
 * WHERE: Run by `npm test`. Guards src/lib/types/background.ts.
 */

import { describe, expect, it } from "vitest";

import { PLAN_KEYS } from "@/lib/config/plans";
import { backgroundAvailableOnPlan, plansUpTo } from "./background";

describe("backgroundAvailableOnPlan", () => {
  it("includes a row at the workspace's own plan", () => {
    expect(backgroundAvailableOnPlan("starter", "starter")).toBe(true);
  });

  /* PREMIUM_IS_A_MIN_PLAN — a higher plan gets everything below it, which is
   * what stops the catalogue from listing each row against every plan that
   * includes it. */
  it("includes every row below the workspace's plan", () => {
    expect(backgroundAvailableOnPlan("free", "pro")).toBe(true);
    expect(backgroundAvailableOnPlan("starter", "pro")).toBe(true);
  });

  it("locks a row above the workspace's plan", () => {
    expect(backgroundAvailableOnPlan("pro", "free")).toBe(false);
    expect(backgroundAvailableOnPlan("starter", "free")).toBe(false);
  });

  /* Null is "not gated" — the state of every ungated catalogue row and of
   * every customer upload, which must never be locked. */
  it("treats an ungated row as available to everybody", () => {
    expect(backgroundAvailableOnPlan(null, "free")).toBe(true);
    expect(backgroundAvailableOnPlan("", "free")).toBe(true);
  });

  /* The unsafe direction, asserted on purpose: this is the one that has to be
   * a refusal rather than a shrug. */
  it("locks a row naming a plan this build does not recognise", () => {
    expect(backgroundAvailableOnPlan("platinum", "enterprise")).toBe(false);
  });
});

describe("plansUpTo", () => {
  it("includes the plan itself and everything below it", () => {
    expect(plansUpTo("free")).toEqual(["free"]);
    expect(plansUpTo("starter")).toEqual(["free", "starter"]);
  });

  it("covers every plan for the top of the ladder", () => {
    expect(plansUpTo(PLAN_KEYS[PLAN_KEYS.length - 1] ?? "free")).toHaveLength(
      PLAN_KEYS.length,
    );
  });

  /**
   * The property that actually matters: the SQL list and the badge comparison
   * must select the same set. A drift here is a lock badge and a `where`
   * clause that disagree, which is invisible until somebody sits exactly on
   * the boundary.
   */
  it("selects exactly what backgroundAvailableOnPlan allows", () => {
    for (const plan of PLAN_KEYS) {
      const allowed = plansUpTo(plan);
      for (const candidate of PLAN_KEYS) {
        expect(
          allowed.includes(candidate),
          `${candidate} on ${plan}`,
        ).toBe(backgroundAvailableOnPlan(candidate, plan));
      }
    }
  });
});
