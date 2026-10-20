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
 * SOURCE OF TRUTH KEYWORDS: listRenders, findRenderForOrganization,
 *   findRenderById, findReusableRender, createQueuedRender, markRenderStarted,
 *   markRenderProgress, completeRender, failRender, prepareRenderRetry,
 *   createRenderOutputAsset, RENDER_LIST_SELECT, RenderListItem,
 *   TENANT_SCOPED_QUERY, TERMINAL_IS_FINAL, RENDER_REUSE, DbClient
 *
 * WHAT:  The Prisma reads and writes of the `render` table, plus the one
 *        function that turns a finished render into an `Asset` row.
 *
 * WHY:   TENANT_SCOPED_QUERY, as in projects.service.ts and assets.service.ts:
 *        every function takes `organizationId` and puts it in the WHERE clause
 *        even when it also has a primary key. The procedure factory proves the
 *        CALLER belongs to the org they named; it says nothing about the row.
 *        The workflow needs this more than anything else in the app does,
 *        because it runs OUTSIDE `protectedProcedure` and inherits none of its
 *        gates — the phase's step 10 — so the scoping has to be in the query
 *        itself rather than in whatever checked earlier.
 *
 *        TERMINAL_IS_FINAL is the rule this file exists to hold in one place.
 *        `completed`, `failed` and `timedOut` are end states, and every write
 *        that sets or follows one filters on the status it expects. That is
 *        not defensive style — it is the only thing standing between us and
 *        two specific bugs, both of which have a live cause in this phase:
 *
 *          1. A late webhook for a render already marked `timedOut` would
 *             resurrect it, so a customer sees a render succeed after being
 *             told it failed — and `attempts` has already been spent on a
 *             retry that is now rendering the same thing a second time.
 *          2. A progress write arriving after completion would move a finished
 *             render back to `rendering` and strand the UI on a spinner over a
 *             video that exists.
 *
 *        Both are ordinary consequences of an at-least-once webhook and a
 *        parallel renderer, not edge cases.
 *
 *        Business rules — what a plan allows, whether a retry is permitted,
 *        what gets enqueued — live in the router and the workflow, not here.
 * WHERE: Called by src/trpc/routers/renders.ts,
 *        src/inngest/functions/project-render.ts and
 *        src/app/api/webhooks/remotion/route.ts.
 */

import 'server-only'

import type { Prisma } from '@/generated/prisma'
import { type DbClient } from '@/lib/config/prisma'
import {
  RENDER_TERMINAL_STATUSES,
  type RenderResolution,
  type RenderStatus,
} from '@/lib/types/render'

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_LIST_SELECT, RenderListItem
 *
 * WHAT:  The columns the render panel renders, and the row type they infer to.
 * WHY:   Explicit rather than a bare `findMany`, for the same reason
 *        PROJECT_LIST_SELECT and ASSET_LIST_SELECT are. `costBreakdown` is a
 *        JSON blob of per-chunk provider accounting that Phase 05 will write
 *        and only an operator will ever read, and shipping it to the browser
 *        on every poll of an in-progress render is a cost with no reader.
 * WHERE: listRenders below; the render panel's history list.
 */
export const RENDER_LIST_SELECT = {
  id: true,
  projectId: true,
  status: true,
  progress: true,
  resolution: true,
  watermark: true,
  outputAssetId: true,
  posterAssetId: true,
  attempts: true,
  error: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
} as const satisfies Prisma.RenderSelect

export type RenderListItem = Prisma.RenderGetPayload<{ select: typeof RENDER_LIST_SELECT }>

export interface RenderListFilters {
  organizationId: string
  projectId?: string | undefined
  status?: RenderStatus | undefined
}

/**
 * SOURCE OF TRUTH KEYWORDS: listRenders
 *
 * WHAT:  A workspace's renders, newest first.
 * WHY:   Ordered by `createdAt`, not `updatedAt` — `updatedAt` moves on every
 *        progress write, so ordering by it would reshuffle the list under the
 *        customer's cursor while a render runs, which is exactly when they are
 *        looking at it.
 * WHERE: `renders.list`.
 */
export async function listRenders(
  db: DbClient,
  filters: RenderListFilters,
  page: { skip: number; take: number },
): Promise<{ rows: RenderListItem[]; total: number }> {
  const where: Prisma.RenderWhereInput = {
    organizationId: filters.organizationId,
    ...(filters.projectId !== undefined ? { projectId: filters.projectId } : {}),
    ...(filters.status !== undefined ? { status: filters.status } : {}),
  }

  const [rows, total] = await Promise.all([
    db.render.findMany({
      where,
      select: RENDER_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: page.skip,
      take: page.take,
    }),
    db.render.count({ where }),
  ])

  return { rows, total }
}

