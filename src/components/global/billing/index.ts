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
 * SOURCE OF TRUTH KEYWORDS: StripeElementsProvider, PaymentCardForm,
 *   PlanSelector, BillingIntervalToggle, PaymentMethodRow,
 *   AddPaymentMethodDialog, PaymentMethodOption
 *
 * WHAT:  Barrel for the reusable Stripe/billing UI primitives.
 * WHY:   One import surface for the onboarding payment step and the billing
 *        settings tab.
 * WHERE: Imported by onboarding + settings/billing UI.
 */

export { StripeElementsProvider } from './stripe-elements-provider'
export { PaymentCardForm } from './payment-card-form'
export { PlanSelector, BillingIntervalToggle } from './plan-selector'
export { PaymentMethodRow } from './payment-method-row'
export { PaymentMethodOption } from './payment-method-option'
export { AddPaymentMethodDialog } from './add-payment-method-dialog'
