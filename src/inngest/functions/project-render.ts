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
 * SOURCE OF TRUTH KEYWORDS: projectRenderFunction, render/requested,
 *   project.render, WAIT_DONT_POLL, START_AND_AWAIT_ARE_DIFFERENT_STEPS,
 *   PREFLIGHT_BEFORE_PAYING, WORKFLOW_RECHECKS_OWNERSHIP,
 *   KEY_MISMATCH_IS_A_STALE_RENDER, FINALIZE_DOES_THE_COPY,
 *   PERMANENT_VS_TRANSIENT_FAILURE, RENDER_TIMEOUT
 *
 * WHAT:  The render pipeline: check the request is still valid, prove every
 *        asset is fetchable, hand the document to the renderer, wait for the
 *        provider's webhook, then store the output as an asset.
 *
 * WHY:   WAIT_DONT_POLL is the phase's central requirement and it is why this
 *        file is shaped the way it is. `step.waitForEvent` suspends the run
 *        entirely — no process, no timer, no cost — until the webhook relays
 *        `render/finished`. A polling loop would hold a step open
 *        across a forty-minute render, and `maxDuration` on
 *        src/app/api/inngest/route.ts bounds ONE STEP at five minutes, so it
 *        would not merely be wasteful: it would time out and retry from the
 *        top, starting a second paid render of the same video.
 *
 *        START_AND_AWAIT_ARE_DIFFERENT_STEPS, for the same reason. The
 *        provider call that returns in a second is one step; the wait that
 *        lasts as long as the render is another. Collapsing them is the
 *        mistake the five-minute budget punishes.
 *
 *        PREFLIGHT_BEFORE_PAYING, the phase's step 5. Every asset is resolved
 *        to a signed URL with a TTL longer than the render timeout AND
 *        confirmed present in the bucket BEFORE the render starts. The failure
 *        this prevents is the expensive one: a render that burns forty minutes
 *        of parallel Lambda and then produces a video with a hole in it,
 *        because one clip had been deleted since the document referenced it.
 *        Checking costs one HEAD per asset.
 *
 *        WORKFLOW_RECHECKS_OWNERSHIP, the phase's step 10. This runs OUTSIDE
 *        `protectedProcedure` and inherits none of its gates — no membership
 *        check, no permission check, no plan gate. So it trusts the event for
 *        exactly one thing, the renderId, and takes the organizationId from
 *        the ROW; every subsequent read is scoped to that. An event that
 *        crossed a queue is JSON, possibly from an older deploy, and the one
 *        thing it must not be is the authority on who owns what.
 *
 *        FINALIZE_DOES_THE_COPY, and this is a deliberate correction to the
 *        phase's step 6, which has the WEBHOOK store the MP4 and the poster as
 *        assets before sending the event. It should not, for three reasons
 *        that all point the same way:
 *
 *          1. The webhook is a serverless request with the tightest budget in
 *             the system, and the copy is tens of megabytes down from the
 *             provider and back up to R2, plus an ffmpeg invocation for the
 *             poster — which is precisely the work FFMPEG_RUNS_IN_A_CONTAINER
 *             says must not happen in a function.
 *          2. Remotion retries a webhook that does not return 2xx, so a slow
 *             copy produces a SECOND delivery while the first is still
 *             running, and two concurrent copies of one render.
 *          3. If the copy fails there, the event is never sent, and this
 *             workflow waits out its full 45 minutes and records `timedOut` —
 *             reporting a storage failure as a render timeout, which sends
 *             whoever investigates to the wrong system entirely.
 *
 *        So the webhook does the one thing only it can do — verify the
 *        signature and relay the news — and the copy happens HERE, in a
 *        resumable step with retries, in the container that already has
 *        ffmpeg. The phase's intent (the output ends up as a `render_output`
 *        asset) is unchanged; only the place it happens is.
 *
 *        PERMANENT_VS_TRANSIENT_FAILURE, exactly as in the ingest workflow: a
 *        broken document, a missing project or a misconfigured renderer will
 *        not improve by being retried, so they mark the row `failed` with a
 *        readable reason and raise `NonRetriableError`. A provider blip or a
 *        storage hiccup throws normally and lets Inngest retry with backoff.
 *        On a PAID render getting this backwards is worse than it is for an
 *        ingest: a retried permanent failure is three renders billed for one
 *        video that was never going to work.
 * WHERE: Registered in src/inngest/functions/index.ts, served at /api/inngest.
 *        Triggered by `render/requested`, sent by `renders.create` and
 *        `renders.retry`.
 */

import { NonRetriableError } from 'inngest'
import { z } from 'zod'

import { inngestClient } from '@/lib/adapters/jobs/inngest/client'
import { getMediaAdapter } from '@/lib/adapters/media'
import { MediaProcessingError } from '@/lib/adapters/media/types'
import { getRenderAdapter, RenderProviderError } from '@/lib/adapters/render'
import { getStorageAdapter, renderKey } from '@/lib/adapters/storage'
import { prisma } from '@/lib/config/prisma'
import { APP_URL } from '@/lib/config/branding'
import { getRemotionWebhookSecret } from '@/lib/adapters/render/lambda/config'
import {
  downloadUrlToFile,
  uploadFile,
  withStagingDir,
} from '@/lib/media'
import { collectAssetHandles, planComposition, renderCacheKey } from '@/lib/render'
import { resolveWordAnchors, tryMigrate, validate, type TimelineDoc } from '@/lib/timeline'
import {
  assetUrlMapSchema,
  renderResolutionSchema,
  type AssetUrlMap,
  type RenderResolution,
} from '@/lib/types/render'
import { signDocumentAssets } from '@/services/assets.service'
import { findProjectWithTimeline } from '@/services/projects.service'
import {
  completeRender,
  createRenderOutputAsset,
  failRender,
  findRenderById,
  markRenderProgress,
  markRenderStarted,
} from '@/services/renders.service'
import { estimateRenderCost } from '@/lib/credits'
import {
  InsufficientCreditsError,
  commit,
  findOpenHoldForRef,
  hold,
  release,
} from '@/services/credits.service'

