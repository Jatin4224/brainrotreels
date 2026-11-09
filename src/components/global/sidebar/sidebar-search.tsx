/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: SidebarSearch, COMMAND_PALETTE, SEARCH_IS_REAL,
 *   CommandDialog, getSidebarNav, projects.list, PERMISSION_GATED_READ,
 *   SEARCH_SHORTCUT
 *
 * WHAT:  The sidebar's search row and the ⌘K palette behind it — jump to any
 *        nav destination the viewer may open, or to any of their projects by
 *        title.
 *
 * WHY:   SEARCH_IS_REAL. 00-dashboard-foundations.md section 2 draws a search
 *        row with a ⌘K hint, and a row that advertises a shortcut and then
 *        does nothing is worse than no row — it teaches people the keyboard
 *        hint is a lie. It is built from `@/components/ui/command`, which was
 *        already vendored into this repo and had no consumer, over two
 *        queries the sidebar is ALREADY making, so the whole feature is a
 *        composition rather than new machinery.
 *
 *        IT SEARCHES WHAT EXISTS, not what the recording's placeholder named
 *        ("formats, tools, creations" belong to screens 01-03, which are not
 *        in this app yet). Destinations come from the same `getSidebarNav`
 *        registry the nav renders, filtered by the SAME permission and plan
 *        gates — so the palette can never offer a page that would redirect
 *        straight back out (ROUTE_AUTHORIZATION in the dashboard layout).
 *        Projects come from `projects.list` with the typed query pushed to
 *        the SERVER rather than filtered in the browser: a workspace with
 *        four hundred projects cannot ship them all to the client so cmdk can
 *        grep three of them.
 *
 *        PERMISSION_GATED_READ: without `projects:read` the project query is
 *        never enabled and the palette is nav-only, rather than firing a
 *        query that can only return FORBIDDEN.
 *
 *        SEARCH_SHORTCUT is ⌘K / Ctrl-K, bound on `keydown` with
 *        `preventDefault` so the browser's own find bar does not also open.
 *        The listener is removed on unmount — a palette that keeps answering
 *        the shortcut after its sidebar is gone is the classic version of
 *        this bug.
 *
 * WHERE: Rendered by <AppSidebar /> in the primary nav group.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { SearchIcon } from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { getSidebarNav, type SidebarNavItem } from "@/lib/resources";
import { permissions } from "@/lib/permissions";
import { trpc } from "@/trpc/react-provider";

/** How many project hits the palette lists before it stops. */
const SEARCH_PROJECT_LIMIT = 6;

const NAV_ITEMS: readonly SidebarNavItem[] = getSidebarNav().flatMap(
  (section) => section.items,
);

export interface SidebarSearchProps {
  /**
   * Tells the palette which nav items the viewer may actually open. Supplied
   * by <AppSidebar />, which already computes it for the nav itself — passing
   * it keeps ONE definition of "visible", so the palette and the nav cannot
   * start disagreeing about what exists.
   */
  isVisible: (item: SidebarNavItem) => boolean;
}

export function SidebarSearch({ isVisible }: SidebarSearchProps) {
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const canReadProjects = hasPermission(permissions.PROJECTS_READ);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setOpen((current) => !current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* SERVER_SIDE_SEARCH — the typed text is the query's input, not a filter
   * applied after the fact. `enabled` waits for the dialog AND a non-empty
   * term so opening the palette does not fire a list of everything. */
  const trimmed = query.trim();
  const { data } = trpc.projects.list.useQuery(
    {
      organizationId: organizationId ?? "",
      page: 1,
      pageSize: SEARCH_PROJECT_LIMIT,
      search: trimmed,
    },
    {
      enabled:
        open &&
        trimmed.length > 0 &&
        organizationId !== undefined &&
        canReadProjects,
      staleTime: 30 * 1000,
    },
  );

  const destinations = NAV_ITEMS.filter(isVisible);
  const projects = trimmed.length > 0 ? (data?.items ?? []) : [];

  function go(href: Route) {
    setOpen(false);
    setQuery("");
    /* The mobile sidebar is an overlay sheet: leaving it open would put the
       navigated-to page behind a scrim the user then has to dismiss. */
    if (isMobile) setOpenMobile(false);
    router.push(href);
  }

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => setOpen(true)}
          tooltip="Search"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <SearchIcon />
          <span>Search</span>
          {/* Hidden at icon width with the rest of the row's text, and from
              assistive tech — `aria-keyshortcuts` above states the binding
              properly, where "⌘K" read aloud as glyphs would not. */}
          <kbd
            aria-hidden="true"
            className="ml-auto text-xs tracking-widest text-muted-foreground group-data-[collapsible=icon]:hidden"
          >
            ⌘K
          </kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Jump to a page or a project"
      >
        {/* The vendored <CommandDialog> renders its children straight into the
            dialog WITHOUT a <Command> root, unlike the upstream shadcn block,
            so the cmdk context has to be opened here — leave it out and
            CommandInput/CommandList mount with no state, and the palette
            silently never highlights or selects anything.
            `shouldFilter={false}`: the project rows were already matched by
            the SERVER, and cmdk's own fuzzy pass would hide hits the database
            found. The nav list is short and static, so it is filtered inline
            below instead. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search pages and projects"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>Nothing matches that.</CommandEmpty>

            <CommandGroup heading="Go to">
              {destinations
                .filter((item) =>
                  item.label.toLowerCase().includes(trimmed.toLowerCase()),
                )
                .map((item) => (
                  <CommandItem
                    key={item.key}
                    value={item.key}
                    onSelect={() => go(item.href)}
                  >
                    {item.label}
                  </CommandItem>
                ))}
            </CommandGroup>

            {projects.length > 0 ? (
              <CommandGroup heading="Projects">
                {projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={project.id}
                    onSelect={() =>
                      go(`/dashboard/projects/${project.id}/script` as Route)
                    }
                  >
                    <span className="truncate">{project.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
