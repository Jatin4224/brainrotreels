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
 * SOURCE OF TRUTH KEYWORDS: PortalLayout
 *
 * WHAT:  Server layout for the platform-admin portal — the single gate for
 *        /portal. Requires a session, requires the portal be enabled,
 *        auto-provisions the owner org on first visit, and admits only platform
 *        admins; everyone else is bounced to the dashboard. Renders the portal
 *        sidebar shell.
 * WHY:   Portal is operator-only and spans all tenants, so its gate is separate
 *        from the tenant dashboard layout. Auto-provisioning here means the
 *        configured owner email becomes an admin on first access with no manual
 *        seeding.
 * WHERE: Wraps src/app/(portal)/portal/**. Uses portal.service + config/portal.
 */

import { redirect, notFound } from 'next/navigation'

import { HydrationBoundary, dehydrate } from '@tanstack/react-query'

import { getServerSession } from '@/lib/adapters/session'
import { getQueryClient, trpc } from '@/trpc/server'
import { AUTH_ROUTES, ROUTES, isPortalEnabled } from '@/lib/config'
import {
  ensurePortalOwnerOrganization,
  resolvePortalAdmin,
} from '@/services/portal.service'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { PortalSidebar } from '@/components/global/portal/portal-sidebar'
import { UserMenu } from '@/components/global/providers/server'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  if (!isPortalEnabled()) notFound()

  const session = await getServerSession()
  if (!session) redirect(AUTH_ROUTES.signIn)

  const user = { id: session.user.id, email: session.user.email, name: session.user.name }

  /* Bootstrap the owner on first access, then gate. */
  await ensurePortalOwnerOrganization(user)
  const isAdmin = await resolvePortalAdmin(user)
  if (!isAdmin) redirect(ROUTES.dashboard)

  /* Prefetch + hydrate the profile the portal sidebar's user menu reads. */
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery(trpc.user.getProfile.queryOptions())

  return (
    <SidebarProvider>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <PortalSidebar userMenu={<UserMenu />} />
        <SidebarInset>{children}</SidebarInset>
      </HydrationBoundary>
    </SidebarProvider>
  )
}