/**
 * SOURCE OF TRUTH KEYWORDS: renderRequestedEventSchema, EVENT_PAYLOAD_PARSED
 *
 * WHAT:  The shape of a `render/requested` event's data.
 * WHY:   EVENT_PAYLOAD_PARSED, the same rule as the ingest workflow:
 *        `JobEvent.data` is `Record<string, unknown>` by contract because it
 *        crosses a queue, so it arrives as JSON with no types attached and may
 *        have been enqueued by an older deploy. Reading
 *        `event.data.renderId as string` would turn a renamed field into a
 *        Prisma query for `undefined`.
 * WHERE: The first act of the handler below.
 */
const renderRequestedEventSchema = z.object({
  renderId: z.string().min(1),
  organizationId: z.string().min(1),
  /* Carried for the log line and the idempotency key, NOT trusted as the
   * attempt number — the row's own `attempts` is the authority. */
  attempt: z.number().int().positive().optional(),
})

/**
 * SOURCE OF TRUTH KEYWORDS: renderFinishedEventSchema, WEBHOOK_RELAY_PAYLOAD
 *
 * WHAT:  What the webhook relays onto the queue when the provider calls back.
 * WHY:   A closed shape rather than the provider's whole payload, because this
 *        is OUR contract between two of our own modules — the route and this
 *        workflow — and the provider's payload is a much larger object whose
 *        fields change between major versions. The route translates once; this
 *        workflow never learns what Remotion's webhook looks like.
 *
 *        `outcome` is the app's vocabulary and not the provider's three
 *        payload types, for the same reason RenderProgressResult is: the
 *        decision this workflow makes is "store it", "fail it" or "time it
 *        out", and a provider with four failure modes must collapse them into
 *        those in the route.
 * WHERE: Sent by src/app/api/webhooks/remotion/route.ts; awaited below.
 */
const renderFinishedEventSchema = z.object({
  renderId: z.string().min(1),
  outcome: z.enum(['success', 'error', 'timeout']),
  outputUrl: z.string().min(1).nullable(),
  error: z.string().nullable(),
})

/**
 * SOURCE OF TRUTH KEYWORDS: failureEventSchema, inngest/function.failed
 *
 * WHAT:  The shape `onFailure` receives — the engine's failure event, which
 *        carries the ORIGINAL event nested inside it.
 * WHY:   The nesting is one level deeper than it looks, and getting it wrong
 *        means the failure handler reads `undefined` and leaves a render
 *        spinning forever. Same shape and same reason as the ingest workflow's.
 * WHERE: The onFailure handler below.
 */
const failureEventSchema = z.object({
  data: z.object({
    event: z.object({ data: renderRequestedEventSchema }),
  }),
})

/**
 * SOURCE OF TRUTH KEYWORDS: preflightFactsSchema, STEP_RESULTS_ARE_JSON
 *
 * WHAT:  The facts carried from the validate step into the later ones.
 * WHY:   STEP_RESULTS_ARE_JSON. A step's return value is serialised, stored
 *        and replayed on retry, so what a resumed run receives is JSON rather
 *        than the object the step returned — a `Date` arrives as a string.
 *        Re-parsing at the boundary is what makes the replayed value and the
 *        fresh value the same thing.
 *
 *        It deliberately does NOT carry the document. Keeping step payloads
 *        small is the rule (JobsAdapter's "ids, never documents"), and a
 *        timeline with a word-level transcript is the largest thing in this
 *        system; a step that needs the document re-reads it through
 *        `loadRenderInputs`, which costs one indexed query and re-proves the
 *        cache key at the same time.
 * WHERE: Passed from `validate` into `resolve-assets` and `start-render`.
 */
const preflightFactsSchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  docHash: z.string(),
  resolution: renderResolutionSchema,
  watermark: z.boolean(),
  durationInFrames: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationInSeconds: z.number().positive(),
})

type PreflightFacts = z.infer<typeof preflightFactsSchema>

/** How long a render may take before it is written off. The phase's figure. */
const RENDER_TIMEOUT = '45m'

/** The signed-URL TTL must outlive this; see FINAL_URL_TTL_SECONDS (6 hours). */

