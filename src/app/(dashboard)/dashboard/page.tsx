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
 * SOURCE OF TRUTH KEYWORDS: DashboardHomePage
 *
 * WHAT:  Dashboard landing page — the post-onboarding home inside the sidebar
 *        shell.
 * WHY:   Thin starting point; real dashboards drop their widgets into
 *        ContentLayout. Kept intentionally minimal — this is a template base.
 * WHERE: Route /dashboard under the (dashboard) layout.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { PlanSetupCard } from '@/components/global/plan-setup-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = {
  title: 'Dashboard',
}

export default function DashboardHomePage() {
  return (
    <ContentLayout title="Dashboard">
      {/* POST_SIGNUP_PLAN_STEP — the plan choice that used to be step two of
          onboarding. Renders nothing once dismissed or on a paid plan. */}
      <PlanSetupCard />
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <CardDescription>
            This is your dashboard. Add your product’s features here — declare them in
            src/lib/resources.ts and they appear in the sidebar automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Use the sidebar to manage your workspace, team and billing.
        </CardContent>
      </Card>
    </ContentLayout>
  )
}
