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
 * SOURCE OF TRUTH KEYWORDS: projectsRouter, projects.create, projects.list,
 *   projects.get, projects.rename, projects.delete, projects.duplicate,
 *   BRANCH_POLICY, EXPLICIT_GATE_ON_DUPLICATE, AUTO_DERIVED_FROM_RESOURCES
 *
 * WHAT:  The CRUD surface for projects: create, paginated list, single read
 *        with its migrated timeline, rename, delete and duplicate.
 * WHY:   The plan limit and the usage counter are NOT declared here —
 *        AUTO_DERIVED_FROM_RESOURCES. `projects` carries a `limit` in
 *        src/lib/resources.ts, so the factory gates `projects.create` and bumps
 *        the counter on create and delete by itself. Declaring either here
 *        would double-count.
 *
 *        EXPLICIT_GATE_ON_DUPLICATE is the exception that proves it. The
 *        factory's gate fires on the path segment `create` and nothing else, so
 *        `duplicate` — which also produces a project — would slip past the cap
 *        and leave the counter one short of reality. It is therefore the ONE
 *        handler in this file that checks a gate and bumps a counter by hand.
 *        Renaming the verb to `createCopy` would have bought the automation
 *        back and lost the audit template and the client-side cache key, which
 *        is the worse trade.
 * WHERE: Mounted as `projects` in src/trpc/routers/_app.ts. Reads through
 *        src/services/projects.service.ts; the timeline document is migrated by
 *        src/lib/timeline before it leaves this file.
 */

import { TRPCError } from '@trpc/server'

import type { Prisma } from '@/generated/prisma'

