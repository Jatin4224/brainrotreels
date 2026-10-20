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
 * SOURCE OF TRUTH KEYWORDS: rendersRouter, renders.create, renders.list,
 *   renders.get, renders.retry, RENDER_STARTS_OUTSIDE_THE_REQUEST,
 *   REUSE_BEFORE_CHARGING, WATERMARK_RESOLVED_ONCE, RETRY_ONCE,
 *   AUTO_DERIVED_FROM_RESOURCES
 *
 * WHAT:  The surface for starting a cloud render, watching it, and downloading
 *        what it produced.
 *
 * WHY:   AUTO_DERIVED_FROM_RESOURCES. The monthly cap and the usage counter
 *        are NOT declared here — `renders` carries a periodic `limit` in
 *        src/lib/resources.ts, so the factory gates `renders.create` and bumps
 *        the counter by itself. Declaring either here would double-count.
 *
 *        RENDER_STARTS_OUTSIDE_THE_REQUEST is the shape of this whole file and
 *        it is the phase's step 3: `create` validates, decides, writes a row
 *        and enqueues — then RETURNS. It never calls the render provider. A
 *        mutation runs inside a 10-second Prisma transaction, and a provider
 *        round-trip that splits a frame range across a hundred functions does
 *        not belong inside one; the work happens in
 *        src/inngest/functions/project-render.ts, which can take as long as it
 *        needs and resumes if the process dies.
 *
 *        REUSE_COSTS_NOTHING is the phase's "re-rendering an unchanged project
 *        returns the existing output immediately and creates no second row".
 *        Two things make it true, and only one of them is free: the cache key
 *        has to cover the resolution and the watermark as well as the document
 *        (see renderCacheKey), and the handler has to CANCEL the counter bump
 *        the factory is about to apply — because the factory increments on any
 *        successful `create` and cannot see that this one reused a row. The
 *        full reasoning, including why it is `incrementUsage(-1)` and not
 *        `decrementUsage(1)`, is at the branch itself.
 *
 *        WATERMARK_RESOLVED_ONCE, and this is a deliberate correction to the
 *        phase's own step 7, which says `finalize` sets the watermark from
 *        `checkBooleanFeature`. It cannot: the watermark is a composition prop
 *        and therefore decides PIXELS, so it has to be known before the render
 *        starts — by `finalize` the frames exist. It also has to be known here
 *        rather than in the workflow, because it is part of the cache key: if
 *        the workflow re-resolved it and got a different answer (a plan change
 *        between enqueue and start), the file produced would not match the key
 *        it is stored under, and the next request would be served a render
 *        that does not have the watermark state its key claims. So it is
 *        resolved exactly once, here, written to the row, and read from the
 *        row by the workflow. The entitlement is still the only source — a
 *        generator never decides it, which is what step 7 was protecting.
 *
 *        RETRY_ONCE lives here rather than in the service for the same reason
 *        every other business rule does: `prepareRenderRetry` records that an
 *        attempt was spent, and this file decides whether one may be.
 * WHERE: Mounted as `renders` in src/trpc/routers/_app.ts. Reads through
 *        src/services/renders.service.ts; the document is migrated, resolved
 *        and validated by src/lib/timeline before any decision is made.
 */

import { TRPCError } from '@trpc/server'