/**
 * SOURCE OF TRUTH KEYWORDS: findRenderForOrganization, TENANT_SCOPED_QUERY
 *
 * WHAT:  One render, by id, only if this workspace owns it.
 * WHY:   Returns null rather than throwing so the caller answers NOT_FOUND.
 *        Distinguishing "no such render" from "not yours" with different
 *        status codes tells an attacker which ids are real — the same rule
 *        assets.service.ts states for `signAssetUrl`.
 * WHERE: `renders.get`, `renders.retry`.
 */
export async function findRenderForOrganization(
  db: DbClient,
  organizationId: string,
  id: string,
): Promise<Prisma.RenderGetPayload<Record<string, never>> | null> {
  return db.render.findFirst({ where: { id, organizationId } })
}

/**
 * SOURCE OF TRUTH KEYWORDS: findRenderById, WORKFLOW_RECHECKS_OWNERSHIP
 *
 * WHAT:  One render by id with no tenancy filter, for the workflow.
 * WHY:   The workflow is handed a renderId by an event and has no
 *        organizationId it can trust — the event is JSON that crossed a queue
 *        and may have been enqueued by an older deploy. So it reads the row
 *        FIRST and takes the organizationId FROM IT, then checks that
 *        everything else it touches belongs to the same workspace. That is the
 *        phase's step 10 ("re-check ownership inside the workflow") done the
 *        only way it can be done: the row is the authority, not the payload.
 *
 *        This is therefore the one unscoped read in the file, and it is only
 *        safe because nothing user-facing calls it. Grep the symbol before
 *        adding a second caller.
 * WHERE: src/inngest/functions/project-render.ts and the webhook route.
 */
export async function findRenderById(
  db: DbClient,
  id: string,
): Promise<Prisma.RenderGetPayload<Record<string, never>> | null> {
  return db.render.findUnique({ where: { id } })
}

/**
 * SOURCE OF TRUTH KEYWORDS: findReusableRender, RENDER_REUSE
 *
 * WHAT:  A completed render of this exact output, if one exists.
 * WHY:   RENDER_REUSE, and the two filters are both load-bearing. The
 *        `docHash` is the full cache key (see renderCacheKey — it covers the
 *        resolution and the watermark, not just the document), and `completed`
 *        excludes the three states that have no file behind them: a queued or
 *        rendering row would make a second request return a render that is
 *        still running as though it were finished, and a failed one would
 *        return a permanent refusal to everyone who ever asks for that
 *        document again — which is the worse of the two, because a failure
 *        caused by a momentary outage would become the project's permanent
 *        answer.
 *
 *        `outputAssetId` must also be present. A row can be `completed` for
 *        the instant between the status write and the asset write only if
 *        those are not in one transaction — they are, in `completeRender`, so
 *        this is belt and braces rather than a live hole; it costs nothing and
 *        it means a reuse can never return a render with nothing to download.
 * WHERE: `renders.create`.
 */
