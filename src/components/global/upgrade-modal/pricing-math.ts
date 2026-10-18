/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: calculateSavings, getYearlySavings, YearlySavings,
 *   AvailablePlan, PRICES_LIVE_IN_STRIPE, PricingCard, useUpgradeNudge
 *
 * WHAT:  What paying yearly is worth on a given plan — as a percentage and as
 *        money.
 * WHY:   Two surfaces make the same claim to the user: the "Save 20%" badge on a
 *        pricing card and the sidebar nudge that says how much yearly billing
 *        would save. If they computed it separately they would eventually
 *        disagree, and a discount quoted two ways is a support ticket. Both
 *        amounts come from the provider's own prices (PRICES_LIVE_IN_STRIPE), in
 *        minor units, and are only ever formatted at the edge by
 *        formatCurrency — nothing here rounds money.
 * WHERE: <PricingCard /> via <UpgradeContent />, and useUpgradeNudge.
 */

import type { AvailablePlan } from '@/lib/types'

/**
 * SOURCE OF TRUTH KEYWORDS: YearlySavings
 *
 * The saving expressed both ways, plus the currency it is denominated in.
 * `amount` is in MINOR units, like every other price in the app.
 */
export interface YearlySavings {
  percent: number
  amount: number
  currency: string
}

/**
 * SOURCE OF TRUTH KEYWORDS: getYearlySavings
 *
 * WHAT:  What one year on this plan costs less when billed yearly, or null.
 * WHY:   Null — not zero — when either price is missing or yearly is not
 *        actually cheaper, so a caller cannot accidentally advertise a "save
 *        $0" offer on a plan with no yearly discount configured. Fail-soft
 *        matters here specifically because an unconfigured price id is the
 *        normal state of a fresh clone.
 * WHERE: useUpgradeNudge (the money in the sidebar line) and calculateSavings.
 */
export function getYearlySavings(plan: AvailablePlan): YearlySavings | null {
  const monthly = plan.monthlyPrice
  const yearly = plan.yearlyPrice
  if (!monthly?.amount || !yearly?.amount) return null

  const monthlyTotal = monthly.amount * 12
  const amount = monthlyTotal - yearly.amount
  if (amount <= 0) return null

  return {
    amount,
    percent: Math.round((amount / monthlyTotal) * 100),
    currency: yearly.currency,
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: calculateSavings
 *
 * The percentage half on its own, as 0 when there is nothing to advertise —
 * the pricing card hides its badge on 0, so it wants a number, not a null.
 */
export function calculateSavings(plan: AvailablePlan): number {
  return getYearlySavings(plan)?.percent ?? 0
}
