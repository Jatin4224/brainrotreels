/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: isPeriodicResource, currentPeriodStart,
 *   isUsageStale, effectiveUsage, CALENDAR_MONTH_ANCHOR, PERIODIC_USAGE
 *
 * WHAT:  Decides whether a resource's counter refills, and whether a stored
 *        counter belongs to the current window.
 * WHY:   CALENDAR_MONTH_ANCHOR. A periodic quota has to reset relative to
 *        something, and the two candidates give different answers for every
 *        paying customer: the calendar month, or each organization's Stripe
 *        billing date (`Subscription.periodEnd`). This picks the CALENDAR
 *        MONTH, in UTC, because the quota is a product promise ("500,000 API
 *        calls a month") rather than a billing line item — a free workspace
 *        has no subscription to anchor to at all, and anchoring only paid
 *        plans would mean two different reset rules in one system.
 *        Revisit if usage is ever invoiced, where billing-period alignment
 *        stops being cosmetic.
 *
 *        READ-TIME STALENESS is the other half. The cron is a convenience,
 *        not the mechanism: it may be late, it may not have run on a fresh
 *        deployment, and a cron that silently stops would hand every customer
 *        a permanently exhausted quota. So readers treat a counter from a
 *        previous window as zero, and the cron merely tidies the rows. Correct
 *        with or without it.
 * WHERE: Used by src/lib/feature-gate.ts when reading usage, and by the
 *        usage.reset workflow. Pure — no Prisma, no env.
 */

import { RESOURCES, type LimitResourceKey } from "./resources";

export function isPeriodicResource(resourceKey: LimitResourceKey): boolean {
  const definition = RESOURCES[resourceKey];
  if (!("limit" in definition)) return false;
  const { limit } = definition as { limit: { period?: "month" } };
  return limit.period === "month";
}

/**
 * Start of the current window, UTC. Everything recorded before this belongs
 * to a previous period.
 */
export function currentPeriodStart(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

/**
 * True when a stored counter predates the current window and must read as
 * zero. Absolute resources are never stale — a seat count is not a period.
 */
export function isUsageStale(
  resourceKey: LimitResourceKey,
  lastResetAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!isPeriodicResource(resourceKey)) return false;
  if (!lastResetAt) return false;
  return lastResetAt.getTime() < currentPeriodStart(now).getTime();
}

/**
 * The usage a gate should act on: the stored value, or zero when the stored
 * value belongs to a window that has closed.
 */
export function effectiveUsage(
  resourceKey: LimitResourceKey,
  storedUsage: number,
  lastResetAt: Date | null | undefined,
  now: Date = new Date(),
): number {
  return isUsageStale(resourceKey, lastResetAt, now) ? 0 : storedUsage;
}

/** Every resource whose counter refills — the cron's work list. */
export function periodicResourceKeys(): LimitResourceKey[] {
  return (Object.keys(RESOURCES) as LimitResourceKey[]).filter(
    (key) => key in RESOURCES && isPeriodicResource(key),
  );
}
