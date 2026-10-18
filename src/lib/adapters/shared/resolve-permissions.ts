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
 * SOURCE OF TRUTH KEYWORDS: resolveOrganizationRolePermissions,
 *   AC_META_RESOURCES, APP_OWNED_RBAC
 *
 * WHAT:  Loads one organization role from the app-owned OrganizationRole table
 *        and flattens its stored statement into `resource:action` strings.
 * WHY:   APP_OWNED_RBAC — fine-grained permissions belong to this app under
 *        EVERY provider, so every tenancy adapter calls this same function.
 *        No provider can host it: hosted providers cap custom roles per
 *        application instance rather than per tenant, which makes a per-tenant
 *        role builder impossible there, and Better Auth's static `roles` map
 *        only ever defines `owner`. Keeping one implementation means switching
 *        providers cannot change what a role grants — only who is a member.
 * WHERE: Called by every TenancyAdapter.resolvePermissions implementation.
 *        Parsing is delegated to parseRolePermissions in
 *        src/services/role.service.ts so there is one decoder for the column.
 */

import { prisma } from '@/lib/config/prisma'
import { parseRolePermissions } from '@/services/role.service'

/* Better Auth's access-control layer reserves these statement keys for its own
 * bookkeeping; they are not app features and must never surface as grantable
 * `resource:action` strings. Filtered here (rather than at each call site) so
 * every provider gets the identical permission set for a given stored role. */
const AC_META_RESOURCES: readonly string[] = ['organization', 'ac']

/**
 * SOURCE OF TRUTH KEYWORDS: resolveOrganizationRolePermissions
 *
 * WHAT:  The permission strings a (organization, role) pair grants.
 * WHY:   Returns an empty list for an unknown role — a missing role row must
 *        grant NOTHING rather than fall back to a default, so a deleted or
 *        mistyped role fails closed.
 * WHERE: TenancyAdapter.resolvePermissions in both provider bundles.
 */
export async function resolveOrganizationRolePermissions(
  organizationId: string,
  role: string
): Promise<string[]> {
  const row = await prisma.organizationRole.findFirst({
    where: { organizationId, role },
    select: { permission: true },
  })
  if (!row) return []

  return parseRolePermissions(row.permission).filter((permission) => {
    const [resource] = permission.split(':')
    return resource !== undefined && !AC_META_RESOURCES.includes(resource)
  })
}
