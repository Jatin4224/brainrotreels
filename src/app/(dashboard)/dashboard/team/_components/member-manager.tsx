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
 * SOURCE OF TRUTH KEYWORDS: MemberManager
 *
 * WHAT:  Team page body — SettingsSection blocks (label + description on the
 *        left, content on the right), hosting the edit-member and manage-roles
 *        Sheets.
 * WHY:   Uses the SAME SettingsSection the organization and billing screens use,
 *        so Teams reads as part of settings instead of a bespoke grid that
 *        happened to look similar. One layout component means a spacing or
 *        breakpoint change lands everywhere at once.
 *        The member list opts into `contentWidth="full"`: it is a row-per-member
 *        table, and the default max-w-md column made it unreadable.
 * WHERE: Rendered by TeamClient.
 */

import * as React from 'react'
import { SearchIcon, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { SettingsSection } from '@/components/global/settings-section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet } from '@/components/ui/sheet'
import { MemberList } from './member-list'
import { OwnershipCard } from './ownership-card'
import { useProviderCapabilities } from '@/lib/adapters/capabilities.client'
import { MemberSheetContent } from './member-sheet-content'
import { ManageRoleSheetContent } from './manage-role-sheet-content'
import type { OrganizationMember } from './member-types'

export function MemberManager({ organizationId }: { organizationId: string }) {
  const capabilities = useProviderCapabilities()
  const { hasPermission } = useActiveOrganization()
  const utils = trpc.useUtils()
  const canManageRoles = hasPermission(permissions.MEMBER_UPDATE)

  const [searchQuery, setSearchQuery] = React.useState('')
  const [editingMember, setEditingMember] = React.useState<OrganizationMember | null>(null)
  const [isEditOpen, setIsEditOpen] = React.useState(false)
  const [isManageRolesOpen, setIsManageRolesOpen] = React.useState(false)

  const { data: members = [], isLoading } = trpc.member.list.useQuery({ organizationId })
  const removeMember = trpc.member.delete.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.member.list.invalidate({ organizationId }),
        /* The whole usage router, not one query: seat count feeds the gates,
         * the over-plan banner and anything added later. Naming them
         * individually means every new usage read has to remember to come
         * back here. */
        utils.usage.invalidate(),
      ])
      toast.success('Member removed')
    },
    onError: (e) => toast.error(e.message || 'Failed to remove member'),
  })

  /* OWNER_IS_NOT_ALWAYS_SPECIAL: the owner is pulled OUT of the member list and
   * shown in its own card — but only where a single transferable owner exists.
   * Under a provider with many equal admins that card is hidden, and filtering
   * the owner out anyway made them vanish from the page entirely:
   * absent from the list AND absent from the card. When there is no ownership
   * card, the owner is simply an admin and belongs in the list with everyone
   * else. */
  const showOwnershipCard = capabilities.ownershipTransfer
  const owner = showOwnershipCard ? members.find((m) => m.roleName === 'owner') : undefined
  const regularMembers = showOwnershipCard
    ? members.filter((m) => m.roleName !== 'owner')
    : members
  const filteredMembers = regularMembers.filter((m) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q)
  })

  function handleEditMember(member: OrganizationMember) {
    setEditingMember(member)
    setIsEditOpen(true)
  }
  function handleCloseEdit() {
    setIsEditOpen(false)
    setTimeout(() => setEditingMember(null), 300)
  }

  if (isLoading && members.length === 0) {
    return (
      /* Mirrors SettingsSection's own grid (280px label column + content), so
         the swap to real content is a fade rather than a reflow. */
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-8 md:grid-cols-[280px_1fr] lg:gap-12">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <Sheet open={isEditOpen} onOpenChange={setIsEditOpen}>
        <MemberSheetContent
          key={editingMember?.id ?? 'no-member'}
          organizationId={organizationId}
          editingMember={editingMember}
          onClose={handleCloseEdit}
        />
      </Sheet>

      <Sheet open={isManageRolesOpen} onOpenChange={setIsManageRolesOpen}>
        <ManageRoleSheetContent organizationId={organizationId} onClose={() => setIsManageRolesOpen(false)} />
      </Sheet>

      <div className="space-y-10">
        <SettingsSection
          title="Team Members"
          description="Manage team member access and permissions"
          label="Members"
          labelDescription="Invite teammates and control what each of them can do"
          /* A row-per-member list needs the page, not the form column. */
          contentWidth="full"
        >
          <div className="space-y-6">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 pl-9"
                />
              </div>
              {canManageRoles ? (
                <Button
                  variant="outline"
                  onClick={() => setIsManageRolesOpen(true)}
                  className="h-10 gap-2"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Manage Roles
                </Button>
              ) : null}
            </div>

            <MemberList
              organizationId={organizationId}
              members={filteredMembers}
              onEditMember={handleEditMember}
              onRemoveMember={(id) => removeMember.mutate({ organizationId, memberId: id })}
            />
          </div>
        </SettingsSection>

        {/* Only where a single transferable owner exists — see
            OWNER_IS_NOT_ALWAYS_SPECIAL above. */}
        {showOwnershipCard ? (
          <SettingsSection
            title="Ownership"
            description="Who ultimately controls this organization"
            label="Organization owner"
            labelDescription="Primary organization administrator"
          >
            <OwnershipCard owner={owner} />
          </SettingsSection>
        ) : null}
      </div>
    </>
  )
}
