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
 * SOURCE OF TRUTH KEYWORDS: POST, stripeWebhook
 *
 * WHAT:  Stripe webhook endpoint — verifies the signature, then syncs the local
 *        Subscription row for subscription created/updated/deleted events.
 * WHY:   The webhook is the SINGLE writer of Subscription rows: the billing
 *        router only talks to Stripe, so the org's tier only changes once
 *        Stripe confirms via webhook. The plan key is resolved from the price
 *        id (authoritative), falling back to subscription metadata.
 * WHERE: Configure in the Stripe dashboard / `stripe listen --forward-to
 *        localhost:3000/api/stripe/webhook`. Uses config/stripe + stripe.service.
 */

import { NextResponse } from 'next/server'
import type Stripe from 'stripe'

import {
  getStripeClient,
  getStripeWebhookSecret,
  isStripeConfigured,
  getPlanByPriceId,
  PLAN_ORDER,
} from '@/lib/config'
import type { PlanKey } from '@/lib/config/plans'
import {
  upsertSubscription,
  deleteSubscriptionByStripeId,
  subscriptionPriceId,
} from '@/services/stripe.service'
import { markUserFingerprintsAsTrialUsed } from '@/services/card-fingerprint.service'
import { purchase as purchaseCredits } from '@/services/credits.service'
import { prisma } from '@/lib/config/prisma'
import { CREDIT_PACKS, type CreditPackKey } from '@/lib/types/credits'

/* Stripe signature verification needs the Node crypto runtime + raw body. */
export const runtime = 'nodejs'

/**
 * SOURCE OF TRUTH KEYWORDS: isUniqueViolation, P2002
 *
 * WHAT:  True when a Prisma write failed because the row already exists.
 * WHY:   Narrowed by CODE rather than by message text, which is localised and
 *        changes between Prisma versions. Typed through a structural check
 *        instead of importing `Prisma.PrismaClientKnownRequestError`, because
 *        the class is a value import that drags the client's runtime into
 *        this module's bundle for one string comparison.
 * WHERE: The event-dedupe insert below.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

function isPlanKey(value: string | undefined): value is PlanKey {
  return value !== undefined && (PLAN_ORDER as readonly string[]).includes(value)
}

/* Price id is authoritative for the plan; metadata.planKey is the fallback. */
function resolvePlanKey(subscription: Stripe.Subscription): PlanKey | null {
  const priceId = subscriptionPriceId(subscription)
  const fromPrice = priceId ? getPlanByPriceId(priceId) : null
  if (fromPrice) return fromPrice
  const fromMeta = subscription.metadata['planKey']
  return isPlanKey(fromMeta) ? fromMeta : null
}

async function resolveOrganizationId(subscription: Stripe.Subscription): Promise<string | null> {
  const fromMeta = subscription.metadata['organizationId']
  if (fromMeta) return fromMeta
  /* Fallback: an existing row already binds this subscription to an org.
   * `prisma` is now a top-level import — the dedupe insert at the start of
   * POST needs it before any handler runs, so the dynamic import this used to
   * do would have been a second, pointless module resolution. */
  const existing = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: subscription.id },
    select: { referenceId: true },
  })
  return existing?.referenceId ?? null
}

