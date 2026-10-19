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
 * SOURCE OF TRUTH KEYWORDS: ProjectsPage, RESOURCES.projects.nav
 *
 * WHAT:  /dashboard/projects — the workspace's videos.
 * WHY:   `width="full"` because the table carries six columns and a row menu;
 *        the default column would force the status and date columns to wrap on
 *        a laptop. The opt-out is explicit per the ContentLayout contract.
 * WHERE: RESOURCES.projects.nav.href in src/lib/resources.ts puts this in the
 *        sidebar. The create button is passed as a header action.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { CreateProjectButton } from './_components/create-project-button'
import { ProjectsTable } from './_components/projects-table'

export const metadata: Metadata = {
  title: 'Projects',
}

export default function ProjectsPage() {
  return (
    <ContentLayout title="Projects" width="full" actions={<CreateProjectButton />}>
      <ProjectsTable />
    </ContentLayout>
  )
}
