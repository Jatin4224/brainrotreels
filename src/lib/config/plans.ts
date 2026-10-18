/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

import {
  envBoolean,
  envInteger,
  envOptional,
  envString,
  publicEnv,
} from './env.public'

/**
 * SOURCE OF TRUTH KEYWORDS: PLAN_KEYS, PlanKey, PlanDefinition, PLANS,
 *   PLAN_ORDER, BillingInterval, getPlanPriceId, getPlanByPriceId, getNextPlan,
 *   isPaidPlan
 *
 * WHAT:  Plan identity + display metadata AND the Stripe price-id mapping per
 *        (plan, interval). Per-plan VALUES (caps, flags) live in
 *        src/lib/resources.ts under each resource's perPlan table — this file
 *        is the plan's branding/identity and its Stripe wiring.
 * WHY:   Price ids are env-driven (created in the Stripe dashboard) so the same
 *        code ships to any account; the (plan, interval) → priceId lookup and
 *        the reverse (priceId → plan) both live here so the checkout flow and
 *        the webhook agree on the mapping.
 * WHERE: PlanKey types RESOURCES.perPlan; PLANS metadata powers the pricing UI;
 *        price helpers used by the billing router + Stripe webhook.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PLAN_KEYS, PlanKey
 *
 * WHAT:  THE single list of every plan identifier, ordered cheapest → most
 *        expensive with the hidden `portal` tier last. `PlanKey` (the type),
 *        `PLAN_ORDER` (purchasable upgrade order), `PLANS` (metadata) and
 *        RESOURCES.perPlan tables ALL derive from this one tuple — never
 *        re-list plan keys anywhere else.
 * WHY:   One authoritative tuple means adding/removing a plan is a one-line
 *        change that TypeScript then enforces everywhere (perPlan exhaustiveness,
 *        the runtime guard, the upgrade order).
 * WHERE: PlanKey below; PLAN_KEYS re-exported by resources.ts for the runtime
 *        guard in feature-gate.ts.
 *
 * `portal` is a hidden, non-purchasable tier for the platform-admin workspace
 * (isPortalOrganization). It grants everything (unlimited limits, all flags) and
 * is never shown in pricing or the upgrade order.
 */
export const PLAN_KEYS = ['free', 'starter', 'pro', 'enterprise', 'portal'] as const

export type PlanKey = (typeof PLAN_KEYS)[number]

export type BillingInterval = 'monthly' | 'yearly'

export interface PlanDefinition {
  name: string
  /* One line under the plan name on a pricing card — who the plan is for. */
  description: string
  icon: string
  showPlan: boolean
  trialDays: number
  /* Stripe recurring Price ids per interval. `free` has none. Env-driven, so
   * values are `string | undefined` (exactOptionalPropertyTypes). */
  stripe: {
    monthly?: string | undefined
    yearly?: string | undefined
  }
}

/* Operator-tunable plan attributes come from `publicEnv`, which reads every
 * NEXT_PUBLIC_* variable LITERALLY — see LITERAL_ENV_READ in env.public.ts.
 * The helpers below take the VALUE, never the key. This file previously read
 * `process.env[key]` through a helper, which Next cannot inline into the client
 * bundle: plan names set in .env were correct on the server and silently fell
 * back to the template defaults in the browser. Passing a key again would
 * reintroduce exactly that. */

/**
 * SOURCE OF TRUTH KEYWORDS: PLANS
 *
 * WHAT:  Per-plan display metadata + Stripe price ids. `name`, `description`,
 *        `showPlan` and `trialDays` are env-driven (with defaults) so the operator can rebrand
 *        plans, hide a tier from pricing, and set trial lengths from .env; the
 *        `icon` and Stripe price ids round out the entry. `portal` is the hidden
 *        admin tier and stays fixed (never sold, never renamed).
 * WHERE: Pricing/plan-picker UI + billing price helpers below.
 */
