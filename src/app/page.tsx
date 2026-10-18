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
 * SOURCE OF TRUTH KEYWORDS: RootPage
 *
 * WHAT:  Root index — fires a single auth-required tRPC query, then sends the
 *        authenticated user on to the dashboard. Renders nothing meanwhile.
 * WHY:   The query is the auth probe: anonymous → server throws UNAUTHORIZED →
 *        the AuthRedirectObserver bounces to sign-in (auth-flow stays
 *        centralized, never a per-page `redirect`). On success the user is
 *        authenticated, so we push to ROUTES.dashboard — the dashboard layout
 *        then owns the no-org → onboarding redirect. This page never decides
 *        the auth target itself; it only forwards the happy path.
 * WHERE: Auth enforcement: authProcedure (src/trpc/procedures/protected.ts);
 *        redirect handler: AuthRedirectObserver (src/trpc/react-provider.tsx);
 *        landing route: ROUTES (src/lib/config/routes.ts).
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { trpc } from '@/trpc/react-provider'
import { ROUTES } from '@/lib/config'

export default function RootPage(): null {
  const router = useRouter()
  /* Anonymous → UNAUTHORIZED → observer → sign-in. Authenticated → resolves
   * (org or null) and we forward to the dashboard. */
  const { isSuccess } = trpc.organization.getActiveOrganization.useQuery()

  useEffect(() => {
    if (isSuccess) router.replace(ROUTES.dashboard)
  }, [isSuccess, router])

  return null
}
