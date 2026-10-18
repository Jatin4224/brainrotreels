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
 * SOURCE OF TRUTH KEYWORDS: BillingSettingsPage
 *
 * WHAT:  /dashboard/settings/billing — plan, payment methods, cancel/upgrade.
 * WHERE: RESOURCES.billing.nav.href. Server shell + provider-aware client.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { BillingScreen } from '@/components/global/providers/server'

export const metadata: Metadata = {
  title: 'Billing',
}

export default function BillingSettingsPage() {
  return (
    <ContentLayout title="Billing">
      <BillingScreen />
    </ContentLayout>
  )
}
