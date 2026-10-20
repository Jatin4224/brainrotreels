/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: BetterAuthMemberManagement
 *
 * WHAT:  The app's own member list, invite flow, and role assignment — the
 *        membership surface when Better Auth is the provider.
 * WHY:   Better Auth ships no member UI, so the app owns the whole screen. This
 *        module exists purely as the provider-side entry point behind the
 *        <MemberManagement /> wrapper, so the Teams page never branches on the
 *        provider itself.
 * WHERE: Loaded by src/components/global/providers/index.tsx when
 *        NEXT_PUBLIC_AUTH_PROVIDER is "better-auth".
 */

import { MemberManager } from "@/app/(dashboard)/dashboard/team/_components/member-manager";
import { useActiveOrganization } from "@/hooks/use-active-organization";
import { Skeleton } from "@/components/ui/skeleton";

/* Resolves the organization itself so the surface takes NO props — that is what
 * lets a server component render it and hand it down as children, keeping the
 * provider branch off the client. */
export function BetterAuthMemberManagement() {
  const { activeOrganization } = useActiveOrganization();
  if (!activeOrganization) return <Skeleton className="h-64 w-full" />;
  return <MemberManager organizationId={activeOrganization.id} />;
}