export const projectRenderFunction = inngestClient.createFunction(
  {
    id: 'project-render',
    name: 'Render a project in the cloud',
    triggers: [{ event: 'render/requested' }],
    /* Two attempts, not the default four. Every attempt of this workflow can
     * START A PAID RENDER, so the arithmetic is different from an ingest's:
     * the failures worth retrying here are reaching the provider at all, which
     * clears immediately or not at all, and the permanent ones already raise
     * NonRetriableError before they can be retried. */
    retries: 2,
    /* Two renders at a time per WORKSPACE. Higher than the ingest's one
     * because a render costs us nothing locally — the work happens in the
     * provider's functions, not in this container — but not unbounded, because
     * `renders.create` is cheap and a stuck client could otherwise have a
     * hundred renders in flight before the monthly cap noticed. */
    concurrency: { key: 'event.data.organizationId', limit: 2 },
    /**
     * A run that exhausts its retries still has to leave the row honest, or
     * the customer watches a progress bar that will never move again. This is
     * the net under every TRANSIENT failure; permanent ones have already
     * written their own message by the time they are raised.
     */
    onFailure: async ({ event }) => {
      const parsed = failureEventSchema.safeParse(event)
      if (!parsed.success) {
        console.error('[project.render] Failure handler could not read the original event.')
        return
      }
      await failRenderAndRelease(
        prisma,
        parsed.data.data.event.data.renderId,
        'failed',
        'Rendering this video did not finish. Please try again.',
      )
    },
  },
  async ({ event, step }) => {
    const input = renderRequestedEventSchema.safeParse(event.data)
    if (!input.success) {
      /* A malformed event cannot be fixed by retrying it, and there is no id
       * to mark failed — so the only useful thing is to stop loudly. */
      throw new NonRetriableError(
        `[project.render] Event payload is not valid: ${input.error.message}`,
      )
    }
    const { renderId } = input.data

    // ───────────────────────────────────────────────────────────────────────
    // [1] VALIDATE — is this request still something we should pay for?
    //     Re-reads the row and the project from the database, re-derives the
    //     cache key, and refuses anything that has changed underneath.
    //     Everything downstream may assume the document renders.
    // ───────────────────────────────────────────────────────────────────────
    const facts = await step.run('validate', async () => {
      const loaded = await loadRenderInputs(renderId)

      const plan = planComposition(loaded.doc)

      return {
        organizationId: loaded.render.organizationId,
        projectId: loaded.render.projectId,
        docHash: loaded.render.docHash,
        resolution: loaded.resolution,
        watermark: loaded.render.watermark,
        durationInFrames: plan.durationInFrames,
        width: plan.width,
        height: plan.height,
        durationInSeconds: plan.durationInSeconds,
      }
    })

    const preflight = preflightFactsSchema.parse(facts)

    // ───────────────────────────────────────────────────────────────────────
    // [2] RESOLVE ASSETS — PREFLIGHT_BEFORE_PAYING. Sign a long-lived URL per
    //     asset and prove each object is really in the bucket, before a single
    //     Lambda is invoked.
    // ───────────────────────────────────────────────────────────────────────
    const signed = await step.run('resolve-assets', async () => {
      const loaded = await loadRenderInputs(renderId)

      const handles = collectAssetHandles(loaded.doc)

      /* `final` is the whole point of the quality parameter: it reads the
       * `vertical_1080` masters rather than the proxies the browser scrubs,
       * and signs them for six hours — longer than RENDER_TIMEOUT, because the
       * renderer may queue behind other jobs and then fetch, and this process
       * cannot re-sign for it. See TTL_BY_QUALITY. */
      const assets = await signDocumentAssets(
        prisma,
        handles,
        loaded.render.organizationId,
        'final',
      )

      await assertAssetsAreFetchable(assets)

      return assets
    })

    const assets = assetUrlMapSchema.parse(signed)

    // ───────────────────────────────────────────────────────────────────────
    // [3] HOLD CREDITS — HOLD_IN_THE_WORKFLOW. The money is reserved here,
    //     after everything that could still refuse the render for free and
    //     immediately before the provider is called.
    // ───────────────────────────────────────────────────────────────────────
    /* The returned hold id is deliberately NOT carried through the rest of the
     * run. Every later step that settles it — the commit in `finalize`, the
     * refund in `failRenderAndRelease` — looks the hold up by the RENDER ID
     * through `findOpenHoldForRef`, because most of those paths cannot have
     * been handed a holdId: `onFailure` receives only the original event, and
     * a replayed step gets its own fresh locals. One lookup rule, reachable
     * from everywhere, beats a value that half the paths do not have. The step
     * still returns it so it shows in the run's own output when debugging. */
    await step.run('hold-credits', () => holdRenderCredits(renderId, preflight))

    // ───────────────────────────────────────────────────────────────────────
    // [4] START RENDER — one provider round-trip, its own step. Returns as
    //     soon as the render is accepted; see
    //     START_AND_AWAIT_ARE_DIFFERENT_STEPS.
    // ───────────────────────────────────────────────────────────────────────
    await step.run('start-render', async () => {
      const loaded = await loadRenderInputs(renderId)

      const secret = getRemotionWebhookSecret()
      if (secret === null) {
        /* Permanent: without a secret the provider sends the literal string
         * `NO_SECRET_PROVIDED` as its signature, the webhook refuses it, and
         * the render stalls until the timeout — having been fully paid for.
         * Refusing to START is strictly cheaper than discovering this in 45
         * minutes. */
        await failRenderAndRelease(
          prisma,
          renderId,
          'failed',
          'This video could not be rendered. Please contact support — the renderer is misconfigured.',
        )
        throw new NonRetriableError(
          '[project.render] REMOTION_WEBHOOK_SECRET is not set, so a render could not report back.',
        )
      }

      const adapter = await getRenderAdapter()

      let started
      try {
        started = await adapter.start(loaded.doc, {
          assets,
          /* From the ROW, not re-resolved here — see WATERMARK_RESOLVED_ONCE
           * in src/trpc/routers/renders.ts. The value is inside the cache key,
           * so asking the entitlement again could produce a file that does not
           * match the key it will be stored under. */
          watermark: loaded.render.watermark,
          resolution: loaded.resolution,
          /* WEBHOOK_URL_IS_AN_INPUT: resolved from the DEPLOYMENT's own base
           * URL, so a preview deployment's renders report back to that preview
           * and not to production. `APP_URL` is the one place that value
           * lives. Note the consequence in development: localhost is not
           * reachable from AWS, so a local render needs a tunnel — recorded
           * in the setup checklist's help text for this integration. */
          webhookUrl: `${APP_URL.replace(/\/$/, '')}/api/webhooks/remotion`,
          webhookSecret: secret,
          /* How the callback finds this row. The provider knows its own render
           * id and nothing about a `Render`; this travels out and comes home. */
          customData: { renderId },
        })
      } catch (error) {
        if (error instanceof RenderProviderError) {
          console.error(`[project.render] ${renderId} start failed:`, error.detail)
          if (error.permanent) {
            await failRenderAndRelease(prisma, renderId, 'failed', error.message)
            throw new NonRetriableError(error.message)
          }
          /* Transient — thrown plainly so Inngest retries with backoff. The row
           * stays `queued`, which is the truth: nothing has started. */
          throw error
        }
        throw error
      }

      /* The status filter inside this is what makes it safe — a render
       * cancelled while the provider call was in flight is not dragged back to
       * `rendering`. A count of zero is worth knowing about but is not a
       * failure: the provider has accepted the work either way. */
      const moved = await markRenderStarted(prisma, renderId, started.providerRenderId)
      if (moved === 0) {
        console.warn(
          `[project.render] ${renderId} was no longer queued when the provider accepted it; ` +
            'leaving its current status alone.',
        )
      }

      return { providerRenderId: started.providerRenderId }
    })

    // ───────────────────────────────────────────────────────────────────────
    // [4] WAIT — WAIT_DONT_POLL. The run suspends here, costing nothing, until
    //     the webhook relays the provider's callback or the timeout elapses.
    // ───────────────────────────────────────────────────────────────────────
    const finished = await step.waitForEvent('await-render', {
      event: 'render/finished',
      timeout: RENDER_TIMEOUT,
      /* Matched on the renderId so one waiting run cannot be resumed by
       * another render's callback. Without this, two concurrent renders in one
       * workspace would race and each could finalize the other's output. */
      if: `async.data.renderId == "${renderId}"`,
    })

    // ───────────────────────────────────────────────────────────────────────
    // [5] FINALIZE — store the output as an asset, or record why there is
    //     none. FINALIZE_DOES_THE_COPY.
    // ───────────────────────────────────────────────────────────────────────
    if (finished === null) {
      /* RENDER_TIMEOUT. Nothing called back inside the window. That does NOT
       * by itself mean the render failed — a dropped webhook looks identical
       * from here — so the one sanctioned use of getProgress asks the provider
       * directly before writing anything off (PROGRESS_IS_FOR_THE_TIMEOUT_PATH). */
      return await step.run('finalize-timeout', () => resolveTimedOutRender(renderId, preflight))
    }

    const outcome = renderFinishedEventSchema.safeParse(finished.data)
    if (!outcome.success) {
      /* The webhook is ours, so this is a bug in our own relay rather than
       * untrusted input — but the render has already been paid for, so it must
       * still land on the row as a readable failure rather than as a run that
       * vanished. */
      return await step.run('finalize-unreadable', async () => {
        await failRenderAndRelease(
          prisma,
          renderId,
          'failed',
          'This render finished but its result could not be read. Please contact support.',
        )
        throw new NonRetriableError(
          `[project.render] The render.finished event did not parse: ${outcome.error.message}`,
        )
      })
    }

    if (outcome.data.outcome !== 'success' || outcome.data.outputUrl === null) {
      return await step.run('finalize-failed', async () => {
        await failRenderAndRelease(
          prisma,
          renderId,
          outcome.data.outcome === 'timeout' ? 'timedOut' : 'failed',
          outcome.data.error ??
            'This video could not be rendered. Please try again, or contact support if it keeps failing.',
        )
        return { renderId, status: outcome.data.outcome }
      })
    }

    const outputUrl = outcome.data.outputUrl

    return await step.run('finalize', () => storeRenderOutput(renderId, outputUrl, preflight))
  },
)

