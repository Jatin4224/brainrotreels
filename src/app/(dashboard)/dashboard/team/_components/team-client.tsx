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
 * SOURCE OF TRUTH KEYWORDS: TeamClient
 *
 * WHAT:  Team page client shell — resolves the active org + permission and
 *        renders the provider's membership surface inside ContentLayout. Gated
 *        on member:read.
 * WHY:   Renders <MemberManagement /> rather than the app's MemberManager
 *        directly, so a provider that needs a different screen has somewhere to
 *        put it — today both resolve to the same components, because member.list
 *        is adapter-backed. The Invite button is always shown: invitation.create
 *        is adapter-backed too, so one button works under every provider.
 * WHERE: Rendered by the team page. Wrapper lives in
 *        src/components/global/providers.
 */

import type * as React from 'react'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { ContentLayout } from '@/components/global/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { InviteMemberButton } from './invite-member-button'

/* SERVER_PROVIDER_BRANCH: the membership surface arrives already rendered from
 * the server page, so this shell keeps the permission gate without pulling both
 * providers' UI into the browser bundle. */
export function TeamClient({ memberManagement }: { memberManagement: React.ReactNode }) {
  const { activeOrganization, isLoading, hasPermission } = useActiveOrganization()
  /* Shown under EVERY provider: invitation.create resolves through the
   * TenancyAdapter, so this one button issues the invite whichever provider
   * stores it. A hosted provider would bury inviting inside the switcher's
   * "manage organization" modal — three clicks away from the page that is
   * actually about people. */
  const inviteAction = <InviteMemberButton />
  const organizationId = activeOrganization?.id
  const hasAccess = hasPermission(permissions.MEMBER_READ)

  if (isLoading && !activeOrganization) {
    return (
      <ContentLayout title="Team" actions={inviteAction}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-4 md:col-span-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Skeleton className="h-16 w-full md:col-span-1" />
        </div>
      </ContentLayout>
    )
  }

  if (!organizationId) {
    return (
      <ContentLayout title="Team">
        <div className="flex items-center justify-center p-12">
          <p className="text-sm text-muted-foreground">No active organization found.</p>
        </div>
      </ContentLayout>
    )
  }

  if (!hasAccess) {
    return (
      <ContentLayout title="Team">
        <div className="flex h-full items-center justify-center p-6">
          <div className="max-w-md space-y-2 text-center">
            <p className="text-sm font-medium text-destructive">
              You don&apos;t have permission to view team members
            </p>
            <p className="text-xs text-muted-foreground">
              Contact your organization owner to grant you the{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">member:read</code> permission.
            </p>
          </div>
        </div>
      </ContentLayout>
    )
  }

  return (
    <ContentLayout title="Team" actions={inviteAction}>
      {memberManagement}
    </ContentLayout>
  )
}