export const PLANS: Record<PlanKey, PlanDefinition> = {
  free: {
    name: envString(publicEnv.NEXT_PUBLIC_FREE_NAME, 'Free'),
    description: envString(
      publicEnv.NEXT_PUBLIC_FREE_DESCRIPTION,
      'Everything you need to try things out.'
    ),
    icon: 'Package',
    showPlan: envBoolean(publicEnv.NEXT_PUBLIC_FREE_SHOW_PLAN, true),
    trialDays: envInteger(publicEnv.NEXT_PUBLIC_FREE_TRIAL_DAYS, 0),
    stripe: {},
  },
  starter: {
    name: envString(publicEnv.NEXT_PUBLIC_STARTER_NAME, 'Starter'),
    description: envString(
      publicEnv.NEXT_PUBLIC_STARTER_DESCRIPTION,
      'For a small team getting off the ground.'
    ),
    icon: 'Rocket',
    showPlan: envBoolean(publicEnv.NEXT_PUBLIC_STARTER_SHOW_PLAN, true),
    trialDays: envInteger(publicEnv.NEXT_PUBLIC_STARTER_TRIAL_DAYS, 14),
    stripe: {
      monthly: envOptional(publicEnv.NEXT_PUBLIC_STARTER_PRICE_MONTHLY),
      yearly: envOptional(publicEnv.NEXT_PUBLIC_STARTER_PRICE_YEARLY),
    },
  },
  pro: {
    name: envString(publicEnv.NEXT_PUBLIC_PRO_NAME, 'Pro'),
    description: envString(
      publicEnv.NEXT_PUBLIC_PRO_DESCRIPTION,
      'For teams that need room to grow.'
    ),
    icon: 'Zap',
    showPlan: envBoolean(publicEnv.NEXT_PUBLIC_PRO_SHOW_PLAN, true),
    trialDays: envInteger(publicEnv.NEXT_PUBLIC_PRO_TRIAL_DAYS, 14),
    stripe: {
      monthly: envOptional(publicEnv.NEXT_PUBLIC_PRO_PRICE_MONTHLY),
      yearly: envOptional(publicEnv.NEXT_PUBLIC_PRO_PRICE_YEARLY),
    },
  },
  enterprise: {
    name: envString(publicEnv.NEXT_PUBLIC_ENTERPRISE_NAME, 'Enterprise'),
    description: envString(
      publicEnv.NEXT_PUBLIC_ENTERPRISE_DESCRIPTION,
      'Unlimited scale with everything included.'
    ),
    icon: 'Building',
    showPlan: envBoolean(publicEnv.NEXT_PUBLIC_ENTERPRISE_SHOW_PLAN, true),
    trialDays: envInteger(publicEnv.NEXT_PUBLIC_ENTERPRISE_TRIAL_DAYS, 30),
    stripe: {
      monthly: envOptional(publicEnv.NEXT_PUBLIC_ENTERPRISE_PRICE_MONTHLY),
      yearly: envOptional(publicEnv.NEXT_PUBLIC_ENTERPRISE_PRICE_YEARLY),
    },
  },
  /* Hidden platform-admin tier — never sold, never in PLAN_ORDER, not renamable. */
  portal: {
    name: 'Portal',
    description: 'Platform administration workspace.',
    icon: 'ShieldCheck',
    showPlan: false,
    trialDays: 0,
    stripe: {},
  },
}

/**
 * SOURCE OF TRUTH KEYWORDS: PLAN_ORDER
 *
 * WHAT:  The purchasable plans, cheapest → most expensive — every PLAN_KEY
 *        except the hidden `portal` admin tier.
 * WHY:   Derived from the one PLAN_KEYS source (no parallel list). It is
 *        deliberately INDEPENDENT of `showPlan`: `showPlan` only controls
 *        whether a plan is rendered in the pricing table, and is env-toggleable
 *        — a hidden Enterprise tier must still stay in PLAN_ORDER so the
 *        webhook can map its Stripe price back to the plan and getNextPlan keeps
 *        a stable upgrade ladder. The pricing UI filters by showPlan itself.
 * WHERE: getPlanByPriceId / getNextPlan below; plan-selector + Stripe webhook.
 */
export const PLAN_ORDER: readonly PlanKey[] = PLAN_KEYS.filter((plan) => plan !== 'portal')

/**
 * SOURCE OF TRUTH KEYWORDS: isPaidPlan
 *
 * WHAT:  True for any plan other than `free`.
 * WHERE: Onboarding + billing branch on whether checkout is needed.
 */
export function isPaidPlan(plan: PlanKey): boolean {
  return plan !== 'free'
}

/**
 * SOURCE OF TRUTH KEYWORDS: getPlanPriceId
 *
 * WHAT:  Resolves the Stripe Price id for a (plan, interval), or null.
 * WHY:   Returns null for free or when the env var is unset so callers fail
 *        with a clear "price not configured" message rather than a Stripe 400.
 * WHERE: billing.createSubscription / upgradeOrganization.
 */
export function getPlanPriceId(plan: PlanKey, interval: BillingInterval): string | null {
  return PLANS[plan].stripe[interval] ?? null
}

/**
 * SOURCE OF TRUTH KEYWORDS: getPlanByPriceId
 *
 * WHAT:  Reverse lookup — finds the plan key owning a given Stripe Price id.
 * WHY:   The webhook receives a price id and must map it back to a plan key to
 *        store on the Subscription row.
 * WHERE: Stripe webhook handlers (src/services/stripe.service.ts).
 */
export function getPlanByPriceId(priceId: string): PlanKey | null {
  for (const plan of PLAN_ORDER) {
    const { monthly, yearly } = PLANS[plan].stripe
    if (monthly === priceId || yearly === priceId) return plan
  }
  return null
}

/**
 * SOURCE OF TRUTH KEYWORDS: getNextPlan
 *
 * WHAT:  The next plan up from the given one, or null at the top.
 * WHERE: Upgrade copy / {nextPlan} interpolation.
 */
export function getNextPlan(plan: PlanKey): PlanKey | null {
  const index = PLAN_ORDER.indexOf(plan)
  if (index === -1 || index === PLAN_ORDER.length - 1) return null
  return PLAN_ORDER[index + 1] ?? null
}