/**
 * SOURCE OF TRUTH KEYWORDS: loadRenderInputs, KEY_MISMATCH_IS_A_STALE_RENDER,
 *   WORKFLOW_RECHECKS_OWNERSHIP
 *
 * WHAT:  Loads the render row and its project's resolved, validated document,
 *        and proves the two still agree.
 *
 * WHY:   KEY_MISMATCH_IS_A_STALE_RENDER is the check worth reading twice. The
 *        cache key was computed in the request that asked for this render; the
 *        document can be edited between then and now (Phase 15's editor, or a
 *        regeneration). If it has been, rendering the CURRENT document and
 *        storing it under the OLD key would poison the cache permanently: that
 *        key would thereafter return a video of a document it does not
 *        describe, and no amount of re-rendering would dislodge it, because
 *        the row already says `completed`. Refusing is the only safe answer —
 *        the customer re-requests and gets a fresh row with the right key.
 *
 *        It is also why every step that needs the document calls THIS rather
 *        than receiving it: each step re-proves the agreement at the moment it
 *        acts, instead of trusting a fact established before a retry that may
 *        have been minutes ago.
 *
 *        WORKFLOW_RECHECKS_OWNERSHIP: the organizationId comes off the ROW and
 *        is then used to scope the project read, so a forged or stale event
 *        cannot make this render another workspace's project. The row is the
 *        authority; the event is not.
 * WHERE: Steps 1, 2 and 3 above.
 */
