/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AppSidebar, SECTION_LABELS, SidebarUpgradeNudge,
 *   SidebarSearch, SidebarRecentProjects, SidebarPlanMeter, SIDEBAR_BLOCK_ORDER,
 *   WORDMARK_THEN_SWITCHER
 *
 * WHAT:  The dashboard sidebar. Wordmark, the search row, a fixed Dashboard
 *        home link plus the registry-derived nav (getSidebarNav) grouped by
 *        section, the three most recent projects, then the plan meter, the
 *        upgrade nudge and the account row.
 *
 *        SIDEBAR_BLOCK_ORDER follows 00-dashboard-foundations.md section 2 top
 *        to bottom. The order is the argument: the things you do many times a
 *        day are at the top under your thumb, the things you do once a month
 *        (plan, billing, account) are pinned to the bottom, and "Recent" sits
 *        between them because it is navigation that happens to be data.
 *
 *        WORDMARK_THEN_SWITCHER: the spec draws a plain wordmark where this
 *        app has an organization switcher, and both are right. A workspace is
 *        the product's name to somebody who only has one, so the wordmark is
 *        always shown and the switcher appears UNDER it only once there is a
 *        second organization to switch to. Dropping the switcher to match the
 *        drawing would have made every multi-workspace account unable to
 *        change workspace; showing it to a solo creator is a control that can
 *        only ever confirm what it already says.
 * WHY:   Items come straight from RESOURCES — permission gating reuses
 *        useActiveOrganization().hasPermission (owners always pass) and
 *        flag-gated items are hidden when the plan doesn't include them
 *        (usage.getFeatureGates). One registry edit adds/removes a sidebar
 *        item; there is no separate nav list to keep in sync.
 * WHERE: Mounted by src/app/(dashboard)/layout.tsx inside <SidebarProvider>.
 *        Reads getSidebarNav (src/lib/resources.ts), gate data
 *        (trpc.usage.getFeatureGates), and active-org permissions.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { getSidebarNav, type SidebarNavItem } from "@/lib/resources";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { trpc } from "@/trpc/react-provider";
import { ROUTES } from "@/lib/config";
import { APP_NAME } from "@/lib/config/branding";
import { getNavIcon } from "./nav-icons";
import { SidebarPlanMeter } from "./plan-meter";
import { SidebarRecentProjects } from "./recent-projects";
import { SidebarSearch } from "./sidebar-search";
import { SidebarUpgradeNudge } from "./upgrade-nudge";

/* Human labels for the known section keys. */
const SECTION_LABELS: Record<string, string> = {
  main: "General",
  settings: "Settings",
};

const NAV_SECTIONS = getSidebarNav();

/**
 * SOURCE OF TRUTH KEYWORDS: AppSidebarProps, SERVER_PROVIDER_BRANCH
 *
 * WHAT:  The sidebar's two provider-owned slots, supplied by a SERVER parent.
 * WHY:   SERVER_PROVIDER_BRANCH — this component is a client component, so
 *        importing the provider surfaces here would pull BOTH providers into the
 *        browser bundle. Taking them as already-rendered elements keeps the
 *        branch on the server; only the selected provider is ever serialised.
 * WHERE: Supplied by src/app/(dashboard)/layout.tsx.
 */
export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  orgSwitcher: React.ReactNode;
  userMenu: React.ReactNode;
}

export function AppSidebar({
  orgSwitcher,
  userMenu,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname();
  const { hasPermission, isLoading } = useActiveOrganization();
  const organizationId = useActiveOrganizationId();

  /* WORDMARK_THEN_SWITCHER — the switcher is only a control when there is
   * something to switch to. Already prefetched and hydrated by the dashboard
   * layout, so this resolves on the first paint rather than popping in. */
  const { data: organizations } =
    trpc.organization.getUserOrganizations.useQuery(undefined, {
      staleTime: 5 * 60 * 1000,
    });
  const hasMultipleOrganizations = (organizations?.length ?? 0) > 1;

  /* One read of the full gate map; used to hide flag-locked items. */
  const { data: gateData } = trpc.usage.getFeatureGates.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: organizationId !== undefined, staleTime: 5 * 60 * 1000 },
  );

  const isActive = (href: string): boolean =>
    pathname === href || pathname.startsWith(`${href}/`);

  const isVisible = (item: SidebarNavItem): boolean => {
    if (!hasPermission(item.requirePermission)) return false;
    if (item.requireFlag) {
      const gate = gateData?.gates[item.key];
      /* Hide until the gate resolves, and when the plan locks the feature. */
      if (!gate || gate.atLimit) return false;
    }
    return true;
  };

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        {/* The wordmark, 15/700 per the spec. A link, because a logo in the
            top-left that does not go home is the one piece of chrome everyone
            tries to click. Hidden at icon width, where the switcher below (or
            the rail itself) is the only thing that fits. */}
        <Link
          href={ROUTES.dashboard}
          className="flex h-10 items-center px-2 text-[0.9375rem] font-bold tracking-tight text-sidebar-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 group-data-[collapsible=icon]:hidden"
        >
          {APP_NAME}
        </Link>
        {hasMultipleOrganizations ? orgSwitcher : null}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{SECTION_LABELS["main"]}</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={ROUTES.dashboard} />}
                isActive={pathname === ROUTES.dashboard}
                tooltip="Dashboard"
              >
                <LayoutDashboard />
                <span>Dashboard</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Second row, directly under home, exactly where the spec puts
                it — and where ⌘K is reachable before the eye has to scan. */}
            <SidebarSearch isVisible={isVisible} />

            {!isLoading &&
              (NAV_SECTIONS.find((s) => s.section === "main")?.items ?? [])
                .filter(isVisible)
                .map((item) => {
                  const Icon = getNavIcon(item.icon);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={isActive(item.href)}
                        tooltip={item.label}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
          </SidebarMenu>
        </SidebarGroup>

        {/* Between the nav and the settings sections: navigation that happens
            to be data. Renders nothing until there is a project to list. */}
        <SidebarRecentProjects />

        {NAV_SECTIONS.filter((s) => s.section !== "main").map((section) => {
          const visibleItems = isLoading ? [] : section.items.filter(isVisible);
          if (visibleItems.length === 0) return null;
          return (
            <SidebarGroup key={section.section}>
              <SidebarGroupLabel>
                {SECTION_LABELS[section.section] ?? section.section}
              </SidebarGroupLabel>
              <SidebarMenu>
                {visibleItems.map((item) => {
                  const Icon = getNavIcon(item.icon);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={isActive(item.href)}
                        tooltip={item.label}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        {/* What the workspace is on, and what it can still spend. Above the
            nudge because the nudge is the ANSWER to it — seeing the number
            first is what makes "Upgrade" mean anything. */}
        <SidebarPlanMeter />
        {/* AMBIENT_NOT_INTERRUPTIVE — directly above the profile, where the eye
            already lands, and self-removing once there is nothing to sell. */}
        <SidebarUpgradeNudge />
        {userMenu}
      </SidebarFooter>
    </Sidebar>
  );
}