import { createStructuredError, createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import { permissions } from '@/lib/permissions'
import { checkFeatureGate } from '@/lib/feature-gate'
import { ERROR_CODES } from '@/lib/errors'
import { incrementUsage } from '@/services/usage.service'
import {
  findProjectForOrganization,
  findProjectWithTimeline,
  listProjects,
} from '@/services/projects.service'
import { TimelineMigrationError, tryMigrate } from '@/lib/timeline'
import {
  createProjectSchema,
  deleteProjectSchema,
  duplicateProjectSchema,
  getProjectSchema,
  listProjectsSchema,
  renameProjectSchema,
} from '@/lib/types'

export const projectsRouter = createTRPCRouter({
  /* No gate, no counter, no audit row written here — the factory does all three
   * because the path is `projects.create` and the registry entry has a limit. */
  create: protectedProcedure({ requirePermission: permissions.PROJECTS_CREATE })
    .input(createProjectSchema)
    .mutation(({ ctx, input }) =>
      ctx.db.project.create({
        data: {
          organizationId: input.organizationId,
          title: input.title,
          kind: input.kind,
          aspect: input.aspect,
          ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
          ...(input.settings !== undefined ? { settings: input.settings } : {}),
        },
      })
    ),

  list: protectedProcedure({ requirePermission: permissions.PROJECTS_READ, paginate: true })
    .input(listProjectsSchema)
    .query(async ({ ctx, input }) => {
      const { skip, take, pageSize } = ctx.pagination
      const page = await listProjects(
        ctx.db,
        {
          organizationId: input.organizationId,
          search: input.search,
          kind: input.kind,
          status: input.status,
        },
        { skip, take }
      )
      /* SERVER_TOTAL_PAGES — computed here, against the pageSize the FACTORY
       * clamped to, so the client's pager cannot disagree with the query that
       * produced the rows. The service stays pure Prisma and does no maths. */
      return { ...page, totalPages: Math.max(1, Math.ceil(page.total / pageSize)) }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: projects.get, MIGRATE_ON_EVERY_READ
   *
   * WHAT:  One project with its timeline document, migrated to the current
   *        version before it is returned.
   * WHY:   MIGRATE_ON_EVERY_READ. The stored document may have been written by
   *        any previous release, and this is the boundary where that stops
   *        being true — nothing downstream of here handles an old version.
   *        A document that cannot be migrated returns `timeline: null` with the
   *        reasons attached rather than failing the whole query: the project
   *        page still has a title, a status and a delete button to offer, and a
   *        hard failure would strand the customer with no way to remove the
   *        broken project.
   * WHERE: The project detail screen; the editor in Phase 15.
   */
  get: protectedProcedure({ requirePermission: permissions.PROJECTS_READ })
    .input(getProjectSchema)
    .query(async ({ ctx, input }) => {
      const project = await findProjectWithTimeline(ctx.db, input.organizationId, input.id)
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' })

      const { timeline, ...rest } = project
      if (timeline === null) {
        return { ...rest, timeline: null, timelineErrors: [] }
      }

      const migrated = tryMigrate(timeline.doc)
      if (!migrated.ok) {
        return { ...rest, timeline: null, timelineErrors: migrated.errors }
      }

      return {
        ...rest,
        timeline: { doc: migrated.doc, revision: timeline.revision, updatedAt: timeline.updatedAt },
        timelineErrors: [],
      }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: projects.rename
   *
   * WHAT:  Changes a project's title and nothing else.
   * WHY:   A narrow verb rather than a general `update`, because the only other
   *        writable fields are `status` and `manualEdited`, and neither is the
   *        customer's to set — the pipeline owns one and the editor owns the
   *        other. A general update would have to defend each of them.
   *        The existence check is explicit so the error is NOT_FOUND rather
   *        than a Prisma P2025 surfacing as an internal error.
   * WHERE: The rename dialog on the projects list.
   */
  rename: protectedProcedure({ requirePermission: permissions.PROJECTS_UPDATE })
    .input(renameProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await findProjectForOrganization(ctx.db, input.organizationId, input.id)
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' })

      return ctx.db.project.update({
        where: { id: existing.id },
        data: { title: input.title },
      })
    }),

  /* The counter decrement and the audit row are the factory's, as on create.
   * The Timeline row goes with it through the schema's onDelete: Cascade. */
  delete: protectedProcedure({ requirePermission: permissions.PROJECTS_DELETE })
    .input(deleteProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await findProjectForOrganization(ctx.db, input.organizationId, input.id)
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' })

      return ctx.db.project.delete({ where: { id: existing.id } })
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: projects.duplicate, EXPLICIT_GATE_ON_DUPLICATE,
   *   BRANCH_POLICY
   *
   * WHAT:  Copies a project and its timeline document into a new project.
   * WHY:   EXPLICIT_GATE_ON_DUPLICATE — see the file header for why this one
   *        handler checks the plan cap and bumps the counter itself. Both run
   *        inside the handler's transaction, so a failed copy cannot leave the
   *        counter inflated.
   *
   *        BRANCH_POLICY: `parentId` is set to the SOURCE project. That is the
   *        same link a regeneration of a manually-edited project will use in
   *        Phase 15, deliberately — a copy and a branch are the same shape, and
   *        giving them two shapes would mean the version history could not show
   *        them in one tree. `manualEdited` is NOT copied: the duplicate has
   *        had no manual work done to it yet, and inheriting the flag would
   *        make the first regeneration branch again for no reason.
   *
   *        The document is copied verbatim, un-migrated. Migrating on copy
   *        would mean a duplicate renders differently from the original it was
   *        taken from, which is exactly what someone duplicating a finished
   *        video does not want; `get` migrates on read, as everything does.
   * WHERE: The row menu on the projects list.
   */
  duplicate: protectedProcedure({
    requirePermission: permissions.PROJECTS_CREATE,
    audit: { action: 'duplicate' },
  })
    .input(duplicateProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const source = await findProjectWithTimeline(ctx.db, input.organizationId, input.id)
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' })

      /* Built to the same shape the factory's own gate throws, so the client's
       * upgrade modal opens identically whether the cap was hit by `create` or
       * by `duplicate` — see UPGRADE_COPY_FROM_REGISTRY in protected.ts. */
      const gate = await checkFeatureGate(input.organizationId, 'projects', 1)
      if (!gate.allowed) {
        throw createStructuredError('FORBIDDEN', gate.reason || 'Plan limit reached', {
          errorCode: ERROR_CODES.USAGE_LIMIT_REACHED,
          resource: 'projects',
          limit: gate.limit ?? 0,
          current: gate.currentUsage ?? 0,
          currentPlan: gate.plan,
          upgradeRequired: true,
          message: gate.reason || 'You have reached your plan limit for projects',
          upgradeMessage: gate.upgradeMessage,
        })
      }

      const copy = await ctx.db.project.create({
        data: {
          organizationId: source.organizationId,
          title: input.title ?? `Copy of ${source.title}`,
          kind: source.kind,
          aspect: source.aspect,
          parentId: source.id,
          ...(source.sourceRef !== null ? { sourceRef: source.sourceRef } : {}),
          ...(source.settings !== null ? { settings: source.settings } : {}),
        },
      })

      if (source.timeline !== null) {
        await ctx.db.timeline.create({
          data: {
            projectId: copy.id,
            docVersion: source.timeline.docVersion,
            /* `doc` is a non-nullable Json column that Prisma still READS as
             * the nullable JsonValue, so a round-trip through a write needs
             * this. Same pattern and same reason as
             * src/services/activity-log.service.ts:188. */
            doc: source.timeline.doc as Prisma.InputJsonValue,
            revision: 0,
          },
        })
      }

      await incrementUsage(input.organizationId, 'projects', 1, ctx.db)
      return copy
    }),
})

/* Re-exported so a caller catching a failed migration from `get` does not have
 * to reach into the timeline module for the error class. */
export { TimelineMigrationError }
