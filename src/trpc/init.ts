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
 * SOURCE OF TRUTH KEYWORDS: createTRPCContext, Context, createStructuredError,
 *   createTRPCRouter, baseProcedure, authProcedure, protectedProcedure,
 *   ContextOrganization, PROVIDER_NEUTRAL_TENANCY
 *
 * WHAT:  tRPC request-context factory plus the sole sanctioned error-throw helper
 *        for procedures, and the re-export surface for the procedure factories.
 * WHY:   Wrapping context in React `cache()` gives every Server Component and
 *        procedure in a single request one shared auth lookup and Prisma pool
 *        slot; lazy auth resolution keeps static rendering legal.
 *        PROVIDER_NEUTRAL_TENANCY: identity and memberships are resolved through
 *        the AuthAdapter, never a provider SDK. The context therefore exposes
 *        `hasFullAccess` rather than a role string — Better Auth spells full
 *        access `owner` and another provider spells it something else, and
 *        translating that at the adapter boundary is what keeps every consumer
 *        provider-agnostic.
 *        NEVER compare `role` in app code; branch on `hasFullAccess`.
 * WHERE: Imported by src/trpc/server.tsx, src/trpc/routers/*, src/app/api/trpc/*,
 *        and src/trpc/procedures/protected.ts (for the `Context` type). Depends
 *        on src/lib/adapters (identity + tenancy) and src/lib/config (prisma).
 */

import { cache } from 'react'
import { headers } from 'next/headers'
import { TRPCError } from '@trpc/server'
import { prisma } from '@/lib/config'
import { getAuthAdapter, type AdapterSession, type AdapterUser } from '@/lib/adapters'
import type { StructuredErrorCause } from '@/lib/errors'

/**
 * SOURCE OF TRUTH KEYWORDS: createTRPCContext, Context
 *
 * WHAT:  Builds the per-request tRPC context (prisma, session, user, lazy org resolvers).
 * WHY:   `cache()` dedupes auth + membership lookups within a request so the Prisma
 *        pool isn't exhausted (P2024) under fanned-out Server Component prefetches;
 *        auth resolution is deferred because `cookies()` is illegal during static render.
 * WHERE: Consumed by src/trpc/server.tsx (`trpc` proxy) and src/app/api/trpc/[trpc]/route.ts.
 */
/* Wrapped in `cache()` so every Server Component / procedure in the same
 * request shares one context, one auth lookup, one membership query. Without
 * it the Prisma pool gets exhausted under load (P2024). */
/**
 * SOURCE OF TRUTH KEYWORDS: ContextOrganization, hasFullAccess
 *
 * WHAT:  One organization as the request context exposes it — identity, the
 *        member's role label, their flattened permissions, and the normalized
 *        full-access flag.
 * WHY:   `hasFullAccess` is the provider-neutral replacement for the old
 *        `role === 'owner'` comparison. `permissions` stays an empty array for
 *        full-access members as a deliberate sentinel: the permission gate
 *        short-circuits on the flag before ever reading the list, so there is no
 *        need to materialise every grant for an admin.
 * WHERE: Returned by ctx.getUserOrganizations / ctx.getActiveOrganization;
 *        consumed by protectedProcedure and the organization router.
 */
export interface ContextOrganization {
  id: string
  name: string
  slug: string
  logo: string | null
  role: string
  permissions: string[]
  hasFullAccess: boolean
  createdAt: Date
}

export const createTRPCContext = cache(async () => {
  /* Awaited up front so request-scoped headers (proxy.ts stamps) are
   * accessible from any lazy resolver below. */
  await headers()

  let user: AdapterUser | null = null
  let session: AdapterSession | null = null
  let authResolved = false

  /* Auth resolution is LAZY: every provider's session read touches `cookies()`,
   * which is illegal during static rendering. `baseProcedure` skips it; only
   * `authProcedure`/`protectedProcedure` trigger it. */
  const resolveAuth = cache(async () => {
    if (authResolved) return
    const adapter = await getAuthAdapter()
    const resolved = await adapter.identity.getSession()
    session = resolved
    user = resolved?.user ?? null
    authResolved = true
  })

  const getUserOrganizationsLazy = cache(async (): Promise<ContextOrganization[]> => {
    if (!user?.id) return []
    const adapter = await getAuthAdapter()
    const memberships = await adapter.tenancy.getMemberships(user.id)
    if (!memberships.length) return []

    return Promise.all(
      memberships.map(async (membership): Promise<ContextOrganization> => {
        const base = {
          id: membership.organization.id,
          name: membership.organization.name,
          slug: membership.organization.slug,
          logo: membership.organization.logo,
          role: membership.role,
          hasFullAccess: membership.hasFullAccess,
          createdAt: membership.createdAt,
        }

        /* Full-access members get the empty-array sentinel — the permission
         * gate never reads it, so resolving their grants would be wasted work. */
        if (membership.hasFullAccess) return { ...base, permissions: [] }

        const permissions = await adapter.tenancy.resolvePermissions(
          membership.organizationId,
          membership.role
        )
        return { ...base, permissions }
      })
    )
  })

  /* Active-org resolution: session's active org → first full-access membership
   * → first membership. Add custom-domain or query-param overrides above the
   * session branch when the app needs them. */
  const getActiveOrganizationLazy = cache(async (): Promise<ContextOrganization | null> => {
    const organizations = await getUserOrganizationsLazy()
    if (!organizations.length) return null

    const activeOrgId = session?.activeOrganizationId ?? null
    if (activeOrgId) {
      const match = organizations.find((org) => org.id === activeOrgId)
      if (match) return match
    }

    return organizations.find((org) => org.hasFullAccess) ?? organizations[0] ?? null
  })

  return {
    prisma,
    get session() { return session },
    get user() { return user },
    resolveAuth,
    getUserOrganizations: getUserOrganizationsLazy,
    getActiveOrganization: getActiveOrganizationLazy,
  }
})

export type Context = Awaited<ReturnType<typeof createTRPCContext>>

/**
 * SOURCE OF TRUTH KEYWORDS: createStructuredError
 *
 * WHAT:  Builds a `TRPCError` whose `cause` is a typed `StructuredErrorCause`.
 * WHY:   Clients read structured fields (errorCode, upgradeRequired, retryAfter, ...)
 *        off `error.data.cause`; raw `throw new TRPCError({...})` loses that shape.
 * WHERE: Used by src/trpc/procedures/protected.ts for every gate failure and by
 *        routers/services that need to surface domain errors to the client.
 */
export function createStructuredError(
  code:
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'PRECONDITION_FAILED'
    | 'BAD_REQUEST'
    | 'NOT_FOUND'
    | 'INTERNAL_SERVER_ERROR',
  message: string,
  cause: StructuredErrorCause
): TRPCError {
  return new TRPCError({ code, message, cause })
}

/**
 * SOURCE OF TRUTH KEYWORDS: createTRPCRouter, baseProcedure, authProcedure,
 *   protectedProcedure
 *
 * WHAT:  Re-exports the router builder and procedure factories from the procedures barrel.
 * WHY:   Routers import their entire toolkit from `@/trpc/init`, keeping the
 *        procedures module a private implementation detail.
 * WHERE: Imported by every file in src/trpc/routers/*.
 */
export { router as createTRPCRouter } from './procedures'
export { baseProcedure, authProcedure, protectedProcedure } from './procedures'
