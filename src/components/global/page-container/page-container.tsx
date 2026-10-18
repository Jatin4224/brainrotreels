/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PageContainer, PageContainerProps, PageContainerWidth,
 *   PAGE_CONTAINER_WIDTHS, ContentLayout, PageHeader, centered page content,
 *   max-width, dashboard content container
 *
 * WHAT:  The centering container for the CONTENT of every dashboard/portal
 *        page — `mx-auto` plus a capped max-width chosen from a fixed scale.
 * WHY:   Content pinned to the left edge of a wide monitor reads badly, and the
 *        alternative (each page inventing its own `mx-auto max-w-…`) drifts:
 *        the settings page ends up 900px wide while the team page runs edge to
 *        edge. Capping here, from ONE scale, means changing the app's content
 *        width is a single-token edit, not a sweep. Widths are a closed union
 *        rather than a free `className`, so a page cannot invent a width that
 *        exists nowhere else; `'full'` is the explicit opt-out for content that
 *        genuinely needs the whole viewport (wide tables, kanban boards).
 * WHERE: Composed into ContentLayout (src/components/global/page-header.tsx),
 *        so every page using ContentLayout is centered automatically. Can also
 *        be used directly inside a page that renders its own chrome.
 */

import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * SOURCE OF TRUTH KEYWORDS: PAGE_CONTAINER_WIDTHS, PageContainerWidth
 *
 * WHAT:  The closed scale of content widths, keyed by name.
 * WHY:   A const object (not inline strings) so the union type is DERIVED from
 *        it — adding a width here adds it to the type, with no second list to
 *        keep in sync.
 * WHERE: Consumed by PageContainer and, through it, ContentLayout's `width`.
 */
export const PAGE_CONTAINER_WIDTHS = {
  /* Reading width — a single column of prose, a focused form. */
  sm: 'max-w-3xl',
  /* The app default — comfortable for cards, settings, and lists. */
  default: 'max-w-5xl',
  /* Dense dashboards: multi-column grids, charts. */
  lg: 'max-w-7xl',
  /* Opt-out: no cap, content spans the page (wide tables, boards). */
  full: '',
} as const

export type PageContainerWidth = keyof typeof PAGE_CONTAINER_WIDTHS

export interface PageContainerProps extends React.ComponentProps<'div'> {
  /** Max content width from the shared scale. Defaults to `'default'`. */
  width?: PageContainerWidth
}

export function PageContainer({
  width = 'default',
  className,
  children,
  ...props
}: PageContainerProps) {
  return (
    /* `min-w-0` keeps the cap from being defeated by a wide child (a table with
       its own overflow-x) inside a flex/grid parent, which would otherwise
       stretch the container past its max-width instead of scrolling. */
    <div
      className={cn(
        'mx-auto flex w-full min-w-0 flex-1 flex-col',
        PAGE_CONTAINER_WIDTHS[width],
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
