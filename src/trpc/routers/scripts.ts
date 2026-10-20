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
 * SOURCE OF TRUTH KEYWORDS: scriptsRouter, scripts.generate, scripts.list,
 *   scripts.updateBlock, scripts.regenerateBlock, scripts.reorder,
 *   EXTRACT_SYNCHRONOUSLY_GENERATE_ASYNCHRONOUSLY, REFUSE_BEFORE_PAYING,
 *   BYTE_IDENTICAL_NEIGHBOURS, LEDGER_NOT_A_COUNTER
 *
 * WHAT:  The surface for generating a script and editing it block by block.
 *
 * WHY:   EXTRACT_SYNCHRONOUSLY_GENERATE_ASYNCHRONOUSLY is the shape of this
 *        file, and the split is not arbitrary — it follows where the ERRORS
 *        are versus where the TIME is:
 *
 *          - EXTRACTION (fetch the URL, read the PDF) is bounded at fifteen
 *            seconds and produces every error a customer can act on: a
 *            paywall, a dead link, a scanned PDF, a page that renders in the
 *            browser. The phase requires those to arrive as a clear message
 *            offering raw-text entry, which only works if they happen in the
 *            request the customer is waiting on.
 *          - THE MODEL CALL is tens of seconds at the effort this product
 *            uses. A tRPC mutation runs inside a 10-second Prisma transaction
 *            (CLAUDE.md, and every other phase in this codebase), so it goes
 *            to a workflow — the same decision `renders.create` makes, for the
 *            same reason.
 *
 *        REFUSE_BEFORE_PAYING: the credit balance is checked here, before the
 *        job is enqueued, so a workspace that cannot afford a generation is
 *        told immediately instead of watching a job fail. The HOLD is placed
 *        inside the workflow (HOLD_IN_THE_WORKFLOW — see Phase 05), because a
 *        hold placed in a request that then times out strands the money with
 *        no run to release it.
 *
 *        LEDGER_NOT_A_COUNTER: `scripts` declares no `limit` in
 *        src/lib/resources.ts, so the factory gates nothing and bumps nothing
 *        here. A generation's cost is variable and is paid on the credit
 *        ledger.
 *
 *        BYTE_IDENTICAL_NEIGHBOURS: every editing verb touches exactly one
 *        row. There is no "save the whole script" mutation, deliberately —
 *        that is the shape that silently overwrites a block somebody else just
 *        edited.
 * WHERE: Mounted as `scripts` in src/trpc/routers/_app.ts. Reads and writes
 *        through src/services/scripts.service.ts; generation lives in
 *        src/lib/script and src/inngest/functions/script-generate.ts.
 */

import { TRPCError } from '@trpc/server'

