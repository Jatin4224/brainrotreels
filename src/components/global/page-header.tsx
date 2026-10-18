/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

'use client'

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

import * as React from 'react'

import { PageContainer } from '@/components/global/page-container'
import type { PageContainerWidth } from '@/components/global/page-container'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

export interface PageHeaderProps {
  title: string
  actions?: React.ReactNode
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
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export interface ContentLayoutProps {
  title: string
  actions?: React.ReactNode
  /**
   * Max width of the centered content column — see PAGE_CONTAINER_WIDTHS.
   * Defaults to `'default'`; pass `'full'` for content that needs the whole
   * page (wide tables, boards) so the opt-out stays explicit and greppable.
   */
  width?: PageContainerWidth
  children: React.ReactNode
}

export function ContentLayout({
  title,
  actions,
  width = 'default',
  children,
}: ContentLayoutProps) {
  return (
    /* Padding stays on the OUTER element and centering on the inner one: the
       gutter must survive on narrow screens where the container is already
       below its cap and `mx-auto` contributes nothing. */
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <PageContainer width={width} className="gap-4">
        <PageHeader title={title} actions={actions} />
        {children}
      </PageContainer>
    </div>
  )
}
