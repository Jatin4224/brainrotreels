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
 * SOURCE OF TRUTH KEYWORDS: listProjects, findProjectForOrganization,
 *   findProjectWithTimeline, PROJECT_LIST_SELECT,
 *   ProjectListItem, ProjectWithTimeline, TENANT_SCOPED_QUERY, DbClient
 *
 * WHAT:  The Prisma reads of the `project` and `timeline` tables that more than
 *        one caller needs.
 * WHY:   TENANT_SCOPED_QUERY. Every function here takes `organizationId` and
 *        puts it in the WHERE clause, including the ones that also have a
 *        primary key. An `id`-only lookup would let a caller read another
 *        workspace's project with a guessed cuid — the procedure factory
 *        proves the caller belongs to the org it NAMED, not that the row does.
 *
 *        PROJECT_LIST_SELECT exists because `Timeline.doc` is a jsonb document
 *        that runs to hundreds of kilobytes. The list screen must never touch
 *        it, so the select is explicit and the join is absent — a `include:
 *        { timeline: true }` on a page of twenty rows is how a list screen
 *        starts timing out in month three.
 * WHERE: Called by src/trpc/routers/projects.ts. The business rules (what a
 *        duplicate is called, which fields a rename may touch) live there, not
 *        here.
 */

import 'server-only'

import type { Prisma, PrismaClient } from '@/generated/prisma'

type DbClient = PrismaClient | Prisma.TransactionClient

/**
 * SOURCE OF TRUTH KEYWORDS: PROJECT_LIST_SELECT, ProjectListItem
 *
 * WHAT:  The columns the projects list renders, and the row type they infer to.
 * WHY:   Declared `satisfies Prisma.ProjectSelect` so adding a field to the
 *        screen is a one-line change that the row type follows automatically —
 *        and so a typo is a compile error rather than an undefined cell.
 * WHERE: listProjects() below; the columns in projects-table.tsx.
 */
export const PROJECT_LIST_SELECT = {
  id: true,
  title: true,
  kind: true,
  status: true,
  aspect: true,
  manualEdited: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ProjectSelect

export type ProjectListItem = Prisma.ProjectGetPayload<{ select: typeof PROJECT_LIST_SELECT }>

/**
 * SOURCE OF TRUTH KEYWORDS: listProjects, ProjectListFilters
 *
 * WHAT:  One page of a workspace's projects, newest first, with the total for
 *        the pager.
 * WHY:   Ordered by `updatedAt`, not `createdAt`: the project someone touched
 *        last is the one they came back for. The count runs in the same
 *        Promise.all rather than after, because the pager needs both and a
 *        sequential pair doubles the screen's latency for no reason.
 *        `search` is a case-insensitive title match — there is no body text to
 *        search on a project, and matching the jsonb document would be a very
 *        expensive way to answer a question nobody asked.
 * WHERE: projects.list.
 */
export async function listProjects(
  db: DbClient,
  filters: {
    organizationId: string
    search?: string | undefined
    kind?: string | undefined
    status?: string | undefined
  },
  pagination: { skip: number; take: number }
): Promise<{ items: ProjectListItem[]; total: number }> {
  const where: Prisma.ProjectWhereInput = {
    organizationId: filters.organizationId,
    ...(filters.kind !== undefined ? { kind: filters.kind } : {}),
    ...(filters.status !== undefined ? { status: filters.status } : {}),
    ...(filters.search !== undefined && filters.search.length > 0
      ? { title: { contains: filters.search, mode: 'insensitive' } }
      : {}),
  }

  const [items, total] = await Promise.all([
    db.project.findMany({
      where,
      select: PROJECT_LIST_SELECT,
      orderBy: { updatedAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    db.project.count({ where }),
  ])

  return { items, total }
}

/**
 * SOURCE OF TRUTH KEYWORDS: findProjectForOrganization, TENANT_SCOPED_QUERY
 *
 * WHAT:  One project by id, only if it belongs to this workspace.
 * WHY:   `findFirst` with both columns rather than `findUnique` by id — see
 *        TENANT_SCOPED_QUERY above. Returns null rather than throwing so the
 *        router can decide between NOT_FOUND and a softer answer.
 * WHERE: projects.get, .rename, .delete, .duplicate.
 */
export async function findProjectForOrganization(
  db: DbClient,
  organizationId: string,
  id: string
): Promise<Prisma.ProjectGetPayload<Record<string, never>> | null> {
  return db.project.findFirst({ where: { id, organizationId } })
}

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectWithTimeline, findProjectWithTimeline
 *
 * WHAT:  A project together with its timeline row.
 * WHY:   The one place the jsonb document is loaded, so there is a single
 *        callsite to audit when asking "who reads a whole timeline?". The
 *        document still has to go through migrate() before anything reads it —
 *        this function does not do that, because the service layer is pure
 *        Prisma and migrate() is business logic.
 * WHERE: projects.get; the editor (Phase 15) and the render pre-flight
 *        (Phase 04).
 */
export type ProjectWithTimeline = Prisma.ProjectGetPayload<{ include: { timeline: true } }>

export async function findProjectWithTimeline(
  db: DbClient,
  organizationId: string,
  id: string
): Promise<ProjectWithTimeline | null> {
  return db.project.findFirst({
    where: { id, organizationId },
    include: { timeline: true },
  })
}

