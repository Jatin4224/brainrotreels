/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: PageHeader, ContentLayout, PageContainer, width
 *
 * WHAT:  The dashboard page chrome — a borderless header row (sidebar trigger,
 *        title, action slot) and a ContentLayout wrapper that stacks that
 *        header and the page content INSIDE one centered PageContainer.
 * WHY:   Every dashboard page renders the same header treatment; centralizing
 *        it here means a page is just `<ContentLayout title=... actions=...>`.
 *        The header lives inside the container (not above it) so the title,
 *        the actions, and the content below share ONE left edge — a full-bleed
 *        header over a capped body reads as two misaligned columns. No
 *        bottom border: the container's alignment already groups the page, so
 *        a rule across the top only chops the layout in half.
 *        The app is dark-only (forcedTheme in the root layout), so there is no
 *        theme toggle here.
 * WHERE: Used by pages under src/app/(dashboard)/** and (portal)/**. Pairs with
 *        the sidebar from src/components/global/sidebar.
 */

import * as React from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/global/page-container";
import type { PageContainerWidth } from "@/components/global/page-container";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export interface PageHeaderProps {
  title: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    /* No fixed height: the row is as tall as the trigger, and the vertical
       rhythm comes from the container's gap — a 4rem header inside an already
       padded container just stranded the title in whitespace. */
    <header className="flex shrink-0 items-center gap-2">
      {/* `-ml-1` pulls the icon's glyph onto the content's left edge — the
          button's own padding would otherwise indent it past the cards. */}
      <SidebarTrigger className="-ml-1" />
      {/* Height and centring come from Separator + the row's `items-center` —
          overriding either here is what knocked the rule out of alignment. */}
      <Separator orientation="vertical" className="mr-2" />
      <h1 className="text-base font-medium">{title}</h1>
      {actions ? (
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export interface ContentLayoutProps {
  title: string;
  actions?: React.ReactNode;
  /**
   * Max width of the centered content column — see PAGE_CONTAINER_WIDTHS.
   * Defaults to `'default'`; pass `'full'` for content that needs the whole
   * page (wide tables, boards) so the opt-out stays explicit and greppable.
   */
  width?: PageContainerWidth;
  /**
   * SOURCE OF TRUTH KEYWORDS: EVERY_ROUTE_ARRIVES, page-enter,
   *   ENTRANCE_PER_CONTAINER
   *
   * Whether the content column rises on mount (`.block-enter`, globals.css).
   * Defaults to `true`: the shell does not move during a navigation, so
   * without it the content is the one thing that changes and it changed by
   * teleporting.
   *
   * Pass `false` from a screen that owns its OWN entrance choreography —
   * ENTRANCE_PER_CONTAINER, one arrival per screen. The dashboard home does
   * exactly that with `.app-enter`/`.dash-enter`; nesting this on top of it
   * would be two entrances where there should be one.
   */
  enter?: boolean;
  children: React.ReactNode;
}

export function ContentLayout({
  title,
  actions,
  width = "default",
  enter = true,
  children,
}: ContentLayoutProps) {
  /* EVERY_ROUTE_ARRIVES — the key, not just the class, is the mechanism. Two
   * routes both render <ContentLayout> at the same position under
   * <SidebarInset>, so React reconciles them as the SAME element and a CSS
   * animation set to run on mount never runs again. Re-keying on the pathname
   * forces the remount that replays it. The key sits on the inner wrapper
   * only: remounting the header too would throw away the sidebar trigger on
   * every navigation for no gain, since nothing in it moves. */
  const pathname = usePathname();

  return (
    /* Padding stays on the OUTER element and centering on the inner one: the
       gutter must survive on narrow screens where the container is already
       below its cap and `mx-auto` contributes nothing.
       24px vertical / 44px horizontal at desktop, per
       00-dashboard-foundations.md section 2. The horizontal gutter steps down
       on smaller screens, where 44px either side of a 945px cap is width the
       content needs more than the margin does. */
    <div className="flex flex-1 flex-col px-4 py-6 sm:px-6 lg:px-11">
      <PageContainer width={width} className="gap-4">
        <PageHeader title={title} actions={actions} />
        {/* `flex-1` and the column stack are what the pages were already
            getting from PageContainer directly, so the wrapper has to carry
            them or every full-height screen (the timeline editor, the caption
            studio) loses its growth. */}
        <div
          key={enter ? pathname : "static"}
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-4",
            enter && "block-enter",
          )}
        >
          {children}
        </div>
      </PageContainer>
    </div>
  );
}
