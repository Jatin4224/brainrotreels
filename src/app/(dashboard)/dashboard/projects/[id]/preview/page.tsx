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
 * SOURCE OF TRUTH KEYWORDS: ProjectPreviewPage, ROUTE_AUTHORIZATION,
 *   SERVER_PAGE_CLIENT_PLAYER, params promise
 *
 * WHAT:  /dashboard/projects/[id]/preview — plays a project's timeline in the
 *        browser.
 * WHY:   SERVER_PAGE_CLIENT_PLAYER, which is the brief's own requirement. The
 *        page is a server component so it costs no JavaScript beyond the
 *        player itself; the player has to be a client child because
 *        `@remotion/player` mounts a live React tree and drives it from a
 *        requestAnimationFrame loop.
 *
 *        This page is gated without any code here: ROUTE_AUTHORIZATION in the
 *        dashboard layout matches the pathname against the registry's nav
 *        entries, longest href first, so `/dashboard/projects/...` inherits
 *        `projects` and its default `read` permission. Adding a per-page check
 *        would be a second source of truth for the same rule.
 *
 *        `params` is awaited: it is a Promise in this version of Next, and the
 *        id is handed to the client component rather than fetched here,
 *        because the query also needs the ACTIVE ORGANIZATION, which resolves
 *        client-side like it does on every other screen.
 * WHERE: Linked from the projects list row menu.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { ProjectPreview } from './_components/project-preview'
import { RenderPanel } from './_components/render-panel'

export const metadata: Metadata = {
  title: 'Preview',
}

export default async function ProjectPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <ContentLayout title="Preview">
      {/* The player and the export panel side by side on a wide screen and
          stacked on a phone. Two independent client components rather than one:
          the player mounts a Remotion tree and the panel polls a query, and
          neither needs anything from the other. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ProjectPreview projectId={id} />
        <RenderPanel projectId={id} />
      </div>
    </ContentLayout>
  )
}
