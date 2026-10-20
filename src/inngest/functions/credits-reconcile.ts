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
 * SOURCE OF TRUTH KEYWORDS: creditsReconcileFunction, credits.reconcile,
 *   REPORT_DONT_REPAIR, RECONCILE_SOURCE_OF_TRUTH, STRANDED_HOLD,
 *   LEDGER_AND_CACHE_IN_ONE_TRANSACTION
 *
 * WHAT:  Nightly audit of the credit system: does every workspace's cached
 *        balance still equal the sum of its ledger, and is any hold stuck?
 *
 * WHY:   REPORT_DONT_REPAIR, and the phase asks for it in those words. This
 *        job does NOT fix what it finds. `Organization.creditBalance` is a
 *        cache written in the same transaction as every ledger row
 *        (LEDGER_AND_CACHE_IN_ONE_TRANSACTION), so the two can only diverge if
 *        a transaction boundary is WRONG somewhere in the code. Silently
 *        healing the number would remove the only evidence that the bug
 *        exists, while the bug carried on producing it — and the second
 *        symptom would be a customer's balance drifting with no trail at all.
 *        A wrong number somebody is looking at beats a right number nobody
 *        knows was wrong.
 *
 *        STRANDED_HOLD is the second thing it looks for, and it is the failure
 *        mode that reconciling balances alone would miss entirely. A hold that
 *        was never committed or released leaves the ledger and the cache in
 *        PERFECT agreement — both say the money is gone — while the customer
 *        is quietly short and no render ever used it. It is reachable whenever
 *        a workflow dies between holding and settling in a way that
 *        `onFailure` cannot catch (the process is killed, the run is deleted).
 *        Age is the signal: a hold younger than the render timeout is probably
 *        just a render in flight, so only older ones are reported.
 *
 *        Daily rather than hourly, unlike `usage.reset`. That job is idempotent
 *        tidy-up whose lateness costs a customer their quota; this one reads
 *        every organization and every ledger row and produces a report a human
 *        has to act on, so running it twenty-four times a day would be
 *        twenty-four times the cost and the same one report.
 * WHERE: Registered in src/inngest/functions/index.ts, served at /api/inngest.
 */

import { inngestClient } from '@/lib/adapters/jobs/inngest/client'
import { prisma } from '@/lib/config/prisma'

/**
 * How old an unsettled hold must be before it counts as stranded. Comfortably
 * past the render timeout (45 minutes), so a render legitimately still running
 * is never reported. Grep RENDER_TIMEOUT in project-render.ts.
 */
const STRANDED_HOLD_AFTER_MS = 3 * 60 * 60 * 1000

/** Nothing in this job needs to be precise to the minute; 03:00 UTC is quiet. */
const RECONCILE_CRON = '0 3 * * *'

export const creditsReconcileFunction = inngestClient.createFunction(
  {
    id: 'credits-reconcile',
    name: 'Reconcile credit balances against the ledger',
    triggers: [{ cron: RECONCILE_CRON }],
  },
  async ({ step }) => {
    /**
     * SOURCE OF TRUTH KEYWORDS: RECONCILE_IN_ONE_QUERY
     *
     * Both halves are computed by the DATABASE rather than by reading every
     * organization into this process and summing in JavaScript. The ledger is
     * append-only and unbounded — a year of rendering is a lot of rows — and
     * a job that loads all of them to add them up is a job that eventually
     * runs out of memory on the night it is most needed.
     */
    const drift = await step.run('compare-balances', async () => {
      const rows = await prisma.$queryRaw<
        { organizationId: string; cached: number; actual: number }[]
      >`
        SELECT o."id"                                AS "organizationId",
               o."creditBalance"                     AS "cached",
               COALESCE(SUM(l."delta"), 0)::int      AS "actual"
        FROM "organization" o
        LEFT JOIN "credit_ledger" l ON l."organizationId" = o."id"
        GROUP BY o."id", o."creditBalance"
        HAVING o."creditBalance" <> COALESCE(SUM(l."delta"), 0)
      `

      for (const row of rows) {
        /* REPORT_DONT_REPAIR — logged at error level because a divergence here
         * means a transaction boundary is wrong in code, which is a bug to
         * fix rather than a number to correct. */
        console.error(
          `[credits.reconcile] DRIFT organization=${row.organizationId} ` +
            `cached=${row.cached} ledger=${row.actual} delta=${row.cached - row.actual}`,
        )
      }

      return rows.map((row) => ({
        organizationId: row.organizationId,
        cached: row.cached,
        actual: row.actual,
      }))
    })

    /**
     * STRANDED_HOLD — a hold with no commit and no release against it, old
     * enough that the work it was for cannot still be running.
     */
    const stranded = await step.run('find-stranded-holds', async () => {
      const cutoff = new Date(Date.now() - STRANDED_HOLD_AFTER_MS)

      const rows = await prisma.$queryRaw<
        { id: string; organizationId: string; delta: number; refId: string | null }[]
      >`
        SELECT h."id", h."organizationId", h."delta", h."refId"
        FROM "credit_ledger" h
        WHERE h."kind" = 'hold'
          AND h."createdAt" < ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM "credit_ledger" s
            WHERE s."holdId" = h."id"
              AND s."kind" IN ('commit', 'release')
          )
      `

      for (const row of rows) {
        console.error(
          `[credits.reconcile] STRANDED HOLD id=${row.id} organization=${row.organizationId} ` +
            `credits=${Math.abs(row.delta)} ref=${row.refId ?? 'none'}`,
        )
      }

      return rows.map((row) => ({
        holdId: row.id,
        organizationId: row.organizationId,
        credits: Math.abs(row.delta),
        refId: row.refId,
      }))
    })

    /* Returned as well as logged, so the run's own output in the Inngest
     * dashboard answers "was anything wrong last night" without grepping. */
    return {
      checkedAt: new Date().toISOString(),
      driftCount: drift.length,
      drift,
      strandedHoldCount: stranded.length,
      stranded,
    }
  },
)