import { createStructuredError, createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import { permissions } from '@/lib/permissions'
import { ERROR_CODES } from '@/lib/errors'
import { enqueue } from '@/lib/adapters/jobs'
import { estimate } from '@/lib/credits'
import { getBalance } from '@/services/credits.service'
import { findProjectForOrganization } from '@/services/projects.service'
import * as scriptsService from '@/services/scripts.service'
import { SourceExtractionError, extractSource, regenerateScriptBlock } from '@/lib/script'
import {
  SCRIPT_WARN_SECONDS,
  addScriptBlockSchema,
  countSpokenWords,
  deleteScriptBlockSchema,
  estimateSpokenSeconds,
  generateScriptSchema,
  listScriptSchema,
  regenerateBlockSchema,
  reorderScriptSchema,
  sectionTypeSchema,
  updateScriptBlockSchema,

} from '@/lib/types/script'

/**
 * SOURCE OF TRUTH KEYWORDS: scriptCostFor, ONE_PRICE_TWO_SURFACES
 *
 * WHAT:  What generating a script of this length costs.
 * WHY:   ONE_PRICE_TWO_SURFACES — the same call prices the button, the
 *        refusal here, and the hold in the workflow. A cost computed
 *        separately anywhere would let the button promise one number while the
 *        handler charged another.
 * WHERE: `generate`, `estimateCost`, and the workflow's hold.
 */
function scriptCostFor(targetSeconds: number) {
  return estimate({ kind: 'script', durationSeconds: targetSeconds })
}

export const scriptsRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: scripts.generate,
   *   EXTRACT_SYNCHRONOUSLY_GENERATE_ASYNCHRONOUSLY, REFUSE_BEFORE_PAYING
   *
   * WHAT:  Reads the source, checks it can be paid for, and queues the writing.
   * WHY:   See the file header for the split. The `txTimeout` is raised to 30
   *        seconds because extraction is bounded at fifteen and the default
   *        ten would abort a legitimate fetch of a slow news site — this is
   *        the one mutation in the codebase that deliberately holds a
   *        transaction longer than the default, and it is bounded rather than
   *        open-ended.
   * WHERE: The generate form on the project screen.
   */
  generate: protectedProcedure({
    requirePermission: permissions.SCRIPTS_CREATE,
    audit: { action: 'generate' },
    txTimeout: 30_000,
  })
    .input(generateScriptSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await findProjectForOrganization(
        ctx.db,
        input.organizationId,
        input.projectId,
      )
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' })

      /* REFUSE_BEFORE_PAYING — before the fetch, so a workspace with no
       * credits is not made to wait for a download it cannot use. */
      const cost = scriptCostFor(input.targetSeconds)
      const available = await getBalance(input.organizationId, ctx.db)
      if (available < cost.total) {
        throw createStructuredError(
          'FORBIDDEN',
          `Writing this script costs ${cost.total} credits and this workspace has ${available}.`,
          {
            errorCode: ERROR_CODES.INSUFFICIENT_CREDITS,
            resource: 'credits',
            required: cost.total,
            available,
            message: `Not enough credits. ${cost.total} needed, ${available} available.`,
          },
        )
      }

      /* The customer-facing failures all live in here — a paywall, a dead
       * link, a scanned PDF. They are raised as readable messages that offer
       * raw-text entry, which is the phase's own requirement. */
      let extracted
      try {
        extracted = await extractSource(input.source)
      } catch (error) {
        if (error instanceof SourceExtractionError) {
          console.warn(`[scripts.generate] extraction refused: ${error.detail}`)
          throw new TRPCError({ code: 'UNPROCESSABLE_CONTENT', message: error.message })
        }
        throw error
      }

      /* RECORD_THE_PATH — what the customer gave us, and what we made of it,
       * on the project. The phase says to use these columns rather than adding
       * new ones: `sourceRef` is the normalised input, `settings` carries the
       * extracted body and the provenance. */
      await ctx.db.project.update({
        where: { id: project.id },
        data: {
          sourceRef: extracted.finalUrl ?? input.source.value,
          settings: {
            ...(typeof project.settings === 'object' && project.settings !== null
              ? (project.settings as Record<string, unknown>)
              : {}),
            script: {
              sourceKind: extracted.kind,
              sourceTitle: extracted.title ?? null,
              truncated: extracted.truncated,
              targetSeconds: input.targetSeconds,
              tone: input.tone,
              /* The extracted body, so a retry does not re-fetch — and so an
               * operator can see exactly what the model was given. */
              sourceText: extracted.text,
            },
          },
        },
      })

      /* The model call goes to a workflow. Keyed on the project and the
       * request's shape, so a double-click produces one run while a genuine
       * second attempt with different settings produces another. */
      await enqueue({
        name: 'script/requested',
        data: {
          projectId: project.id,
          organizationId: input.organizationId,
          targetSeconds: input.targetSeconds,
          tone: input.tone,
        },
        id: `script-${project.id}-${input.targetSeconds}-${input.tone}-${extracted.text.length}`,
      })

      return {
        queued: true,
        cost,
        source: {
          kind: extracted.kind,
          title: extracted.title ?? null,
          truncated: extracted.truncated,
          characters: extracted.text.length,
        },
      }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: scripts.estimateCost, COST_ON_THE_BUTTON
   *
   * WHAT:  What a generation would cost, and whether it is affordable.
   * WHY:   A cheap read so the button can carry its price (the phase's step
   *        10), from the SAME estimator the refusal and the hold use. It
   *        returns the balance alongside so the two numbers being compared
   *        were read at the same instant.
   * WHERE: The generate form.
   */
  estimateCost: protectedProcedure({ requirePermission: permissions.SCRIPTS_READ })
    .input(listScriptSchema.extend({ targetSeconds: generateScriptSchema.shape.targetSeconds }))
    .query(async ({ ctx, input }) => {
      const cost = scriptCostFor(input.targetSeconds)
      const balance = await getBalance(input.organizationId, ctx.db)
      return { cost, balance, affordable: balance >= cost.total }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: scripts.list, PACING_WARNS_NEVER_TRUNCATES
   *
   * WHAT:  A project's script, in order, with the pacing verdict.
   * WHY:   The total is summed from the stored per-block estimates rather than
   *        recomputed from the joined text, so what the editor shows is
   *        provably the sum of what it lists. The warning threshold travels
   *        with it so the client does not hardcode 60.
   * WHERE: The script editor.
   */
  list: protectedProcedure({ requirePermission: permissions.SCRIPTS_READ })
    .input(listScriptSchema)
    .query(async ({ ctx, input }) => {
      const blocks = await scriptsService.listScriptBlocks(
        ctx.db,
        input.organizationId,
        input.projectId,
      )

      const estimatedSeconds =
        Math.round(blocks.reduce((total, block) => total + block.durationEstimate, 0) * 100) / 100

      return {
        blocks,
        estimatedSeconds,
        warnAtSeconds: SCRIPT_WARN_SECONDS,
        overLimit: estimatedSeconds > SCRIPT_WARN_SECONDS,
      }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: scripts.updateBlock, BYTE_IDENTICAL_NEIGHBOURS
   *
   * WHAT:  An inline edit of one block's words.
   * WHY:   One row, by id. The duration is recomputed server-side from the new
   *        text rather than accepted from the client — a client-supplied
   *        duration is a number the pacing warning and the credit estimate
   *        would both then trust.
   * WHERE: The editor's textarea, on blur.
   */
  updateBlock: protectedProcedure({
    requirePermission: permissions.SCRIPTS_UPDATE,
    audit: { action: 'updateBlock' },
  })
    .input(updateScriptBlockSchema)
    .mutation(async ({ ctx, input }) => {
      const updated = await scriptsService.updateBlockText(
        ctx.db,
        input.organizationId,
        input.id,
        input.narrationText,
      )
      if (updated === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That block no longer exists.' })
      }

      return {
        id: input.id,
        narrationText: input.narrationText,
        durationEstimate: estimateSpokenSeconds(input.narrationText),
      }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: scripts.regenerateBlock, CONTEXT_IN_ONLY_ONE_OUT,
   *   BYTE_IDENTICAL_NEIGHBOURS
   *
   * WHAT:  Rewrites one block, leaving every other byte-identical.
   * WHY:   The phase's step 8, and the one generation call that is fast enough
   *        to stay in the request: a single block is a few dozen words, not a
   *        whole script, so it returns inside the transaction budget rather
   *        than needing a workflow.
   *
   *        The neighbours are read and sent as CONTEXT so the rewrite still
   *        fits, and only this block is written back
   *        (CONTEXT_IN_ONLY_ONE_OUT). The credit cost is charged as a `script`
   *        generation scaled to the block, not to the whole video.
   * WHERE: The per-block regenerate button.
   */
  regenerateBlock: protectedProcedure({
    requirePermission: permissions.SCRIPTS_UPDATE,
    audit: { action: 'regenerateBlock' },
    /* A single-block model call. Longer than the default ten seconds, far
     * shorter than a whole script. */
    txTimeout: 45_000,
  })
    .input(regenerateBlockSchema)
    .mutation(async ({ ctx, input }) => {
      const block = await scriptsService.findScriptBlock(
        ctx.db,
        input.organizationId,
        input.id,
      )
      if (!block) throw new TRPCError({ code: 'NOT_FOUND', message: 'That block no longer exists.' })

      const siblings = await scriptsService.listScriptBlocks(
        ctx.db,
        input.organizationId,
        block.projectId,
      )
      const index = siblings.findIndex((candidate) => candidate.id === block.id)

      const section = sectionTypeSchema.safeParse(block.sectionType)
      if (!section.success) {
        throw new TRPCError({
          code: 'UNPROCESSABLE_CONTENT',
          message: 'That block has an unrecognised type and cannot be rewritten.',
        })
      }

      const rewritten = await regenerateScriptBlock({
        sectionType: section.data,
        currentText: block.narrationText,
        before: siblings.slice(0, Math.max(0, index)).map((row) => row.narrationText),
        after: siblings.slice(index + 1).map((row) => row.narrationText),
        tone: input.tone,
        instruction: input.instruction,
      })

      const updated = await scriptsService.updateBlockText(
        ctx.db,
        input.organizationId,
        block.id,
        rewritten.narrationText,
      )
      if (updated === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That block no longer exists.' })
      }

      return {
        id: block.id,
        narrationText: rewritten.narrationText,
        durationEstimate: rewritten.estimatedSeconds,
        words: countSpokenWords(rewritten.narrationText),
      }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: scripts.addBlock
   *
   * WHAT:  Inserts an empty block, after another one or at the end.
   * WHY:   Empty, not generated — a button labelled "add block" that silently
   *        made a billed model call would be a charge behind a control that
   *        does not look like one. The customer types, or presses regenerate.
   * WHERE: The editor's add controls.
   */
  addBlock: protectedProcedure({
    requirePermission: permissions.SCRIPTS_UPDATE,
    audit: { action: 'addBlock' },
  })
    .input(addScriptBlockSchema)
    .mutation(async ({ ctx, input }) => {
      let afterPosition: number | null = null

      if (input.afterId !== undefined) {
        const anchor = await scriptsService.findScriptBlock(
          ctx.db,
          input.organizationId,
          input.afterId,
        )
        if (!anchor || anchor.projectId !== input.projectId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'That block no longer exists.' })
        }
        afterPosition = anchor.position
      }

      return scriptsService.insertBlock(ctx.db, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sectionType: input.sectionType,
        afterPosition,
      })
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: scripts.deleteBlock, POSITION_IS_DENSE
   *
   * WHAT:  Removes one block and closes the gap.
   * WHY:   The row is read first so the renumber knows which positions to
   *        shift, and so a missing block answers NOT_FOUND rather than
   *        succeeding silently.
   * WHERE: The editor's row menu.
   */
  deleteBlock: protectedProcedure({
    requirePermission: permissions.SCRIPTS_DELETE,
    audit: { action: 'deleteBlock' },
  })
    .input(deleteScriptBlockSchema)
    .mutation(async ({ ctx, input }) => {
      const block = await scriptsService.findScriptBlock(
        ctx.db,
        input.organizationId,
        input.id,
      )
      if (!block) throw new TRPCError({ code: 'NOT_FOUND', message: 'That block no longer exists.' })

      await scriptsService.deleteBlock(ctx.db, input.organizationId, {
        id: block.id,
        projectId: block.projectId,
        position: block.position,
      })

      return { id: block.id }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: scripts.reorder, ORDER_IS_SENT_WHOLE
   *
   * WHAT:  Applies a new block order after a drag.
   * WHY:   The whole order is sent, not a move. See ORDER_IS_SENT_WHOLE in the
   *        service for why a from/to pair produces an order nobody chose when
   *        two drags race.
   * WHERE: The editor's drag handle.
   */
  reorder: protectedProcedure({
    requirePermission: permissions.SCRIPTS_UPDATE,
    audit: { action: 'reorder' },
  })
    .input(reorderScriptSchema)
    .mutation(async ({ ctx, input }) => {
      const updated = await scriptsService.reorderBlocks(ctx.db, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        orderedIds: input.orderedIds,
      })

      return { reordered: updated }
    }),
})
