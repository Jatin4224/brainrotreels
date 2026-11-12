/**
 * SOURCE OF TRUTH KEYWORDS: stripeCardElementOptions, STRIPE_CANNOT_READ_TOKENS,
 *   CardElement, PaymentCardForm, AddPaymentMethodDialog, TOKENS_NOT_HEX
 *
 * WHAT:  The `options` object for Stripe's <CardElement>, themed.
 *
 * WHY:   STRIPE_CANNOT_READ_TOKENS. Stripe Elements renders in a cross-origin
 *        iframe, so it cannot see our CSS variables or Tailwind classes — it
 *        accepts literal colour strings only. These are the app's one
 *        sanctioned exception to TOKENS_NOT_HEX, and this file is where the
 *        exception is written down rather than repeated.
 *
 *        It is shared because the two card forms had already drifted: both
 *        built this object by hand, one naming the colours as constants and
 *        the other inlining "#71717a" and "#dc2626" at the call site, and the
 *        font sizes differed (15px vs 16px) for no stated reason. The two
 *        forms are NOT merged — their submit paths genuinely differ, one
 *        handing the token upward and the other mutating, invalidating and
 *        offering "set as default" — but the thing they actually shared, the
 *        styling, now has one definition.
 *
 *        SIXTEEN_PX_STOPS_IOS_ZOOM decides the size: Safari zooms the page
 *        when a focused field is under 16px, and a card number is the worst
 *        possible place for that reflow. The 15px copy was the drift.
 *
 * WHERE: payment-card-form.tsx and add-payment-method-dialog.tsx.
 */

import type { StripeCardElementOptions } from "@stripe/stripe-js"

const CARD_TEXT_DARK = "#ffffff"
const CARD_TEXT_LIGHT = "#0f172a"
const CARD_PLACEHOLDER = "#71717a"
const CARD_INVALID = "#dc2626"

export function stripeCardElementOptions(
  isDark: boolean
): StripeCardElementOptions {
  return {
    style: {
      base: {
        fontSize: "16px",
        color: isDark ? CARD_TEXT_DARK : CARD_TEXT_LIGHT,
        "::placeholder": { color: CARD_PLACEHOLDER },
      },
      invalid: { color: CARD_INVALID },
    },
  }
}