async function loadRenderInputs(renderId: string): Promise<{
  render: NonNullable<Awaited<ReturnType<typeof findRenderById>>>
  doc: TimelineDoc
  resolution: RenderResolution
}> {
  const render = await findRenderById(prisma, renderId)
  if (render === null) {
    /* The row was deleted while the event was in flight — the project went
     * with it, most likely. Nothing to mark failed and nothing to retry. */
    throw new NonRetriableError(`[project.render] Render ${renderId} no longer exists.`)
  }

  const resolution = renderResolutionSchema.safeParse(render.resolution)
  if (!resolution.success) {
    await failRenderAndRelease(prisma, renderId, 'failed', 'This render asked for an unsupported quality.')
    throw new NonRetriableError(
      `[project.render] Render ${renderId} has resolution "${render.resolution}".`,
    )
  }

  const project = await findProjectWithTimeline(
    prisma,
    render.organizationId,
    render.projectId,
  )
  if (project === null || project.timeline === null) {
    await failRenderAndRelease(
      prisma,
      renderId,
      'failed',
      'The project this render belongs to no longer has a timeline.',
    )
    throw new NonRetriableError(
      `[project.render] Project ${render.projectId} has no timeline to render.`,
    )
  }

  const migrated = tryMigrate(project.timeline.doc)
  if (!migrated.ok) {
    await failRenderAndRelease(
      prisma,
      renderId,
      'failed',
      'This timeline was written in a format this version cannot open, so it cannot be rendered.',
    )
    throw new NonRetriableError(
      `[project.render] Timeline for ${render.projectId} could not be migrated.`,
    )
  }

  /* Resolve, THEN validate — the same order as `projects.preview` and
   * `renders.create`, because an anchored document has no absolute times and
   * validating one would reject every voiceover project. */
  const resolved = resolveWordAnchors(migrated.doc)
  const validated = validate(resolved)
  if (!validated.ok) {
    await failRenderAndRelease(
      prisma,
      renderId,
      'failed',
      `This timeline cannot be rendered: ${validated.errors[0]?.message ?? 'it is not valid.'}`,
    )
    throw new NonRetriableError(
      `[project.render] Timeline for ${render.projectId} is not valid: ` +
        `${validated.errors.map((issue) => `${issue.path}: ${issue.code}`).join('; ')}`,
    )
  }

  const currentKey = renderCacheKey({
    doc: validated.doc,
    resolution: resolution.data,
    watermark: render.watermark,
  })
  if (currentKey !== render.docHash) {
    /* KEY_MISMATCH_IS_A_STALE_RENDER — see the WHY above. */
    await failRenderAndRelease(
      prisma,
      renderId,
      'failed',
      'This project changed after the render was requested. Please render it again.',
    )
    throw new NonRetriableError(
      `[project.render] ${renderId} was requested for key ${render.docHash} but the project now ` +
        `hashes to ${currentKey}. Refusing to store a render under a key it does not match.`,
    )
  }

  return { render, doc: validated.doc, resolution: resolution.data }
}

/**
 * SOURCE OF TRUTH KEYWORDS: assertAssetsAreFetchable, PREFLIGHT_BEFORE_PAYING
 *
 * WHAT:  Proves every resolved asset actually exists in the bucket.
 * WHY:   PREFLIGHT_BEFORE_PAYING. `signDocumentAssets` returns `url: null` for
 *        an asset it could not resolve (MISSING_ASSET_IS_NOT_AN_ERROR) — which
 *        is the right behaviour for a PREVIEW, where a hole in the timeline is
 *        better than a blank screen, and the wrong behaviour for a render the
 *        customer is being charged for. A paid export with a missing clip is
 *        a refund; refusing before the first Lambda is invoked costs a HEAD.
 *
 *        The HEAD is the second half and the one that catches the real case: a
 *        signed URL is produced by local HMAC and signing SUCCEEDS for an
 *        object that is not there, so a row pointing at a deleted object
 *        yields a perfectly valid URL that 404s inside the renderer, forty
 *        minutes from now.
 *
 *        Assets whose URL points outside our bucket are not checked — there
 *        are none today, and a future stock-footage provider's URL is not
 *        something `storage.head` can answer about. Grep this symbol if that
 *        changes.
 * WHERE: The `resolve-assets` step.
 */
