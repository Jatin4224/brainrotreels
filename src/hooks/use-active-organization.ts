/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: useActiveOrganization, useActiveOrganizationId,
 *   ActiveOrganization, ActiveOrganizationData
 *
 * WHAT:  Client hooks exposing the user's active organization and a derived
 *        permission check.
 * WHY:   Full-access members pass every permission check — empty `permissions`
 *        is the sentinel meaning "all access" so role bootstrapping stays
 *        simple. The flag is read from the server-resolved `hasFullAccess`
 *        field, NEVER from a role string: Better Auth spells full access
 *        `owner` and another provider would spell it something else entirely, so
 *        comparing the literal here would silently deny admins after a swap.
 * WHERE: Driven by trpc.organization.getActiveOrganization; consumed across
 *        the dashboard UI and by src/components/feature-gate.tsx.
 */

"use client";

import { trpc } from "@/trpc/react-provider";
import type { Permission } from "@/lib/permissions";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/trpc/routers/_app";

/**
 * SOURCE OF TRUTH KEYWORDS: ActiveOrganization
 *
 * WHAT:  Inferred output of organization.getActiveOrganization with null stripped.
 * WHY:   Sourced from the router output so the hook stays in lockstep with the
 *        server contract without a hand-rolled mirror type.
 * WHERE: Returned inside ActiveOrganizationData by useActiveOrganization.
 */
export type ActiveOrganization = NonNullable<
  inferRouterOutputs<AppRouter>["organization"]["getActiveOrganization"]
>;

export interface ActiveOrganizationData {
  activeOrganization: ActiveOrganization | null | undefined;
  isOwner: boolean;
  isLoading: boolean;
  hasPermission: (permission: Permission) => boolean;
}

const ACTIVE_ORG_QUERY_OPTIONS = {
  gcTime: 1000 * 60 * 30,
  refetchOnWindowFocus: true,
} as const;

/**
 * SOURCE OF TRUTH KEYWORDS: useActiveOrganization
 *
 * WHAT:  Returns the active organization plus a hasPermission check and
 *        loading/owner flags.
 * WHY:   Centralizes the "owner bypasses permission strings" rule so feature
 *        gates and UI affordances agree on access.
 * WHERE: Used across dashboard pages and src/components/feature-gate.tsx.
 */
export function useActiveOrganization(): ActiveOrganizationData {
  const { data: activeOrganization, isLoading } =
    trpc.organization.getActiveOrganization.useQuery(
      undefined,
      ACTIVE_ORG_QUERY_OPTIONS,
    );

  /* Provider-neutral: normalized by the tenancy adapter, not a role literal. */
  const isOwner = activeOrganization?.hasFullAccess ?? false;

  // Full-access members pass every check — the procedure layer treats their
  // empty permissions array as a sentinel meaning "all access".
  const hasPermission = (permission: Permission): boolean => {
    if (!activeOrganization) return false;
    if (isOwner) return true;
    return activeOrganization.permissions.includes(permission);
  };

  return { activeOrganization, isOwner, isLoading, hasPermission };
}

/**
 * SOURCE OF TRUTH KEYWORDS: useActiveOrganizationId
 *
 * WHAT:  Slim selector returning just the active organization id.
 * WHY:   Lets components subscribe to the id without re-rendering when the
 *        rest of the organization payload changes.
 * WHERE: Used by feature-gate UI and any component that only needs the id.
 */
export function useActiveOrganizationId(): string | undefined {
  const { data } = trpc.organization.getActiveOrganization.useQuery(undefined, {
    ...ACTIVE_ORG_QUERY_OPTIONS,
    select: (org) => org?.id,
  });
  return data ?? undefined;
}