import { createStructuredError, createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import { permissions } from '@/lib/permissions'
import { checkBooleanFeature, getOrganizationTier } from '@/lib/feature-gate'
import { enqueue } from '@/lib/adapters/jobs'
import { incrementUsage } from '@/services/usage.service'
import { getBalance } from '@/services/credits.service'
import { estimateRenderCost } from '@/lib/credits'
import { ERROR_CODES } from '@/lib/errors'
import { findProjectWithTimeline } from '@/services/projects.service'
import { signAssetUrl } from '@/services/assets.service'
import * as rendersService from '@/services/renders.service'
import { resolveWordAnchors, tryMigrate, validate } from '@/lib/timeline'
import { planComposition, renderCacheKey } from '@/lib/render'
import {
  FINAL_URL_TTL_SECONDS,
  RENDER_ATTEMPT_LIMIT,
  createRenderSchema,
  getRenderSchema,
  isResolutionAllowedForPlan,
  listRendersSchema,
  resolutionsForPlan,
  estimateRenderSchema,
  retryRenderSchema,
} from '@/lib/types'

export const rendersRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: renders.create, REUSE_BEFORE_CHARGING,
   *   WATERMARK_RESOLVED_ONCE, VALIDATE_BEFORE_PAYING
   *
   * WHAT:  Accepts a render request: either hands back the render that already
   *        exists, or creates a queued row and enqueues the work.
   * WHY:   VALIDATE_BEFORE_PAYING. The document is migrated, resolved and run
   *        through `validate()` here, in the request, where the customer is
   *        still watching — rather than in the workflow, where the only way to
   *        report "this timeline is broken" is a failed render they have
   *        already been charged a quota slot for. The workflow validates again
   *        (it has to; it trusts no payload), but this is the check that
   *        produces a usable error.
   *
   *        The order is deliberate and is the same as `projects.preview`:
   *        migrate, resolve anchors, THEN validate. An anchored document has
   *        no absolute times, so validating it before resolution would reject
   *        every voiceover project — and a renderer handed one draws nothing.
   * WHERE: The render panel's "Render" button.
   */
  create: protectedProcedure({ requirePermission: permissions.RENDERS_CREATE })
    .input(createRenderSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await findProjectWithTimeline(
        ctx.db,
        input.organizationId,
        input.projectId,
      )
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' })

      if (project.timeline === null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This project has no timeline yet. Generate one before rendering.',
        })
      }

      /* LOCKED_NOT_HIDDEN is a client affordance; this is the boundary. A
       * disabled radio stops a mistake, not a request. */
      const tier = await getOrganizationTier(input.organizationId)
      if (!isResolutionAllowedForPlan(tier.tier, input.resolution)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            `${input.resolution} rendering is not included in your plan. ` +
            `Available: ${resolutionsForPlan(tier.tier).join(', ')}.`,
        })
      }

      const migrated = tryMigrate(project.timeline.doc)
      if (!migrated.ok) {
        throw new TRPCError({
          code: 'UNPROCESSABLE_CONTENT',
          message:
            'This timeline was written in a format this version cannot open, so it cannot be rendered.',
        })
      }

      const resolved = resolveWordAnchors(migrated.doc)
      const validated = validate(resolved)
      if (!validated.ok) {
        throw new TRPCError({
          code: 'UNPROCESSABLE_CONTENT',
          /* The first error only. `validate` returns one per problem and they
           * are usually one cause repeated; the panel renders this inline. */
          message: `This timeline cannot be rendered: ${validated.errors[0]?.message ?? 'it is not valid.'}`,
        })
      }

      /* WATERMARK_RESOLVED_ONCE — see the file header for why this is here and
       * not in `finalize`, which is where the phase put it. */
      const watermarkFree = await checkBooleanFeature(input.organizationId, 'watermarkFree')
      const watermark = !watermarkFree.enabled

      const docHash = renderCacheKey({
        doc: validated.doc,
        resolution: input.resolution,
        watermark,
      })

      const existing = await rendersService.findReusableRender(
        ctx.db,
        project.id,
        docHash,
      )
      if (existing !== null) {
        /* REUSE_COSTS_NOTHING, and it takes a deliberate correction to be
         * true. The factory auto-increments the `renders` counter on ANY
         * successful `<resource>.create` (section 13 of protected.ts) — it
         * cannot see that this call reused a row instead of making one. Left
         * alone, re-downloading an unchanged video would spend a render from
         * the monthly quota, which is precisely what the phase's reuse rule
         * exists to prevent.
         *
         * So the handler cancels the bump that is about to happen. The order
         * is the point: the factory increments AFTER the handler returns, both
         * inside one transaction, so a -1 here and a +1 there net to exactly
         * zero and the intermediate value is never observed.
         *
         * `incrementUsage(-1)` rather than `decrementUsage(1)` on purpose:
         * decrement FLOORS AT ZERO, which would be wrong in a real case — a
         * render made in January is still reusable in February, when the
         * monthly counter has been reset to 0. Flooring there would leave the
         * customer charged 1 for a render that cost nothing. A raw -1 nets
         * correctly whatever the starting value, including from no row at all.
         *
         * ONE CAVEAT, stated rather than hidden: the factory's GATE runs
         * before the handler, so a workspace already at its monthly cap is
         * refused here even though this call would have cost nothing. It does
         * not bite in practice, because nothing has to call this to get an
         * existing video — the panel reads `renders.list` and `renders.get`,
         * both plain queries with no limit gate, and shows Download straight
         * off them. This branch is a guard against a stale client or a
         * double-click, not the download path. */
        await incrementUsage(input.organizationId, 'renders', -1, ctx.db)
        return { render: existing, reused: true, cost: null }
      }

      /**
       * SOURCE OF TRUTH KEYWORDS: REFUSE_BEFORE_PAYING, INSUFFICIENT_CREDITS
       *
       * The credit check, and it is deliberately AFTER the reuse check and
       * BEFORE the row. After reuse, because a render that costs nothing must
       * not be refused for lack of credits — the customer already paid for
       * that file. Before the row, because a refusal must leave no trace: a
       * queued `Render` that was never affordable would show in the panel as a
       * render that is about to start and never will.
       *
       * This refuses on the ESTIMATE; the hold is placed by the workflow (see
       * HOLD_IN_THE_WORKFLOW there). The two are separated because the gap
       * between them is small and the alternative is worse: holding here would
       * put a credit movement inside the request's 10-second transaction, and
       * a request that timed out after holding would strand the money with no
       * workflow in existence to release it.
       *
       * The error carries `required` and `available` through the EXISTING
       * `INSUFFICIENT_CREDITS` cause, which has been declared in
       * src/lib/errors with no producer since Phase 00. This is its first.
       * The client renders the top-up prompt straight off it.
       */
      const cost = estimateRenderCost({
        durationSeconds: planComposition(validated.doc).durationInSeconds,
        resolution: input.resolution,
      })

      const available = await getBalance(input.organizationId, ctx.db)
      if (available < cost.total) {
        throw createStructuredError(
          'FORBIDDEN',
          `This render costs ${cost.total} credits and this workspace has ${available}.`,
          {
            errorCode: ERROR_CODES.INSUFFICIENT_CREDITS,
            resource: 'credits',
            required: cost.total,
            available,
            message: `Not enough credits to render. ${cost.total} needed, ${available} available.`,
          },
        )
      }

      const render = await rendersService.createQueuedRender(ctx.db, {
        organizationId: input.organizationId,
        projectId: project.id,
        docHash,
        resolution: input.resolution,
        watermark,
      })

      /* Keyed on the render id, not on the document: a retry of the SAME row
       * must be able to enqueue again (it is a new attempt of a render the
       * customer asked for twice), while a double-click on one request must
       * not produce two runs. The id is unique per row, so both hold. */
      await enqueue({
        name: 'render/requested',
        data: {
          renderId: render.id,
          organizationId: input.organizationId,
          attempt: render.attempts,
        },
        id: `render-${render.id}-attempt-${render.attempts}`,
      })

      /* The cost travels back so the panel can say what the render will cost
       * without re-deriving it — and so the number the customer is told is
       * provably the number that was checked against their balance. */
      return { render, reused: false, cost }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: renders.estimate, COST_ON_THE_BUTTON,
   *   ESTIMATE_IS_A_READ, ONE_PRICE_TWO_SURFACES
   *
   * WHAT:  What rendering this project at this size would cost, and whether
   *        the workspace can currently afford it.
   *
   * WHY:   COST_ON_THE_BUTTON is the phase's own requirement — every
   *        credit-spending action shows its cost in the label. That number has
   *        to come from the SERVER, through the same `estimateRenderCost` the
   *        refusal and the hold use (ONE_PRICE_TWO_SURFACES): a cost computed
   *        in the browser would be a second implementation of pricing, and the
   *        first time the rates changed the button would promise one price
   *        while the handler charged another.
   *
   *        ESTIMATE_IS_A_READ — a query, so it is cheap and repeatable. It
   *        deliberately does NOT sign any asset URLs, which is what makes it
   *        affordable to call on every resolution toggle; `projects.preview`
   *        is the expensive read and this is not it.
   *
   *        It returns the BALANCE alongside the cost so the button can switch
   *        to "Top up credits" without a second round trip, and so the two
   *        numbers it compares were read at the same instant. Fetching them
   *        separately would show "costs 12, you have 11" from two different
   *        moments, which is how a button disables itself for a customer who
   *        just topped up.
   *
   *        A project with no timeline returns `cost: null` rather than
   *        throwing — the panel renders a plain disabled button for a draft
   *        project, and an error toast on a page the customer merely opened
   *        would be noise.
   * WHERE: The render panel's label and its affordability state.
   */
  estimate: protectedProcedure({ requirePermission: permissions.RENDERS_READ })
    .input(estimateRenderSchema)
    .query(async ({ ctx, input }) => {
      const balance = await getBalance(input.organizationId, ctx.db)

      const project = await findProjectWithTimeline(
        ctx.db,
        input.organizationId,
        input.projectId,
      )
      if (!project || project.timeline === null) {
        return { cost: null, balance, affordable: false }
      }

      const migrated = tryMigrate(project.timeline.doc)
      if (!migrated.ok) return { cost: null, balance, affordable: false }

      const cost = estimateRenderCost({
        durationSeconds: planComposition(resolveWordAnchors(migrated.doc)).durationInSeconds,
        resolution: input.resolution,
      })

      return { cost, balance, affordable: balance >= cost.total }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: renders.list
   *
   * WHAT:  A page of renders, for one project or for the whole workspace.
   * WHERE: The render panel's history, polled while anything is unfinished.
   */
  list: protectedProcedure({ requirePermission: permissions.RENDERS_READ, paginate: true })
    .input(listRendersSchema)
    .query(async ({ ctx, input }) => {
      const { skip, take, pageSize } = ctx.pagination
      const page = await rendersService.listRenders(
        ctx.db,
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          status: input.status,
        },
        { skip, take },
      )
      /* SERVER_TOTAL_PAGES — computed against the pageSize the FACTORY clamped
       * to, as in `projects.list`, so the client's pager cannot disagree with
       * the query that produced the rows. */
      return { ...page, totalPages: Math.max(1, Math.ceil(page.total / pageSize)) }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: renders.get, DOWNLOAD_URL_IS_SIGNED_ON_READ
   *
   * WHAT:  One render, with a download URL when there is something to download.
   * WHY:   DOWNLOAD_URL_IS_SIGNED_ON_READ. The URL is signed per request and
   *        never stored — the same rule as everywhere else in this codebase
   *        (URL_NEVER_IN_THE_DOCUMENT), and here it is also what makes
   *        revocation work: deleting the output asset makes every previously
   *        issued link stop working at its TTL rather than never.
   *
   *        `FINAL_URL_TTL_SECONDS` rather than the short default, because this
   *        URL is handed to a browser that will download tens of megabytes
   *        over whatever connection a phone has, and a link that expires
   *        mid-download is a failure the customer cannot explain.
   *
   *        Signing goes through `signAssetUrl`, which re-checks ownership of
   *        the ASSET as well — so a corrupted `outputAssetId` pointing at
   *        another workspace's row produces null, not a cross-tenant read
   *        (SIGNING_BOUNDARY).
   * WHERE: The render panel, for the row it is showing.
   */
  get: protectedProcedure({ requirePermission: permissions.RENDERS_READ })
    .input(getRenderSchema)
    .query(async ({ ctx, input }) => {
      const render = await rendersService.findRenderForOrganization(
        ctx.db,
        input.organizationId,
        input.id,
      )
      if (!render) throw new TRPCError({ code: 'NOT_FOUND', message: 'Render not found' })

      const [downloadUrl, posterUrl] = await Promise.all([
        render.outputAssetId === null
          ? Promise.resolve(null)
          : signAssetUrl(render.outputAssetId, input.organizationId, FINAL_URL_TTL_SECONDS),
        render.posterAssetId === null
          ? Promise.resolve(null)
          : signAssetUrl(render.posterAssetId, input.organizationId, FINAL_URL_TTL_SECONDS),
      ])

      return { render, downloadUrl, posterUrl }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: renders.retry, RETRY_ONCE, FRESH_PROVIDER_ID
   *
   * WHAT:  Sends a failed or timed-out render back to the provider, once.
   * WHY:   RETRY_ONCE. The phase allows exactly one retry, and the limit is
   *        enforced in two places on purpose: the readable refusal is here,
   *        and the `attempts: { lt: limit }` filter inside
   *        `prepareRenderRetry` is what makes two simultaneous clicks produce
   *        one retry rather than two renders. A count of zero from the service
   *        therefore means someone else got there first — it is a conflict,
   *        not a server error.
   *
   *        It is a RETRY of the same row rather than a new render, which is
   *        what keeps the quota honest: the customer asked for one video and
   *        the first attempt failed through no choice of theirs, so a second
   *        attempt must not cost a second slot. The factory bumps the counter
   *        on `create` and nothing else, so retrying is free by construction —
   *        and `attempts` is what stops that being a way to render forever.
   *
   *        The audit template for this verb is keyed `retry` in RESOURCES,
   *        because `writeAuditRow` looks a template up by the PATH verb.
   * WHERE: The "Try again" button on a failed render.
   */
  retry: protectedProcedure({
    requirePermission: permissions.RENDERS_CREATE,
    audit: { action: 'retry' },
  })
    .input(retryRenderSchema)
    .mutation(async ({ ctx, input }) => {
      const render = await rendersService.findRenderForOrganization(
        ctx.db,
        input.organizationId,
        input.id,
      )
      if (!render) throw new TRPCError({ code: 'NOT_FOUND', message: 'Render not found' })

      if (render.status !== 'failed' && render.status !== 'timedOut') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Only a failed render can be retried.',
        })
      }

      if (render.attempts >= RENDER_ATTEMPT_LIMIT) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'This render has already been retried once. Start a new render, or contact support if it keeps failing.',
        })
      }

      const updated = await rendersService.prepareRenderRetry(
        ctx.db,
        render.id,
        RENDER_ATTEMPT_LIMIT,
      )
      if (updated === 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This render has already been retried. Refresh to see its current state.',
        })
      }

      const attempt = render.attempts + 1

      await enqueue({
        name: 'render/requested',
        data: {
          renderId: render.id,
          organizationId: input.organizationId,
          attempt,
        },
        /* The attempt number is in the key, so this is a DIFFERENT event from
         * the one the first attempt sent — without it the retry would
         * deduplicate against the original run and nothing would happen, which
         * presents as a button that does nothing. */
        id: `render-${render.id}-attempt-${attempt}`,
      })

      return { id: render.id, attempts: attempt }
    }),
})
