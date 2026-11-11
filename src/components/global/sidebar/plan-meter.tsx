/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: SidebarPlanMeter, PLAN_METER, CREDITS_ARE_THE_METER,
 *   useFeatureGates, credits.getBalance, COLLAPSED_FALLBACK, PERMISSION_GATED_READ
 *
 * WHAT:  The sidebar's plan row — the plan's name against the workspace's
 *        credit balance, over a thin progress bar.
 *
 * WHY:   CREDITS_ARE_THE_METER, per 00-dashboard-foundations.md section 2. The
 *        app already has <UsageMeter>, but that is RESOURCE_AGNOSTIC and
 *        answers "how much of this limit have you used" for one registry
 *        resource. The sidebar is asking a different question — "what can this
 *        workspace still afford" — whose answer is a spend-down balance with
 *        no single resource behind it. Reusing the meter would have meant
 *        inventing a fake `credits` limit resource, so this is its own row and
 *        stays four lines of markup.
 *
 *        PERMISSION_GATED_READ: `credits.getBalance` needs `credits:read`, so
 *        a member without it would fire a query that can only come back
 *        FORBIDDEN. The permission is checked BEFORE the query is enabled, and
 *        the row degrades to the plan name alone rather than disappearing — a
 *        member still benefits from knowing which plan they are working on.
 *
 *        THE BAR HAS NO CEILING TO SHOW, which is the one thing worth saying
 *        out loud. Credits are bought in packs and spent, so there is no
 *        "total" to divide by; the fill is drawn against the largest balance
 *        the workspace has held this session, clamped to a floor, purely so
 *        the bar has a sensible shape. It is DECORATION and is marked
 *        `aria-hidden` — the number beside it is the fact. A bar that looked
 *        authoritative while measuring nothing would be worse than no bar.
 *
 *        COLLAPSED_FALLBACK: at icon width the row has nowhere to go, so it
 *        hides entirely, matching how <SidebarUpgradeNudge /> collapses. The
 *        balance is still one click away in the user menu.
 *
 * WHERE: Rendered by <AppSidebar /> in SidebarFooter, above the upgrade nudge.
 */

import * as React from "react";

import { trpc } from "@/trpc/react-provider";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { permissions } from "@/lib/permissions";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

/* The denominator floor. A workspace holding 40 credits should not see a bar
 * pinned at 100%; measuring against at least this makes a small balance LOOK
 * small, which is the only honest thing a ceiling-less bar can do. */
const METER_BASELINE_CREDITS = 500;

export function SidebarPlanMeter() {
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const canReadCredits = hasPermission(permissions.CREDITS_READ);

  const { data: gates } = trpc.usage.getFeatureGates.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: organizationId !== undefined, staleTime: 5 * 60 * 1000 },
  );

  const { data: credits } = trpc.credits.getBalance.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled: organizationId !== undefined && canReadCredits,
      staleTime: 60 * 1000,
    },
  );

  /* The high-water mark for this mount only. Spending credits should shorten
   * the bar; it must not also silently rescale the axis under it, which is
   * what measuring against the CURRENT balance would do — the fill would then
   * sit at 100% forever. Adjusted DURING render rather than in an effect
   * (React's documented "adjusting state when props change" pattern): React
   * re-runs this component immediately with the new value and never commits
   * the stale frame, so the bar cannot paint once at the wrong length and
   * then jump. Not a ref — reading a ref during render is exactly the bug
   * that pattern exists to avoid. */
  const [ceiling, setCeiling] = React.useState(METER_BASELINE_CREDITS);
  const balance = credits?.balance ?? null;
  if (balance !== null && balance > ceiling) setCeiling(balance);

  if (!gates) {
    return (
      <div className="group-data-[collapsible=icon]:hidden">
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  const filled =
    balance === null
      ? 0
      : Math.min(100, Math.round((balance / ceiling) * 100));

  return (
    <div className="flex flex-col gap-2 px-2 py-1 group-data-[collapsible=icon]:hidden">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-sidebar-foreground">
          {gates.planName}
        </span>
        {balance !== null ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {/* Grouped, because a raw 12400 beside a plan name reads as an id. */}
            {balance.toLocaleString()} credits
          </span>
        ) : null}
      </div>

      {balance !== null ? (
        <Progress
          value={filled}
          decorative
          size="sm"
          trackClassName="bg-secondary"
          indicatorClassName="bg-foreground-2"
        />
      ) : null}
    </div>
  );
}
