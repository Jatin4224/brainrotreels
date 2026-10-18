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
 * SOURCE OF TRUTH KEYWORDS: ac, roles, organizationStatement, buildOwnerRoleStatement
 *
 * WHAT:  Better Auth's access-control instance and its static `owner` role,
 *        derived from the RESOURCES registry.
 * WHY:   This is the ONLY part of the permission system that is provider-
 *        specific — it exists to satisfy Better Auth's organization plugin. The
 *        app's own permission vocabulary (constants, groups, statement
 *        conversions) is provider-neutral and lives in src/lib/permissions.
 *        Keeping the two apart is what lets another provider's adapter reuse
 *        every permission string without dragging Better Auth into its bundle.
 *        Note the app never asks Better Auth to authorize a request: procedures
 *        resolve permissions from the app-owned OrganizationRole table. These
 *        objects only keep the plugin's own endpoints coherent.
 * WHERE: Imported by src/lib/better-auth/auth.ts (server) and auth-client.ts
 *        (browser). Derived from src/lib/resources.ts.
 */

import { createAccessControl } from 'better-auth/plugins/access'
import {
  defaultStatements,
  ownerAc,
} from 'better-auth/plugins/organization/access'
import { getOrganizationStatement } from '@/lib/resources'

/* Better Auth's Statements constraint produces a union TS can't auto-collapse
 * to the target record shape when spreading defaultStatements (exact literal
 * tuples) with our derived statements (readonly string[]). Widening once here
 * is the documented escape hatch at the Better Auth boundary. */
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- documented Better Auth typing boundary
const organizationStatement = {
  ...defaultStatements,
  ...getOrganizationStatement(),
} as Record<string, readonly string[]>

/**
 * SOURCE OF TRUTH KEYWORDS: ac
 *
 * WHAT:  Better Auth AccessControl instance built from organizationStatement.
 * WHY:   Shared with both server (auth.ts) and client (auth-client.ts) so
 *        role checks are consistent on both sides of the wire.
 * WHERE: Imported by src/lib/better-auth/auth.ts and auth-client.ts.
 */
export const ac = createAccessControl(organizationStatement)

function buildOwnerRoleStatement(): Record<string, readonly string[]> {
  const ownerStatements: Record<string, readonly string[]> = {
    ...ownerAc.statements,
  }
  for (const [resource, actions] of Object.entries(getOrganizationStatement())) {
    ownerStatements[resource] = actions
  }
  return ownerStatements
}

/* The static owner role, auto-granted every action declared in RESOURCES.
 * Owners receive every verb you ever declare — never edit the owner grants
 * manually; add the verb to RESOURCES and it shows up here. */
const organizationOwner = ac.newRole(buildOwnerRoleStatement())

/**
 * SOURCE OF TRUTH KEYWORDS: roles
 *
 * WHAT:  Static role map passed to the organization plugin (currently just owner).
 * WHY:   Only `owner` is STATIC — every other member's permissions are stored
 *        as a JSON statement on OrganizationRole (dynamic per-org roles).
 * WHERE: Passed to organization() plugin in auth.ts and organizationClient() in
 *        auth-client.ts.
 */
export const roles = {
  owner: organizationOwner,
} as const
