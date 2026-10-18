/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: betterAuthMembership, OWNER_ROLES,
 *   PROVIDER_NEUTRAL_MEMBERSHIP, acceptUrl, COPYABLE_INVITE_LINK
 *
 * WHAT:  Better Auth's roster operations — list, invite, cancel, change role,
 *        remove — against this app's own Member and Invitation tables.
 * WHY:   PROVIDER_NEUTRAL_MEMBERSHIP: lifted out of the member router verbatim so
 *        the router can serve BOTH providers with one code path and the Teams UI
 *        stays a single implementation.
 * WHERE: Wired into betterAuthAdapter.tenancy; called by src/trpc/routers/member.ts.
 */

import { nanoid } from 'nanoid'

import { prisma } from '@/lib/config/prisma'
import { processRole, roleDisplayName } from '@/services/role.service'
import { sendOrganizationInvitationEmail } from '@/services/email.service'
import { APP_URL } from '@/lib/config/branding'
import type { AdapterInvitationResult, AdapterMemberRow } from '../types'

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const invitationExpiry = (): Date => new Date(Date.now() + INVITATION_TTL_MS)

/* COPYABLE_INVITE_LINK: the app hosts its own accept page under Better Auth, so
 * the inviter gets a copyable link alongside the email. The ONE place this URL
 * is built — the email, the invite result, and the roster row all call it, so
 * the accept route lives in a single string. */
const acceptUrl = (invitationId: string): string =>
  `${APP_URL}/accept-invitation?id=${invitationId}`

/* Roles treated as the organization's owner. Kept in sync with the member
 * router's original constant. */
const OWNER_ROLES: readonly string[] = ['owner']

async function listMembers(organizationId: string): Promise<AdapterMemberRow[]> {
  const [members, invitations] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const accepted: AdapterMemberRow[] = members.map((m) => ({
    id: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    role: m.role,
    isPending: false,
    invitationId: null,
    invitationLink: null,
  }))

  const pending: AdapterMemberRow[] = invitations.map((inv) => ({
    id: inv.id,
    userId: null,
    /* No account exists yet, so the invited address is the only identity. */
    name: inv.email,
    email: inv.email,
    image: null,
    role: inv.role ?? 'member',
    isPending: true,
    invitationId: inv.id,
    /* COPYABLE_INVITE_LINK: the same URL the invitation email carries, built
     * from the one acceptUrl helper so the roster can never hand out a link
     * that differs from the emailed one. */
    invitationLink: acceptUrl(inv.id),
  }))

  return [...accepted, ...pending]
}

async function inviteMember(params: {
  organizationId: string
  email: string
  role: string
  inviterUserId: string
  inviterName: string
  organizationName: string
}): Promise<AdapterInvitationResult> {
  /* processRole decodes the member sheet's encoded role string and creates the
   * OrganizationRole row on demand — the same path the router used before. */
  const role = await processRole(prisma, params.organizationId, params.role)
  const invitation = await prisma.invitation.create({
    data: {
      id: nanoid(),
      organizationId: params.organizationId,
      email: params.email,
      role,
      inviterId: params.inviterUserId,
      expiresAt: invitationExpiry(),
    },
  })

  const invitationLink = acceptUrl(invitation.id)
  await sendOrganizationInvitationEmail({
    to: params.email,
    inviterName: params.inviterName,
    organizationName: params.organizationName,
    invitationLink,
    role,
  })

  return { invitationId: invitation.id, invitationLink }
}

/* Better Auth keeps the same invitation and simply refreshes its expiry, so an
 * already-circulated link stays valid. */
async function resendInvitation(params: {
  organizationId: string
  invitationId: string
  inviterUserId: string
  inviterName: string
  organizationName: string
}): Promise<AdapterInvitationResult> {
  const existing = await prisma.invitation.findFirst({
    where: { id: params.invitationId, organizationId: params.organizationId },
  })
  if (!existing) throw new Error('Invitation not found')

  const updated = await prisma.invitation.update({
    where: { id: existing.id },
    data: { expiresAt: invitationExpiry() },
  })

  const invitationLink = acceptUrl(updated.id)
  await sendOrganizationInvitationEmail({
    to: updated.email,
    inviterName: params.inviterName,
    organizationName: params.organizationName,
    invitationLink,
    role: updated.role ?? 'member',
  })

  return { invitationId: updated.id, invitationLink }
}

async function cancelInvitation(params: {
  organizationId: string
  invitationId: string
}): Promise<void> {
  await prisma.invitation.deleteMany({
    where: { id: params.invitationId, organizationId: params.organizationId },
  })
}

async function updateMemberRole(params: {
  organizationId: string
  memberId: string
  role: string
}): Promise<void> {
  const role = await processRole(prisma, params.organizationId, params.role)
  await prisma.member.updateMany({
    where: { id: params.memberId, organizationId: params.organizationId },
    data: { role },
  })
}

async function removeMember(params: {
  organizationId: string
  memberId: string
}): Promise<void> {
  await prisma.member.deleteMany({
    where: { id: params.memberId, organizationId: params.organizationId },
  })
}

/* The app owns the Organization row under this provider, so these are plain
 * writes; the schema cascades members, roles, usage and audit on delete. */
async function updateOrganization(params: {
  organizationId: string
  name: string
  logo?: string | null
}): Promise<void> {
  await prisma.organization.update({
    where: { id: params.organizationId },
    data: {
      name: params.name,
      ...(params.logo !== undefined ? { logo: params.logo === '' ? null : params.logo } : {}),
    },
  })
}

async function deleteOrganization(params: { organizationId: string }): Promise<void> {
  await prisma.organization.delete({ where: { id: params.organizationId } })
}

async function leaveOrganization(params: {
  organizationId: string
  userId: string
}): Promise<void> {
  await prisma.member.deleteMany({
    where: { organizationId: params.organizationId, userId: params.userId },
  })
}

export const betterAuthMembership = {
  listMembers,
  inviteMember,
  resendInvitation,
  cancelInvitation,
  updateMemberRole,
  removeMember,
  updateOrganization,
  deleteOrganization,
  leaveOrganization,
}

export { OWNER_ROLES, roleDisplayName }