async function handleSubscriptionUpsert(subscription: Stripe.Subscription): Promise<void> {
  const organizationId = await resolveOrganizationId(subscription)
  const planKey = resolvePlanKey(subscription)
  if (!organizationId || !planKey) {
    console.warn(
      `[stripe-webhook] could not resolve org/plan for subscription ${subscription.id} ` +
        `(org=${organizationId}, plan=${planKey}) — skipping`
    )
    return
  }
  await upsertSubscription(subscription, organizationId, planKey)

  /* Trial confirmed by Stripe — burn the user's trial eligibility now (not at
   * create time, so a failed/incomplete subscription doesn't consume it). */
  if (subscription.status === 'trialing') {
    const userId = subscription.metadata['userId']
    if (userId) await markUserFingerprintsAsTrialUsed(userId)
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: handleCreditTopUp, CREDIT_TOP_UP_WEBHOOK
 *
 * WHAT:  Grants a credit pack's credits for a payment Stripe has confirmed.
 * WHY:   Ignores any payment intent that is not one of ours — the account may
 *        process payments this app knows nothing about, and the marker is the
 *        metadata `credits.purchase` wrote when it created the intent. A
 *        missing or unparseable amount is logged rather than guessed at:
 *        granting a number nobody set is worse than granting nothing, because
 *        the first is invisible and the second shows up as a support ticket
 *        we can answer.
 * WHERE: The `payment_intent.succeeded` branch above.
 */
async function handleCreditTopUp(intent: Stripe.PaymentIntent): Promise<void> {
  const organizationId = intent.metadata['organizationId']
  const packKey = intent.metadata['packKey']
  const credits = Number(intent.metadata['credits'])

  if (!organizationId || !packKey) {
    /* Not a credit purchase — a subscription invoice's intent, or a payment
     * made outside this app. Nothing to do and nothing to report. */
    return
  }

  if (!Number.isInteger(credits) || credits <= 0) {
    console.error(
      `[stripe-webhook] credit top-up ${intent.id} carries an unusable credit amount ` +
        `(${String(intent.metadata['credits'])}) — not granting`,
    )
    return
  }

  if (!isCreditPackKey(packKey)) {
    console.error(`[stripe-webhook] credit top-up ${intent.id} names unknown pack "${packKey}"`)
    return
  }

  const row = await purchaseCredits(prisma, {
    organizationId,
    amount: credits,
    paymentIntentId: intent.id,
    packKey,
  })

  if (row === null) {
    /* The router already granted these, which is the normal path. */
    console.info(`[stripe-webhook] credit top-up ${intent.id} was already granted`)
    return
  }

  console.info(
    `[stripe-webhook] granted ${credits} credits to ${organizationId} from ${intent.id}`,
  )
}

function isCreditPackKey(value: string): value is CreditPackKey {
  return Object.prototype.hasOwnProperty.call(CREDIT_PACKS, value)
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  const body = await request.text()
  const stripe = getStripeClient()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, getStripeWebhookSecret())
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  /**
   * SOURCE OF TRUTH KEYWORDS: STRIPE_EVENT_DEDUPE, REPLAY_SAFE, StripeEvent
   *
   * WHAT:  Refuses to process a Stripe event id that has already been handled.
   * WHY:   STRIPE_EVENT_DEDUPE. Stripe delivers AT LEAST ONCE and replays on
   *        its own schedule, so every handler below runs more than once in
   *        normal operation. Until Phase 05 that was survivable by luck:
   *        upserting by subscription id happens to be idempotent, and
   *        `markUserFingerprintsAsTrialUsed` — which genuinely re-runs — was
   *        harmless because re-marking a used trial as used changes nothing.
   *
   *        Credits remove the luck. A replayed top-up that grants a second
   *        time is a direct, unrecoverable loss, so this insert goes FIRST and
   *        a duplicate bails before any handler sees the event.
   *
   *        The INSERT IS THE CHECK. The primary key is the Stripe event id, so
   *        the database refuses the second write — rather than a read-then-
   *        write, where two concurrent deliveries of one event both read
   *        "not seen" and both proceed. P2002 is the unique-violation code and
   *        it is the SUCCESS case here: it means somebody else already has it.
   *
   *        It is recorded BEFORE the handlers run, not after. Recording after
   *        would mean a handler that half-succeeded and threw leaves no record,
   *        and the replay re-runs it — which is the behaviour this exists to
   *        stop. The trade is the opposite failure: an event that fails
   *        mid-handler is never retried, because it is already marked seen. We
   *        take that deliberately — the 500 below tells Stripe to retry, the
   *        retry is refused as a duplicate, and the event lands in the logs
   *        for a human. Money that was not granted is recoverable by hand;
   *        money granted twice is not.
   * WHERE: Here, before the switch.
   */
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } })
  } catch (err) {
    if (isUniqueViolation(err)) {
      console.info(`[stripe-webhook] ${event.id} (${event.type}) already processed — skipping`)
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error(`[stripe-webhook] could not record event ${event.id}:`, err)
    return NextResponse.json({ error: 'Could not record this event' }, { status: 500 })
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpsert(event.data.object)
        break
      case 'customer.subscription.deleted':
        await deleteSubscriptionByStripeId(event.data.object.id)
        break
      /**
       * SOURCE OF TRUTH KEYWORDS: CREDIT_TOP_UP_WEBHOOK, PAYMENT_BEFORE_CREDITS,
       *   REPLAY_SAFE_TOP_UP
       *
       * The second line of defence under a credit purchase. `credits.purchase`
       * charges the card and writes the ledger row in one request — but if
       * that request dies between the two (a deploy, a timeout, a dropped
       * connection), the customer has paid and has nothing. Stripe will tell
       * us about the payment regardless, and this is where we act on it.
       *
       * Safe to run after the router already granted, because
       * `creditsService.purchase` is keyed on the payment intent id and
       * refuses a second row for one it has seen (REPLAY_SAFE_TOP_UP). So the
       * normal case is this doing nothing, and the rare case is it rescuing a
       * purchase that would otherwise have been lost.
       *
       * It reads the credit amount from the intent's METADATA rather than
       * dividing the money by a price, because the pack's credit count is a
       * product fact set when the intent was created — deriving it from the
       * amount would silently change what a customer gets the first time
       * somebody edits the price in the Stripe dashboard.
       */
      case 'payment_intent.succeeded':
        await handleCreditTopUp(event.data.object)
        break
      case 'invoice.payment_failed':
        /* Stripe Smart Retries + the `past_due` status drive dunning; surface
         * it in logs. Hook a notification email here if desired. */
        console.warn(`[stripe-webhook] invoice.payment_failed: ${event.data.object.id}`)
        break
      case 'customer.subscription.trial_will_end':
        console.info(`[stripe-webhook] trial_will_end: ${event.data.object.id}`)
        break
      default:
        /* Unhandled event types are acknowledged so Stripe stops retrying. */
        break
    }
  } catch (err) {
    console.error(`[stripe-webhook] handler error for ${event.type}:`, err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
