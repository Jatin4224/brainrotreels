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
 * SOURCE OF TRUTH KEYWORDS: usageResetFunction, usage.reset, PERIODIC_USAGE,
 *   CALENDAR_MONTH_ANCHOR, cron
 *
 * WHAT:  Zeroes periodic usage counters at the start of each calendar month.
 * WHY:   Runs hourly, not monthly. A once-a-month cron has exactly one chance
 *        to fire, and a deploy or outage at the wrong hour means every
 *        customer waits a month for their quota. Hourly plus the
 *        `lastResetAt < periodStart` filter makes the job idempotent: the
 *        first run after the boundary does the work and the next twenty-three
 *        match no rows.
 *        Safe to run even when nothing needs resetting — gates already treat
 *        a stale counter as zero, so this never changes behaviour, only the
 *        stored numbers.
 * WHERE: Registered in src/inngest/functions/index.ts.
 */

import { inngestClient } from '@/lib/adapters/jobs/inngest/client'
import { currentPeriodStart, periodicResourceKeys } from '@/lib/usage-period'
import { resetPeriodicUsage } from '@/services/usage.service'

export const usageResetFunction = inngestClient.createFunction(
  {
    id: 'usage-reset',
    name: 'Reset periodic usage counters',
    triggers: [{ cron: '0 * * * *' }],
  },
  async ({ step }) => {
    const resourceKeys = await step.run('collect-periodic-resources', () =>
      periodicResourceKeys(),
    )

    if (resourceKeys.length === 0) {
      return { reset: 0, resources: [] }
    }

    const periodStart = currentPeriodStart()

    const reset = await step.run('reset-counters', () =>
      resetPeriodicUsage(resourceKeys, periodStart),
    )

    return { reset, resources: resourceKeys, periodStart: periodStart.toISOString() }
  },
)
