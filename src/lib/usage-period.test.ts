/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: usage-period tests, effectiveUsage, isUsageStale,
 *   CALENDAR_MONTH_ANCHOR, PERIODIC_USAGE, periodicResourceKeys
 *
 * WHAT:  Tests for periodic-usage staleness and the window anchor.
 * WHY:   Two directions matter and they fail differently. Treating an
 *        ABSOLUTE counter as periodic silently refills it — a free workspace
 *        could invite one member per month forever, and nothing would look
 *        wrong. Treating a PERIODIC counter as absolute leaves customers on a
 *        permanently exhausted quota. Both are asserted by resource name.
 *        The boundary cases use explicit UTC dates rather than relative
 *        arithmetic, because the bug this guards against is an off-by-one at
 *        exactly midnight on the first.
 * WHERE: Run by `npm test`. Guards src/lib/usage-period.ts.
 */

import { describe, expect, it } from "vitest";

import {
  currentPeriodStart,
  effectiveUsage,
  isPeriodicResource,
  isUsageStale,
  nextPeriodStart,
  periodicResourceKeys,
} from "./usage-period";

const JAN = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
const JAN_START = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
const DEC_PREV = new Date(Date.UTC(2025, 11, 20, 12, 0, 0));

describe("currentPeriodStart", () => {
  it("returns midnight UTC on the first of the month", () => {
    expect(currentPeriodStart(JAN).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("is stable anywhere within the month", () => {
    const early = currentPeriodStart(new Date(Date.UTC(2026, 0, 1, 0, 0, 1)));
    const late = currentPeriodStart(
      new Date(Date.UTC(2026, 0, 31, 23, 59, 59)),
    );
    expect(early.getTime()).toBe(late.getTime());
  });

  it("rolls at the month boundary", () => {
    const dec = currentPeriodStart(
      new Date(Date.UTC(2025, 11, 31, 23, 59, 59)),
    );
    const jan = currentPeriodStart(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
    expect(dec.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(jan.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("which resources refill", () => {
  it("treats apiCalls as periodic", () => {
    expect(isPeriodicResource("apiCalls")).toBe(true);
    expect(periodicResourceKeys()).toContain("apiCalls");
  });

  /* Refilling either of these is a silent correctness bug, not a cosmetic
   * one — seats would be re-granted monthly, and the byte counter would
   * detach from the objects actually stored. */
  it.each(["member", "storage"] as const)("treats %s as absolute", (key) => {
    expect(isPeriodicResource(key)).toBe(false);
    expect(periodicResourceKeys()).not.toContain(key);
  });
});

describe("isUsageStale", () => {
  it("is false for an absolute resource however old the stamp", () => {
    expect(isUsageStale("member", DEC_PREV, JAN)).toBe(false);
    expect(isUsageStale("storage", new Date(Date.UTC(2020, 0, 1)), JAN)).toBe(
      false,
    );
  });

  it("is true for a periodic counter stamped in a previous month", () => {
    expect(isUsageStale("apiCalls", DEC_PREV, JAN)).toBe(true);
  });

  it("is false for a periodic counter stamped inside the current month", () => {
    expect(isUsageStale("apiCalls", JAN_START, JAN)).toBe(false);
    expect(isUsageStale("apiCalls", new Date(Date.UTC(2026, 0, 14)), JAN)).toBe(
      false,
    );
  });

  /* Exactly the window start is INSIDE the window, not before it. */
  it("treats the boundary instant as current", () => {
    expect(isUsageStale("apiCalls", JAN_START, JAN)).toBe(false);
    expect(
      isUsageStale("apiCalls", new Date(JAN_START.getTime() - 1), JAN),
    ).toBe(true);
  });

  it("is false when there is no stamp at all", () => {
    expect(isUsageStale("apiCalls", null, JAN)).toBe(false);
    expect(isUsageStale("apiCalls", undefined, JAN)).toBe(false);
  });
});

describe("effectiveUsage", () => {
  it("zeroes a periodic counter from a closed window", () => {
    expect(effectiveUsage("apiCalls", 4_000, DEC_PREV, JAN)).toBe(0);
  });

  it("keeps a periodic counter inside the current window", () => {
    expect(effectiveUsage("apiCalls", 4_000, JAN_START, JAN)).toBe(4_000);
  });

  it("never zeroes an absolute counter", () => {
    expect(effectiveUsage("member", 3, DEC_PREV, JAN)).toBe(3);
    expect(effectiveUsage("storage", 1_024, DEC_PREV, JAN)).toBe(1_024);
  });

  /* The gate must be correct whether or not the cron has ever run. */
  it("is correct with no stamp, as on a row the cron has never touched", () => {
    expect(effectiveUsage("apiCalls", 12, null, JAN)).toBe(12);
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: nextPeriodStart, THE_RESET_IS_A_FACT_NOT_A_GUESS
 *
 * The instant a `429` tells a client to come back. Asserted in UTC because
 * CALENDAR_MONTH_ANCHOR fixes the boundary for every customer at once — a
 * reset that drifted with a server's local zone would hand two customers
 * different answers for the same quota.
 */
describe("nextPeriodStart", () => {
  it("is the first instant of the following month, UTC", () => {
    expect(nextPeriodStart(JAN).toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("rolls December into the next January", () => {
    /* `Date.UTC` carries the month over on its own, so December needs no
     * special case — this is the test that proves it rather than the comment. */
    const december = new Date(Date.UTC(2026, 11, 20, 8, 30, 0));
    expect(nextPeriodStart(december).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("is always in the future relative to its own input", () => {
    for (const month of [0, 1, 5, 10, 11]) {
      const now = new Date(Date.UTC(2026, month, 28, 23, 59, 59));
      expect(nextPeriodStart(now).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("is exactly one period after the current period's start", () => {
    /* The two helpers bracket the same window, so a gate that reads usage from
     * one and a reset from the other cannot disagree about which month it is
     * talking about. */
    expect(nextPeriodStart(JAN).getTime()).toBeGreaterThan(
      currentPeriodStart(JAN).getTime(),
    );
    expect(currentPeriodStart(nextPeriodStart(JAN)).toISOString()).toBe(
      nextPeriodStart(JAN).toISOString(),
    );
  });

  it("does not move during a month", () => {
    /* Every request in a window gets the same answer, so a client is not told
     * a slightly different reset on each refusal. */
    const early = new Date(Date.UTC(2026, 2, 1, 0, 0, 1));
    const late = new Date(Date.UTC(2026, 2, 31, 23, 59, 59));
    expect(nextPeriodStart(early).toISOString()).toBe(
      nextPeriodStart(late).toISOString(),
    );
  });
});