async function assertAssetsAreFetchable(assets: AssetUrlMap): Promise<void> {
  const unresolved = Object.entries(assets)
    .filter(([, asset]) => asset.url === null)
    .map(([handle]) => handle)

  if (unresolved.length > 0) {
    throw new RenderProviderError(
      `This video is missing ${unresolved.length} of its media files and cannot be rendered. ` +
        'Re-upload or replace them, then try again.',
      {
        detail: `[project.render] Unresolved asset handles: ${unresolved.join(', ')}.`,
        permanent: true,
      },
    )
  }

  const storage = await getStorageAdapter()
  const rows = await prisma.assetVariant.findMany({
    where: {
      asset: { id: { in: Object.values(assets).map((asset) => asset.assetId) } },
    },
    select: { assetId: true, variant: true, storageKey: true },
  })

  const keyFor = new Map<string, string>()
  for (const row of rows) keyFor.set(`${row.assetId}:${row.variant}`, row.storageKey)

  const missing: string[] = []
  for (const [handle, asset] of Object.entries(assets)) {
    /* An asset resolved to its OWN object rather than a variant has
     * `variant: null`; there is no variant row to look a key up by, and the
     * URL came straight from `Asset.storageKey`, which the row proves exists
     * as a record. The HEAD below is about variants, which are produced by a
     * workflow that can fail halfway. */
    if (asset.variant === null) continue

    const key = keyFor.get(`${asset.assetId}:${asset.variant}`)
    if (key === undefined) {
      missing.push(handle)
      continue
    }

    const head = await storage.head(key)
    if (head === null) missing.push(handle)
  }

  if (missing.length > 0) {
    throw new RenderProviderError(
      `This video is missing ${missing.length} of its media files and cannot be rendered. ` +
        'Re-upload or replace them, then try again.',
      {
        detail: `[project.render] Asset handles whose objects are absent from storage: ${missing.join(', ')}.`,
        permanent: true,
      },
    )
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: storeRenderOutput, FINALIZE_DOES_THE_COPY,
 *   OUTPUT_IS_COPIED_NOT_SERVED, POSTER_FROM_THE_OUTPUT,
 *   ASSETS_AND_STATUS_IN_ONE_TRANSACTION
 *
 * WHAT:  Copies the finished MP4 into R2, makes a poster from it, records both
 *        as assets and marks the render complete.
 *
 * WHY:   OUTPUT_IS_COPIED_NOT_SERVED. The provider's bucket is not our storage
 *        and we do not hand its URLs to customers: it has a different lifecycle
 *        (Remotion expires render output), a different access model, and
 *        nothing in the product knows how to delete from it. One copy into R2
 *        and everything downstream — signing, the media library, deletion,
 *        byte accounting — works the way it does for every other asset.
 *
 *        POSTER_FROM_THE_OUTPUT. The poster is a frame EXTRACTED from the
 *        rendered file with the existing media adapter, not a second
 *        `renderStillOnLambda` call. Two reasons, and the second is the real
 *        one: a still render is a second paid provider invocation for one
 *        image, and — because it renders the composition again rather than
 *        reading the video — it could disagree with the frame actually in the
 *        output. A frame taken from the file cannot. The file is already on
 *        local disk at this point, so the extraction is nearly free.
 *
 *        ASSETS_AND_STATUS_IN_ONE_TRANSACTION. The two Asset rows and the
 *        render's `completed` status commit together. If they did not, the gap
 *        between them is a `completed` render whose `outputAssetId` is null —
 *        a download button that 404s, and worse, a row `findReusableRender`
 *        would hand to every future request for that document.
 *
 *        The bytes are deliberately NOT charged to the `storage` quota; see
 *        RENDERS_ARE_NOT_METERED_ON_STORAGE on createRenderOutputAsset.
 * WHERE: The `finalize` step.
 */
async function storeRenderOutput(
  renderId: string,
  outputUrl: string,
  preflight: PreflightFacts,
): Promise<{ renderId: string; outputAssetId: string; bytes: number }> {
  const render = await findRenderById(prisma, renderId)
  if (render === null) {
    throw new NonRetriableError(`[project.render] Render ${renderId} no longer exists.`)
  }

  /* Already finalised — a duplicate webhook, which is normal at-least-once
   * behaviour rather than a fault. Returning rather than throwing keeps the
   * run green; `completeRender`'s status filter would have refused the write
   * anyway, but doing the copy twice would have cost the bandwidth first. */
  if (render.status === 'completed' && render.outputAssetId !== null) {
    return { renderId, outputAssetId: render.outputAssetId, bytes: 0 }
  }

  return withStagingDir(async (dir) => {
    const videoPath = dir.file('output.mp4')
    const posterPath = dir.file('poster.jpg')

    const bytes = await downloadUrlToFile(outputUrl, videoPath, 'the rendered video')

    const videoKey = renderKey(
      render.organizationId,
      render.projectId,
      render.id,
      'output.mp4',
    )
    await uploadFile({ localPath: videoPath, storageKey: videoKey, contentType: 'video/mp4' })

    /* POSTER_FROM_THE_OUTPUT. Best-effort: a render with no thumbnail is a
     * tile that falls back to an icon, which is a cosmetic loss — failing the
     * whole finalize over it would throw away a video that rendered perfectly
     * and has already been paid for. */
    let posterKey: string | null = null
    try {
      const media = await getMediaAdapter()
      await media.extractFrame({
        inputPath: videoPath,
        outputPath: posterPath,
        /* A tenth of a second in rather than frame zero: the first frame of a
         * video that fades in is black, and a black thumbnail reads as a
         * broken render. */
        atSec: Math.min(0.1, preflight.durationInSeconds / 2),
        width: preflight.width,
      })
      posterKey = renderKey(
        render.organizationId,
        render.projectId,
        render.id,
        'poster.jpg',
      )
      await uploadFile({
        localPath: posterPath,
        storageKey: posterKey,
        contentType: 'image/jpeg',
      })
    } catch (error) {
      posterKey = null
      const detail = error instanceof MediaProcessingError ? error.detail : String(error)
      console.error(`[project.render] ${renderId} poster extraction failed:`, detail)
    }

    /* ASSETS_AND_STATUS_IN_ONE_TRANSACTION — see the WHY above. */
    return prisma.$transaction(async (tx) => {
      const outputAsset = await createRenderOutputAsset(tx, {
        organizationId: render.organizationId,
        filename: `render-${render.id}.mp4`,
        storageKey: videoKey,
        contentType: 'video/mp4',
        bytes,
        durationSec: preflight.durationInSeconds,
        width: preflight.width,
        height: preflight.height,
      })

      const posterAsset =
        posterKey === null
          ? null
          : await createRenderOutputAsset(tx, {
              organizationId: render.organizationId,
              filename: `render-${render.id}-poster.jpg`,
              storageKey: posterKey,
              contentType: 'image/jpeg',
              /* Not measured: the poster is not charged to any quota and
                 nothing sizes a layout from it, so a HEAD to learn a number
                 with no reader would be a round-trip for nothing. */
              bytes: 0,
              width: preflight.width,
            })

      const moved = await completeRender(tx, render.id, {
        outputAssetId: outputAsset.id,
        posterAssetId: posterAsset?.id ?? null,
      })
      if (moved === 0) {
        /* Something terminal happened to the row between the read at the top
         * of this function and now — a timeout write, most likely. Rolling the
         * transaction back is correct: the alternative is two Asset rows for a
         * render that is not completed, which nothing would ever clean up. */
        throw new NonRetriableError(
          `[project.render] ${renderId} was no longer rendering when its output was stored.`,
        )
      }

      /**
       * SOURCE OF TRUTH KEYWORDS: COMMIT_WITH_THE_OUTPUT, CHARGE_WHAT_IT_COST
       *
       * The charge lands in the SAME transaction as the asset rows and the
       * `completed` status. That is the point: a committed charge with no
       * video, or a video with no charge, are both reachable the moment these
       * are two transactions — and the first is a customer paying for nothing,
       * which is exactly what this phase exists to prevent.
       *
       * CHARGE_WHAT_IT_COST: the cost is re-estimated from the render's REAL
       * output duration rather than reusing the held amount. Today the two are
       * equal, because the duration is known before the render starts. They
       * stop being equal the moment anything makes the real length differ from
       * the planned one, and `commit` already handles that — it writes the
       * actual and releases the difference (PARTIAL_RELEASE). Committing the
       * held amount instead would make every estimate a flat price and hide
       * the divergence permanently.
       *
       * A missing hold is not an error. `findOpenHoldForRef` returns nothing
       * when this step is replayed after the commit already happened, and
       * `commit` itself refuses a second settlement — so a retried finalize
       * charges once (DOUBLE_COMMIT_REFUSED).
       */
      const actual = estimateRenderCost({
        durationSeconds: preflight.durationInSeconds,
        resolution: preflight.resolution,
      })

      const openHold = await findOpenHoldForRef(tx, render.id)
      if (openHold !== null) {
        await commit(tx, openHold.id, actual.total, {
          kind: 'render',
          renderId: render.id,
          breakdown: actual.lines,
        })
      }

      /* Phase 04 left these null and said Phase 05 would fill them. This is
       * that. Written in the same transaction as the ledger movement, so the
       * number on the render and the number in the ledger cannot disagree. */
      await tx.render.update({
        where: { id: render.id },
        data: {
          creditsCharged: actual.total,
          costBreakdown: { total: actual.total, lines: actual.lines },
        },
      })

      return { renderId, outputAssetId: outputAsset.id, bytes, creditsCharged: actual.total }
    })
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveTimedOutRender, RENDER_TIMEOUT,
 *   PROGRESS_IS_FOR_THE_TIMEOUT_PATH, A_DROPPED_WEBHOOK_IS_NOT_A_FAILED_RENDER
 *
 * WHAT:  Decides what a render that never called back actually is.
 * WHY:   A_DROPPED_WEBHOOK_IS_NOT_A_FAILED_RENDER. From inside the wait, a
 *        render that died and a render that finished while our webhook was
 *        briefly unreachable look identical — and they call for opposite
 *        actions. Writing `timedOut` without asking would throw away a video
 *        that exists and has been paid for, and then invite the customer to
 *        spend their one retry re-rendering it.
 *
 *        So this is the ONE sanctioned call to `getProgress`
 *        (PROGRESS_IS_FOR_THE_TIMEOUT_PATH): a single question at the end of
 *        the window, not a loop. If the provider says the render completed, it
 *        is stored exactly as the webhook path would have stored it; if it
 *        failed, the provider's own reason is recorded, which is far more
 *        useful than "timed out"; and only if it is genuinely still running
 *        after 45 minutes does the row become `timedOut` — which is then an
 *        honest statement about the renderer rather than a guess.
 * WHERE: The `finalize-timeout` step.
 */
async function resolveTimedOutRender(
  renderId: string,
  preflight: PreflightFacts,
): Promise<{ renderId: string; status: string }> {
  const render = await findRenderById(prisma, renderId)
  if (render === null) {
    throw new NonRetriableError(`[project.render] Render ${renderId} no longer exists.`)
  }

  if (render.providerRenderId === null) {
    /* Never started — so there is nothing to ask about. The row is still
     * `queued`, which means the start step did not complete, and the wait
     * expiring is the first thing to notice it. */
    await failRenderAndRelease(
      prisma,
      renderId,
      'timedOut',
      'This render never started. Please try again.',
    )
    return { renderId, status: 'timedOut' }
  }

  const adapter = await getRenderAdapter()
  const progress = await adapter.getProgress(render.providerRenderId)

  if (progress.status === 'completed' && progress.outputUrl !== null) {
    console.warn(
      `[project.render] ${renderId} completed but its webhook never arrived; ` +
        'storing the output from the timeout path.',
    )
    await storeRenderOutput(renderId, progress.outputUrl, preflight)
    return { renderId, status: 'completed' }
  }

  if (progress.status === 'failed') {
    await failRenderAndRelease(
      prisma,
      renderId,
      'failed',
      progress.error ?? 'This video could not be rendered. Please try again.',
      progress.progress,
    )
    return { renderId, status: 'failed' }
  }

  /* Still going after the whole window. The last known progress is written
   * with it so the row says how far it got rather than implying it never
   * moved — which is the difference between "the renderer is slow" and "the
   * renderer is dead" for whoever reads this next. */
  await markRenderProgress(prisma, renderId, progress.progress)
  await failRenderAndRelease(
    prisma,
    renderId,
    'timedOut',
    'This render took longer than 45 minutes and was stopped. You can try it once more.',
    progress.progress,
  )
  return { renderId, status: 'timedOut' }
}

/**
 * SOURCE OF TRUTH KEYWORDS: failRenderAndRelease, NO_PATH_FORGETS_THE_REFUND,
 *   RELEASE_IS_THE_SAFETY_NET
 *
 * WHAT:  Marks a render failed or timed out AND gives back whatever was held
 *        for it.
 *
 * WHY:   NO_PATH_FORGETS_THE_REFUND. There are thirteen places in this file
 *        that can end a render badly — a missing secret, a broken document, a
 *        stale cache key, a provider refusal, a timeout, an unreadable
 *        webhook, the failure handler. Every one of them has to refund, and
 *        "remember to call release too" is a rule that holds until somebody
 *        adds the fourteenth path. So there is no bare `failRender` call left
 *        in this file: the only way to fail a render is through this function,
 *        and refunding is not something a caller can omit.
 *
 *        It finds the hold by the RENDER ID rather than taking a holdId,
 *        because most of those paths do not have one — the document check
 *        fails before the hold step runs, and `onFailure` receives only the
 *        original event. `findOpenHoldForRef` returns the unsettled hold or
 *        nothing, so calling this before a hold exists, or twice, is a no-op
 *        rather than an error (DOUBLE_COMMIT_REFUSED in the service).
 *
 *        The refund is best-effort around the status write: if releasing
 *        throws, the render is still marked failed and the error is logged
 *        loudly. The alternative — letting the release failure propagate —
 *        would leave a render stuck on `rendering` forever because its refund
 *        did not work, which is two problems instead of one. The nightly
 *        reconcile cron is what catches the stranded hold.
 * WHERE: Every failure path in this file, including onFailure.
 */
async function failRenderAndRelease(
  db: typeof prisma,
  renderId: string,
  status: 'failed' | 'timedOut',
  error: string,
  progress?: number,
): Promise<void> {
  await failRender(db, renderId, status, error, progress)

  try {
    const open = await findOpenHoldForRef(db, renderId)
    if (open !== null) {
      await release(db, open.id, { reason: `render ${status}` })
    }
  } catch (releaseError) {
    /* The render is already honest on the row; the money is not. Logged rather
     * than thrown — see the WHY above. `credits.reconcile` reports the
     * stranded hold. */
    console.error(
      `[project.render] ${renderId} was marked ${status} but its credit hold could not be released:`,
      releaseError,
    )
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: holdRenderCredits, HOLD_IN_THE_WORKFLOW,
 *   ORPHANED_HOLD, HOLD_IS_IDEMPOTENT
 *
 * WHAT:  Reserves the credits this render will cost, and returns the hold id.
 *
 * WHY:   HOLD_IN_THE_WORKFLOW rather than in `renders.create`, and the gap
 *        between them is deliberate. A hold placed in the request would sit
 *        inside that request's 10-second Prisma transaction, and a request
 *        that timed out AFTER holding would strand the money with no workflow
 *        in existence to release it. Here, the hold and everything that can
 *        release it live in the same durable run.
 *
 *        It is placed immediately before the provider call and AFTER every
 *        check that can still refuse the render for free — a broken document
 *        or a missing asset must not cost the customer a reservation.
 *
 *        HOLD_IS_IDEMPOTENT via ORPHANED_HOLD: Inngest retries a step, and a
 *        retry that placed a SECOND hold would leave the first unsettled
 *        forever — nothing would ever commit or release it, the customer's
 *        balance would be quietly short, and both the ledger and the cache
 *        would still agree, so reconcile would report nothing wrong. So the
 *        step looks for an existing open hold against this render first and
 *        reuses it.
 *
 *        An `InsufficientCreditsError` here is PERMANENT. The balance will not
 *        grow by itself, and retrying a render the customer cannot afford
 *        three times produces the same refusal three times — so it marks the
 *        row and stops. `renders.create` already refused on the estimate, so
 *        reaching this means the balance moved in between, which a concurrent
 *        render does routinely.
 * WHERE: The `hold-credits` step above.
 */
async function holdRenderCredits(
  renderId: string,
  preflight: PreflightFacts,
): Promise<string> {
  const existing = await findOpenHoldForRef(prisma, renderId)
  if (existing !== null) {
    /* A retry of this step. The money is already reserved; reusing the hold is
     * what keeps commit/release able to settle exactly one thing. */
    return existing.id
  }

  const cost = estimateRenderCost({
    durationSeconds: preflight.durationInSeconds,
    resolution: preflight.resolution,
  })

  try {
    return await hold(prisma, preflight.organizationId, cost.total, renderId, {
      kind: 'render',
      resolution: preflight.resolution,
      durationSeconds: preflight.durationInSeconds,
      breakdown: cost.lines,
    })
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      await failRenderAndRelease(
        prisma,
        renderId,
        'failed',
        `This render needs ${error.required} credits and this workspace has ${error.available}. Top up and try again.`,
      )
      throw new NonRetriableError(
        `[project.render] ${renderId} could not be held: ${error.message}`,
      )
    }
    throw error
  }
}
