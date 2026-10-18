/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: PaymentMethodOption, PaymentMethodOptionProps,
 *   PaymentMethodSummary, PaymentMethodRow, UpgradeContent
 *
 * WHAT:  A saved card rendered as a CHOICE — click to pick it for this purchase.
 * WHY:   Deliberately not the same component as <PaymentMethodRow />, which is
 *        the management row: that one's whole surface is destructive and
 *        default-setting actions on a card you already own, and this one's whole
 *        surface is a single radio choice for one checkout. Folding both into
 *        one component would mean a card in the checkout list carrying a Delete
 *        button — a misclick that ends the purchase it appears in. They share
 *        the same PaymentMethodSummary shape, which is where the duplication
 *        would actually matter.
 *        Radio semantics (role + aria-checked) rather than a styled div, so the
 *        list is arrow-key navigable and announced as a choice.
 * WHERE: The payment step of <UpgradeContent />; available to any future
 *        checkout surface through the billing barrel.
 */

import { CheckIcon, CreditCardIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { PaymentMethodSummary } from '@/services/payment.service'
import { Badge } from '@/components/ui/badge'

export interface PaymentMethodOptionProps {
  method: PaymentMethodSummary
  selected: boolean
  onSelect: (paymentMethodId: string) => void
}

export function PaymentMethodOption({ method, selected, onSelect }: PaymentMethodOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(method.id)}
      className={cn(
        'group relative flex w-full items-center justify-between rounded-2xl border bg-card p-4 text-left transition-all duration-200',
        selected ? 'border-primary/60 shadow-lg' : 'border-border/50 hover:border-primary/30'
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl border bg-muted/50">
          <CreditCardIcon className="size-5 text-muted-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">
              {(method.brand ?? 'Card').toUpperCase()} •••• {method.last4 ?? '••••'}
            </p>
            {method.isDefault ? (
              <Badge variant="secondary" className="text-xs">
                Default
              </Badge>
            ) : null}
          </div>
          {method.expMonth && method.expYear ? (
            <p className="text-xs text-muted-foreground">
              Expires {method.expMonth}/{method.expYear}
            </p>
          ) : null}
        </div>
      </div>

      {selected ? (
        <div className="flex size-5 items-center justify-center rounded-full bg-primary">
          <CheckIcon className="size-3 text-primary-foreground" />
        </div>
      ) : null}
    </button>
  )
}