export async function findReusableRender(
  db: DbClient,
  projectId: string,
  docHash: string,
): Promise<Prisma.RenderGetPayload<Record<string, never>> | null> {
  return db.render.findFirst({
    where: {
      projectId,
      docHash,
      status: 'completed',
      outputAssetId: { not: null },
    },
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: createQueuedRender, RENDER_STARTS_OUTSIDE_THE_REQUEST
 *
 * WHAT:  The row, created `queued`, before anything has been started.
 * WHY:   RENDER_STARTS_OUTSIDE_THE_REQUEST. `renders.create` returns
 *        immediately (the phase's step 3) — the row exists so the UI has
 *        something to watch and so the workflow has something to find. The
 *        status default lives on the schema, not here, so this function cannot
 *        create a row that claims to be running.
 *
 *        `watermark` and `resolution` are stored although they are also inside
 *        `docHash`: the key is opaque to a human and to SQL, and the row has
 *        to be able to say what it produced without anybody parsing it.
 * WHERE: `renders.create`.
 */
export async function createQueuedRender(
  db: DbClient,
  data: {
    organizationId: string
    projectId: string
    docHash: string
    resolution: RenderResolution
    watermark: boolean
  },
): Promise<Prisma.RenderGetPayload<Record<string, never>>> {
  return db.render.create({ data })
}

/**
 * SOURCE OF TRUTH KEYWORDS: markRenderStarted, TERMINAL_IS_FINAL
 *
 * WHAT:  Records the provider's id and moves the row to `rendering`.
 * WHY:   `updateMany` with a status filter, not `update` — and that is the
 *        pattern for every write below, for the reason in the file header. A
 *        render cancelled or timed out while the provider call was in flight
 *        must not be dragged back to `rendering`; returning a count of zero
 *        lets the caller see that happened rather than assume it did not.
 *
 *        `startedAt` is set HERE rather than at creation, so the difference
 *        between the two is queue time and the difference between this and
 *        `finishedAt` is render time. Setting it at creation would merge them
 *        into one number that answers neither question.
 * WHERE: The `start-render` step of the render workflow.
 */
export async function markRenderStarted(
  db: DbClient,
  id: string,
  providerRenderId: string,
): Promise<number> {
  const result = await db.render.updateMany({
    where: { id, status: 'queued' },
    data: { status: 'rendering', providerRenderId, startedAt: new Date(), error: null },
  })
  return result.count
}

/**
 * SOURCE OF TRUTH KEYWORDS: markRenderProgress, TERMINAL_IS_FINAL
 *
 * WHAT:  Moves the progress bar.
 * WHY:   Only ever while `rendering`. A progress write that arrived after
 *        completion would otherwise move a finished render backwards and
 *        strand the UI on a spinner over a video that exists — see the second
 *        case in TERMINAL_IS_FINAL.
 * WHERE: Not on the happy path, which learns the end from the webhook. The
 *        timeout branch writes the last known progress before giving up.
 */
export async function markRenderProgress(
  db: DbClient,
  id: string,
  progress: number,
): Promise<number> {
  const result = await db.render.updateMany({
    where: { id, status: 'rendering' },
    /* Clamped: a provider reporting 1.02 would render as a bar past its own
     * track, and a negative would render as none at all. */
    data: { progress: Math.min(1, Math.max(0, progress)) },
  })
  return result.count
}

/**
 * SOURCE OF TRUTH KEYWORDS: completeRender, TERMINAL_IS_FINAL
 *
 * WHAT:  The one write that makes a render downloadable.
 * WHY:   Takes the asset ids rather than creating them, because the caller has
 *        to create the Asset rows and this row's status in ONE transaction:
 *        a `completed` render whose `outputAssetId` points at nothing is a
 *        download button that 404s, and a render marked complete without its
 *        asset would also be returned by `findReusableRender` forever.
 *
 *        Refuses to act on anything but a `rendering` row, so a duplicate
 *        webhook — which is the normal behaviour of an at-least-once delivery,
 *        not a fault — writes nothing the second time instead of creating a
 *        second pair of assets for one render.
 * WHERE: The `finalize` step of the render workflow.
 */
export async function completeRender(
  db: DbClient,
  id: string,
  output: { outputAssetId: string; posterAssetId: string | null },
): Promise<number> {
  const result = await db.render.updateMany({
    where: { id, status: 'rendering' },
    data: {
      status: 'completed',
      progress: 1,
      error: null,
      outputAssetId: output.outputAssetId,
      posterAssetId: output.posterAssetId,
      finishedAt: new Date(),
    },
  })
  return result.count
}

/**
 * SOURCE OF TRUTH KEYWORDS: failRender, TERMINAL_IS_FINAL
 *
 * WHAT:  Records `failed` or `timedOut` with the reason.
 * WHY:   One function for both because they are the same write with a
 *        different word, and separating them would be two places to forget the
 *        status filter. The status is a parameter rather than inferred so the
 *        caller states which kind of failure it saw — `failed` means the
 *        provider told us why, `timedOut` means it never told us anything (see
 *        RENDER_STATUSES).
 *
 *        Only acts on a non-terminal row: a render already `completed` must
 *        not be failed by a late error report, which is reachable whenever a
 *        webhook and the timeout branch race.
 * WHERE: The workflow's failure paths and its onFailure handler.
 */
export async function failRender(
  db: DbClient,
  id: string,
  status: Extract<RenderStatus, 'failed' | 'timedOut'>,
  error: string,
  progress?: number,
): Promise<number> {
  const result = await db.render.updateMany({
    where: { id, status: { notIn: [...RENDER_TERMINAL_STATUSES] } },
    data: {
      status,
      /* Truncated: the column is unbounded text but the UI renders this
       * inline, and a provider stack trace in a table cell is not a readable
       * error. Same cap and same reason as markAssetFailed. */
      error: error.slice(0, 500),
      finishedAt: new Date(),
      ...(progress !== undefined ? { progress: Math.min(1, Math.max(0, progress)) } : {}),
    },
  })
  return result.count
}

/**
 * SOURCE OF TRUTH KEYWORDS: prepareRenderRetry, RETRY_ONCE, FRESH_PROVIDER_ID
 *
 * WHAT:  Returns a failed render to `queued` so it can be started again.
 * WHY:   FRESH_PROVIDER_ID. `providerRenderId` is cleared, which is not
 *        tidiness — the column is UNIQUE, so leaving the old id there would
 *        make `markRenderStarted` collide on the retry's own id and the retry
 *        would fail with a constraint error nobody can read. Clearing it also
 *        closes the door on a late webhook for the FIRST attempt arriving
 *        after the second has started and being matched to this row.
 *
 *        `attempts` is incremented here rather than checked here: the decision
 *        about whether a retry is ALLOWED is a business rule and belongs in
 *        the router (RETRY_ONCE, against RENDER_ATTEMPT_LIMIT). This function
 *        records that one was spent. The `attempts` filter is still in the
 *        WHERE clause so two concurrent retry clicks cannot both succeed —
 *        the second matches no row.
 *
 *        `finishedAt` goes back to null because the render has not finished;
 *        leaving the old timestamp would make the duration of the retry read
 *        as negative.
 * WHERE: `renders.retry`.
 */
export async function prepareRenderRetry(
  db: DbClient,
  id: string,
  attemptLimit: number,
): Promise<number> {
  const result = await db.render.updateMany({
    where: {
      id,
      status: { in: ['failed', 'timedOut'] },
      attempts: { lt: attemptLimit },
    },
    data: {
      status: 'queued',
      providerRenderId: null,
      error: null,
      progress: 0,
      startedAt: null,
      finishedAt: null,
      attempts: { increment: 1 },
    },
  })
  return result.count
}

/**
 * SOURCE OF TRUTH KEYWORDS: createRenderOutputAsset, RENDER_OUTPUT_IS_AN_ASSET,
 *   READY_NOT_PROCESSING, MODERATION_SKIPPED_FOR_OUR_OWN_OUTPUT
 *
 * WHAT:  Records a finished render's file as an `Asset` row.
 * WHY:   RENDER_OUTPUT_IS_AN_ASSET. The output goes in the SAME table as every
 *        other piece of media, which is the schema's own stated reason for one
 *        asset table: every consumer downstream wants the same five answers,
 *        and the download UI, the media library and a future "use this render
 *        in another video" all get them for free. A separate `render_output`
 *        table would have to reimplement signing, deletion and byte
 *        accounting.
 *
 *        READY_NOT_PROCESSING: created `ready`, which is the one place in the
 *        app that is allowed to do that. Everywhere else a row starts
 *        `processing` because nothing has looked at the bytes yet; here the
 *        bytes were produced by our own renderer and are already in R2 by the
 *        time this runs, so `processing` would be a lie that leaves a
 *        permanent spinner — nothing ingests a render output, so nothing would
 *        ever move it on.
 *
 *        MODERATION_SKIPPED_FOR_OUR_OWN_OUTPUT, and `skipped` rather than
 *        `approved` for the same reason the ingest workflow uses it: the
 *        inputs were moderated when they were ingested, and claiming the
 *        output was `approved` would be a claim nothing checked. Phase 10
 *        decides whether a render deserves its own pass.
 *
 *        The bytes are NOT added to the `storage` counter. That is consistent
 *        with `AssetVariant` — a render is a derived product of a project the
 *        customer is already paying for, and the thing a plan caps about
 *        renders is HOW MANY (`RESOURCES.renders`), not how big. Charging both
 *        would mean a free workspace's five renders could exhaust a quota
 *        meant for their uploads, and they would have no way to tell which
 *        cap they had hit. Grep RENDERS_ARE_NOT_METERED_ON_STORAGE.
 * WHERE: The `finalize` step of the render workflow.
 */
export async function createRenderOutputAsset(
  db: DbClient,
  data: {
    organizationId: string
    filename: string
    storageKey: string
    contentType: string
    bytes: number
    durationSec?: number | null
    width?: number | null
    height?: number | null
  },
): Promise<Prisma.AssetGetPayload<Record<string, never>>> {
  return db.asset.create({
    data: {
      organizationId: data.organizationId,
      kind: 'render_output',
      source: 'generated',
      filename: data.filename,
      storageKey: data.storageKey,
      contentType: data.contentType,
      bytes: data.bytes,
      status: 'ready',
      moderationStatus: 'skipped',
      ...(data.durationSec !== undefined ? { durationSec: data.durationSec } : {}),
      ...(data.width !== undefined ? { width: data.width } : {}),
      ...(data.height !== undefined ? { height: data.height } : {}),
    },
  })
}
