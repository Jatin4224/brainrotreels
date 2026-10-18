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
 * SOURCE OF TRUTH KEYWORDS: PortalHomePage
 *
 * WHAT:  /portal home — platform overview stats.
 * WHERE: Gated by the (portal) layout.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { PortalOverview } from './_components/portal-overview'

export const metadata: Metadata = {
  title: 'Platform',
}

export default function PortalHomePage() {
  return (
    <ContentLayout title="Platform overview">
      <PortalOverview />
    </ContentLayout>
  )
}
