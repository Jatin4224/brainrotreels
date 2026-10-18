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
 * SOURCE OF TRUTH KEYWORDS: OrganizationMember, OrganizationRoleRow
 *
 * WHAT:  Client types for the team UI, derived from the tRPC router output so
 *        they can't drift from the server contract.
 * WHY:   Router-derived shapes (same pattern as use-active-organization) — no
 *        hand-rolled mirror of the member/role payloads.
 * WHERE: Consumed by the team _components (member list, sheets, ownership card).
 */

import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/trpc/routers/_app'

export type OrganizationMember = inferRouterOutputs<AppRouter>['member']['list'][number]
export type OrganizationRoleRow = inferRouterOutputs<AppRouter>['organizationRoles']['list'][number]
