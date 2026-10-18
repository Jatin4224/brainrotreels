import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * SOURCE OF TRUTH KEYWORDS: formatCurrency, PlanPrice, MINOR_UNITS,
 *   PricingCard, UpgradeModal
 *
 * WHAT:  Renders a provider amount in its MINOR unit (cents) as money — 4900 +
 *        'usd' → "$49".
 * WHY:   The billing provider states every amount in minor units, and how many
 *        of those make one unit is a property OF THE CURRENCY, not a constant:
 *        dividing by 100 turns ¥4900 into ¥49. Intl already knows the answer, so
 *        the divisor is read from the resolved format rather than hardcoded, and
 *        every pricing surface in the app formats through this one function.
 *        Trailing `.00` is dropped because a whole-number price reads better on
 *        a pricing card, while a 49.50 keeps its cents.
 * WHERE: <PricingCard /> and the billing-interval cards in
 *        src/components/global/upgrade-modal.
 */
export function formatCurrency(amountInMinorUnits: number, currency: string): string {
  const upper = currency.toUpperCase()
  /* An unknown/blank currency code makes Intl throw; falling back keeps a
   * misconfigured price from taking the whole pricing grid down. */
  let fractionDigits = 2
  try {
    fractionDigits =
      new Intl.NumberFormat('en-US', { style: 'currency', currency: upper })
        .resolvedOptions().minimumFractionDigits ?? 2
  } catch {
    return `${(amountInMinorUnits / 100).toFixed(2)} ${upper}`
  }

  const value = amountInMinorUnits / 10 ** fractionDigits
  const isWhole = Number.isInteger(value)

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: upper,
    minimumFractionDigits: isWhole ? 0 : fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}
