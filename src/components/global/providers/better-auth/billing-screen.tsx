/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: BetterAuthBillingScreen
 *
 * WHAT:  The app's own billing settings screen — plan summary, Stripe payment
 *        methods, cancel/reactivate, and the change-plan dialog.
 * WHY:   Provider-side entry point behind the <BillingScreen /> wrapper so the
 *        billing page never branches on the provider, and so the Stripe Elements
 *        bundle is only reachable under the provider that uses it.
 * WHERE: Selected by src/components/global/providers/index.tsx when
 *        NEXT_PUBLIC_AUTH_PROVIDER is "better-auth".
 */

import { BillingTab } from "@/app/(dashboard)/dashboard/settings/billing/_components/billing-tab";

export function BetterAuthBillingScreen() {
  /* BillingTab resolves the active organization itself, so this surface takes
   * no props and can be rendered by a server parent. */
  return <BillingTab />;
}
