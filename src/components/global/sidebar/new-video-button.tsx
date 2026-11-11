/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: SidebarNewVideoButton, NEW_VIDEO_IS_THE_ONE_ACTION,
 *   FeatureGate, PROJECTS_CREATE, COLLAPSED_FALLBACK, ROUTES
 *
 * WHAT:  The yellow "New video" button at the top of the sidebar — the
 *        product's single most-used action, above the nav rather than inside
 *        it.
 *
 * WHY:   NEW_VIDEO_IS_THE_ONE_ACTION. Creating a video is what this app is
 *        for, and it was previously reachable only by navigating to
 *        /dashboard/projects and finding the header button. Promoting it to
 *        the sidebar makes it one click from every screen, which is what the
 *        design does and what the usage pattern deserves.
 *
 *        IT NAVIGATES, it does not open a sheet. A create sheet launched from
 *        the sidebar would appear over whatever the customer was doing —
 *        mid-edit in the timeline, halfway through a billing form — and its
 *        success then has to navigate anyway. Sending them to the home
 *        picker instead means the format choice happens on a screen built
 *        for it, and nothing they were working on is covered up.
 *
 *        It is a LINK for the same reason: a destination that can be opened
 *        in a new tab, middle-clicked and prefetched, rather than a button
 *        that only works on a left click.
 *
 *        Hidden outright without `projects:create` — a disabled button that
 *        never becomes enabled is worse than no button, the same rule
 *        <CreateProjectButton> follows. No <FeatureGate> here, deliberately:
 *        the gate's job is to intercept the click at the plan cap and offer
 *        the upgrade, and that interception belongs on the CTA that actually
 *        opens the form (on the home screen), not on a link to the page
 *        holding it. Gating here would show the upgrade modal to somebody who
 *        was only trying to look at the picker.
 *
 *        COLLAPSED_FALLBACK: at icon width the label goes and the plus
 *        remains, with the name in the tooltip — the same collapse every
 *        other sidebar row makes.
 *
 * WHERE: Rendered by <AppSidebar /> in SidebarHeader, under the wordmark.
 */

import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { useActiveOrganization } from "@/hooks/use-active-organization";
import { permissions } from "@/lib/permissions";
import { ROUTES } from "@/lib/config";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function SidebarNewVideoButton() {
  const { hasPermission } = useActiveOrganization();
  if (!hasPermission(permissions.PROJECTS_CREATE)) return null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          render={<Link href={ROUTES.dashboard} />}
          tooltip="New video"
          /* The one loud control in the sidebar. Yellow rather than the brand
             orange: the orange is the page's primary action (the featured
             CTA, Upgrade), and two different oranges competing down the left
             edge is how a sidebar stops having a focal point. Dark text on
             yellow also clears contrast comfortably, which white on orange at
             this size does not — see CONTRAST_DEBT in globals.css. */
          className="h-11 justify-center gap-2 bg-brand-accent font-bold text-brand-accent-foreground hover:bg-brand-accent/90 hover:text-brand-accent-foreground active:bg-brand-accent active:text-brand-accent-foreground group-data-[collapsible=icon]:justify-center"
        >
          <PlusIcon strokeWidth={2.6} />
          <span>New video</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
