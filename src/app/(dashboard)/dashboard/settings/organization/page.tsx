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
 * SOURCE OF TRUTH KEYWORDS: OrganizationSettingsPage
 *
 * WHAT:  /dashboard/settings/organization — profile (name + logo) and the
 *        danger zone (leave / delete).
 * WHY:   Provider-NEUTRAL by construction: every write goes through the
 *        TenancyAdapter, so there is one settings screen and no provider seam
 *        to maintain. It replaces the provider-hosted "manage organization"
 *        modal a hosted provider would put behind the switcher, which the app's
 *        navigation never pointed at.
 * WHERE: RESOURCES.organizationSettings.nav.href.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { OrganizationTab } from './_components/organization-tab'
import { OrganizationAdvanced } from '@/components/global/providers/server'

export const metadata: Metadata = {
  title: 'Organization',
}

export default function OrganizationSettingsPage() {
  return (
    <ContentLayout title="Organization">
      {/* Same 10-unit rhythm the sections inside OrganizationTab use, so the
          provider-only section reads as one more section rather than a bolt-on. */}
      <div className="space-y-10">
        <OrganizationTab />
        <OrganizationAdvanced />
      </div>
    </ContentLayout>
  )
}
