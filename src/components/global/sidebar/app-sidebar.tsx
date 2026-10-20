/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AppSidebar, SECTION_LABELS, SidebarUpgradeNudge
 *
 * WHAT:  The dashboard sidebar. Renders a fixed Dashboard home link plus the
 *        registry-derived nav (getSidebarNav), grouped by section.
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
import { getNavIcon } from "./nav-icons";
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
      <SidebarHeader>{orgSwitcher}</SidebarHeader>

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
        {/* AMBIENT_NOT_INTERRUPTIVE — directly above the profile, where the eye
            already lands, and self-removing once there is nothing to sell. */}
        <SidebarUpgradeNudge />
        {userMenu}
      </SidebarFooter>
    </Sidebar>
  );
}
