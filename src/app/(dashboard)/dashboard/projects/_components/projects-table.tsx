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
 * SOURCE OF TRUTH KEYWORDS: ProjectsTable, DataTable, usePaginatedFilters,
 *   ProjectRow, STATUS_BADGE_VARIANT, SERVER_TOTAL_PAGES, PROJECT_PAGE_SIZE
 *
 * WHAT:  The workspace's projects: searchable, filterable by format and status,
 *        paginated, with a per-row menu.
 * WHY:   Pagination, debouncing, the page reset and the loading/empty/error
 *        states all belong to <DataTable> and usePaginatedFilters, so this file
 *        is the project-specific part only — the columns, the badges and the
 *        query. SERVER_TOTAL_PAGES: `projects.list` returns `totalPages`
 *        computed against the pageSize the procedure factory clamped to, so it
 *        is passed through rather than re-derived here.
 *        The row type is inferred from the ROUTER output rather than from
 *        Prisma, so narrowing the service's select cannot leave this file
 *        claiming a column the server stopped sending.
 * WHERE: Rendered by /dashboard/projects.
 */

import { formatDistanceToNow } from 'date-fns'
import type { inferRouterOutputs } from '@trpc/server'

import type { AppRouter } from '@/trpc/routers/_app'
import { trpc } from '@/trpc/react-provider'
import { useActiveOrganizationId } from '@/hooks/use-active-organization'
import {
  PROJECT_FILTER_DEFAULTS,
  PROJECT_PAGE_SIZE,
  normalizeProjectFilters,
  type ProjectFilterValues,
} from '@/lib/types'
import { DataTable, type DataTableColumn, usePaginatedFilters } from '@/components/global/data-table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ProjectFilters, kindLabel, statusLabel } from './project-filters'
import { ProjectRowActions } from './project-row-actions'

type ProjectRow = inferRouterOutputs<AppRouter>['projects']['list']['items'][number]

/**
 * SOURCE OF TRUTH KEYWORDS: STATUS_BADGE_VARIANT
 *
 * WHAT:  Which badge each status wears.
 * WHY:   `failed` is the only destructive one; `ready` uses `secondary` rather
 *        than a green because `--success` is reserved and a list where most
 *        rows are ready would be a wall of colour. A status with no entry falls
 *        back to `outline`, so an unrecognised value still renders.
 * WHERE: The status column below.
 */
const STATUS_BADGE_VARIANT: Readonly<
  Record<string, 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
  draft: 'outline',
  generating: 'default',
  ready: 'secondary',
  failed: 'destructive',
  cancelled: 'outline',
}

const columns: readonly DataTableColumn<ProjectRow>[] = [
  {
    id: 'title',
    header: 'Project',
    cell: (project) => (
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{project.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {kindLabel(project.kind)}
          {project.parentId !== null ? ' · copy' : ''}
          {project.manualEdited ? ' · edited' : ''}
        </p>
      </div>
    ),
  },
  {
    id: 'aspect',
    header: 'Aspect',
    hideOnMobile: true,
    className: 'text-muted-foreground whitespace-nowrap',
    cell: (project) => project.aspect,
  },
  {
    id: 'updated',
    header: 'Last edited',
    hideOnMobile: true,
    className: 'text-muted-foreground whitespace-nowrap',
    cell: (project) =>
      formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true }),
  },
  {
    id: 'status',
    header: 'Status',
    className: 'text-right',
    cell: (project) => (
      <Badge variant={STATUS_BADGE_VARIANT[project.status] ?? 'outline'}>
        {statusLabel(project.status)}
      </Badge>
    ),
  },
]

export function ProjectsTable() {
  const organizationId = useActiveOrganizationId()
  const { filters, setFilters, applied, page, setPage, isFiltered } = usePaginatedFilters<
    ProjectFilterValues,
    ReturnType<typeof normalizeProjectFilters>
  >({
    defaults: PROJECT_FILTER_DEFAULTS,
    searchKey: 'search',
    normalize: normalizeProjectFilters,
  })

  const enabled = organizationId !== undefined
  /* pageSize is sent rather than left to the factory's default, so the size the
   * pager renders and the size the query used are the same constant and cannot
   * drift if that default changes. */
  const query = trpc.projects.list.useQuery(
    { organizationId: organizationId ?? '', page, pageSize: PROJECT_PAGE_SIZE, ...applied },
    { enabled, placeholderData: (previous) => previous, retry: false },
  )

  /* The active organization resolves on the client, so the first paint has no
   * id to query with. A skeleton is the honest state — an empty table would
   * read as "you have no projects". */
  if (!enabled) return <Skeleton className="h-64 w-full" />

  const data = query.data

  return (
    <DataTable<ProjectRow>
      columns={columns}
      rows={data?.items ?? []}
      getRowId={(project) => project.id}
      total={data?.total ?? 0}
      page={page}
      pageSize={PROJECT_PAGE_SIZE}
      {...(data?.totalPages !== undefined ? { totalPages: data.totalPages } : {})}
      onPageChange={setPage}
      isLoading={query.isPending && data === undefined}
      isFetching={query.isFetching}
      error={query.error?.message ?? null}
      isFiltered={isFiltered}
      toolbar={<ProjectFilters values={filters} onChange={setFilters} />}
      rowActions={(project) => (
        <ProjectRowActions organizationId={organizationId} project={project} />
      )}
      empty="No projects yet. Create one to get started."
      emptyFiltered="No projects match these filters."
      countLabel={['project', 'projects']}
    />
  )
}
