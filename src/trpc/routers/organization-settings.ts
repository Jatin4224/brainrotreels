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
 * SOURCE OF TRUTH KEYWORDS: organizationSettingsRouter
 *
 * WHAT:  Read + update org-wide settings (name, logo).
 * WHY:   protectedProcedure gives auth + organizationSettings:* permission
 *        gates + audit. The audit entity is overridden to 'organization' to
 *        match the registry's stated intent (RESOURCES.organizationSettings.
 *        audit.entity).
 * WHERE: Mounted as `organizationSettings` in src/trpc/routers/_app; consumed
 *        by the organization settings page.
 */

import { z } from 'zod'

import { createTRPCRouter } from '../init'
import { TRPCError } from '@trpc/server'
import { protectedProcedure } from '../procedures'
import { getAuthAdapter } from '@/lib/adapters'
import { permissions } from '@/lib/permissions'
import { updateOrganizationSettingsSchema } from '@/lib/types'

export const organizationSettingsRouter = createTRPCRouter({
  get: protectedProcedure({ requirePermission: permissions.ORGANIZATION_SETTINGS_READ })
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.organization.findUnique({
        where: { id: input.organizationId },
        select: { id: true, name: true, slug: true, logo: true },
      })
    }),

  update: protectedProcedure({
    requirePermission: permissions.ORGANIZATION_SETTINGS_UPDATE,
    audit: { entity: 'organization', action: 'update' },
  })
    .input(updateOrganizationSettingsSchema)
    .mutation(async ({ input }) => {
      /* PROVIDER_NEUTRAL: the organization record may be owned by the provider,
       * so the write goes through the adapter rather than straight to the local
       * mirror. */
      const adapter = await getAuthAdapter()
      await adapter.tenancy.updateOrganization({
        organizationId: input.organizationId,
        name: input.name,
        ...(input.logo !== undefined ? { logo: input.logo } : {}),
      })
      return { id: input.organizationId }
    }),

  /* Destructive, owner-only. The schema cascades members, roles, usage metrics
   * and audit rows, so this is the single call that retires a tenant. */
  delete: protectedProcedure({
    requireRole: ['owner'],
    requirePermission: permissions.ORGANIZATION_SETTINGS_UPDATE,
    audit: { entity: 'organization', action: 'delete' },
  })
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const adapter = await getAuthAdapter()
      await adapter.tenancy.deleteOrganization({ organizationId: input.organizationId })
      return { id: input.organizationId }
    }),

  /* Leave without deleting. Owners are blocked: an organization with no owner
   * would be unreachable, and there is no transfer under every provider. */
  leave: protectedProcedure({
    audit: { entity: 'organization', action: 'leave' },
  })
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.memberHasFullAccess) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Owners cannot leave their own organization. Delete it instead.',
        })
      }
      const adapter = await getAuthAdapter()
      await adapter.tenancy.leaveOrganization({
        organizationId: input.organizationId,
        userId: ctx.user.id,
      })
      return { id: input.organizationId }
    }),
})

