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

import { usePathname } from "next/navigation";

import { trpc } from "@/trpc/react-provider";
import { isUnauthenticatedSurface } from "@/lib/config/public-routes";
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
 * SOURCE OF TRUTH KEYWORDS: useHasOrganizationContext, DONT_ASK_WHERE_THERE_IS
 *   _NO_ANSWER, isUnauthenticatedSurface, PUBLIC_MARKETING_SURFACE
 *
 * WHAT:  Whether asking "which organization is active?" makes sense on the page
 *        currently rendered.
 *
 * WHY:   DONT_ASK_WHERE_THERE_IS_NO_ANSWER. `getActiveOrganization` is an
 *        authProcedure, so on a sign-in form or a landing page the only possible
 *        answer is UNAUTHORIZED — and the question gets asked there anyway,
 *        because `<UpgradeModalProvider>` is mounted in the ROOT layout and
 *        calls this hook. The result was a guaranteed-failing request plus a
 *        red 401 in the console on every public page load, visible to any
 *        visitor who opens devtools, and it was the trigger for the landing
 *        page redirecting itself to sign-in.
 *
 *        The observer-side excuse (PUBLIC_MARKETING_SURFACE) stops the redirect;
 *        this stops the pointless REQUEST, which is the other half. Both read
 *        the same predicate, so "where is a signed-out visitor normal?" has one
 *        answer and the two halves cannot drift.
 *
 *        Decided HERE rather than by each caller passing `enabled`: this hook is
 *        the single place the question is asked, so every present and future
 *        consumer gets the behaviour without knowing about it. A disabled query
 *        reports `isLoading: false`, so a gate reading this hook renders its
 *        signed-out state instead of spinning forever.
 * WHERE: Both hooks below.
 */
function useHasOrganizationContext(): boolean {
  const pathname = usePathname();
  return !isUnauthenticatedSurface(pathname);
}

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
  const enabled = useHasOrganizationContext();
  const { data: activeOrganization, isLoading } =
    trpc.organization.getActiveOrganization.useQuery(undefined, {
      ...ACTIVE_ORG_QUERY_OPTIONS,
      enabled,
    });

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
  const enabled = useHasOrganizationContext();
  const { data } = trpc.organization.getActiveOrganization.useQuery(undefined, {
    ...ACTIVE_ORG_QUERY_OPTIONS,
    enabled,
    select: (org) => org?.id,
  });
  return data ?? undefined;
}
