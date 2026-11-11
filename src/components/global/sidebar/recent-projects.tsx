/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: SidebarRecentProjects, RECENT_IS_THE_LAST_THREE,
 *   projects.list, PERMISSION_GATED_READ, ROUTES, COLLAPSED_FALLBACK
 *
 * WHAT:  The sidebar's "Recent" group — the three most recently created
 *        projects, each linking to its script screen.
 *
 * WHY:   RECENT_IS_THE_LAST_THREE, per 00-dashboard-foundations.md section 2.
 *        Getting back into the thing you were last working on is the single
 *        most repeated action in this product, and it previously took two
 *        clicks through the projects table.
 *
 *        THE SCRIPT SCREEN, not the project row, is where a recent item
 *        lands: a project you were "recently" in is one you are still writing,
 *        and dropping someone on a detail page they then have to click
 *        through would make the shortcut no shorter than the table.
 *
 *        PERMISSION_GATED_READ: `projects.list` needs `projects:read`, so the
 *        query is not enabled without it and the whole group renders nothing
 *        — an empty "Recent" heading over a FORBIDDEN is worse than no
 *        heading. Same for a workspace with no projects yet: there is no
 *        empty state here, because a group that only appears once it has
 *        something to show never needs one.
 *
 *        NO SKELETON, deliberately. The layout prefetches the sidebar's
 *        queries and hydrates them, but NOT this one — it is below the fold
 *        of attention, and three grey bars appearing and then being replaced
 *        is more movement than three rows quietly arriving.
 *
 *        COLLAPSED_FALLBACK: titles are all this group has, so at icon width
 *        it hides rather than showing three identical glyphs.
 *
 * WHERE: Rendered by <AppSidebar /> under the main nav group.
 */

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { permissions } from "@/lib/permissions";
import { trpc } from "@/trpc/react-provider";

/** How many the spec's sidebar shows. */
const RECENT_PROJECT_COUNT = 3;

export function SidebarRecentProjects() {
  const pathname = usePathname();
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const canReadProjects = hasPermission(permissions.PROJECTS_READ);

  const { data } = trpc.projects.list.useQuery(
    /* `listProjects` already orders by `updatedAt desc`, so "recent" is just
       the first page — asked for at exactly the size shown, so this is the
       cheapest query that answers the question. */
    {
      organizationId: organizationId ?? "",
      page: 1,
      pageSize: RECENT_PROJECT_COUNT,
    },
    {
      enabled: organizationId !== undefined && canReadProjects,
      staleTime: 30 * 1000,
    },
  );

  const recent = data?.items ?? [];
  if (recent.length === 0) return null;

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Recent</SidebarGroupLabel>
      <SidebarMenu>
        {recent.map((project) => {
          const href = `/dashboard/projects/${project.id}/script` as Route;
          return (
            <SidebarMenuItem key={project.id}>
              <SidebarMenuButton
                render={<Link href={href} />}
                isActive={pathname.startsWith(
                  `/dashboard/projects/${project.id}`,
                )}
                tooltip={project.title}
                className="text-foreground-2"
              >
                {/* No icon: the spec's recent rows are title-only, and an icon
                    per row would make three different projects look like three
                    different features. */}
                <span className="truncate">{project.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
