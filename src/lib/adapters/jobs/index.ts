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
 * SOURCE OF TRUTH KEYWORDS: getJobsAdapter, enqueue, enqueueMany, JobsAdapter,
 *   PROVIDER_ISOLATION, dynamic import, JOBS_PROVIDER
 *
 * WHAT:  The only sanctioned way for app code to enqueue background work.
 * WHY:   The dynamic `import()` IS the isolation guarantee — an unselected
 *        engine's SDK is never evaluated and never opens a connection — so it
 *        is deliberately not hidden behind a sync accessor.
 *        `enqueue` exists so a router never writes
 *        `(await getJobsAdapter()).send(...)`; the shorter call is the one
 *        people will actually use, and it keeps the adapter out of handlers.
 *        Reminder for callers: a tRPC mutation runs inside a 10-second Prisma
 *        transaction. Enqueue and return — never await the work itself.
 * WHERE: Called from tRPC routers and from workflow steps that fan out.
 */

import 'server-only'

import { JOBS_PROVIDER } from './provider'
import type { JobEvent, JobsAdapter } from './types'

export type { JobEvent, JobEventName, JobsAdapter, JobsProviderId } from './types'
export { JOB_EVENT_NAMES, JOBS_PROVIDER_IDS } from './types'
export { JOBS_PROVIDER, DEFAULT_JOBS_PROVIDER } from './provider'

/* Memoised per process. Holds the in-flight promise so concurrent first calls
 * share one import instead of racing. */
let adapterPromise: Promise<JobsAdapter> | null = null

async function loadAdapter(): Promise<JobsAdapter> {
  /* Exhaustive over JobsProviderId — adding an id without a case here is a
   * compile error at the `never` branch, so an engine cannot be unreachable. */
  switch (JOBS_PROVIDER) {
    case 'inngest': {
      const mod = await import('./inngest')
      return mod.inngestJobsAdapter
    }
    default: {
      const exhaustive: never = JOBS_PROVIDER
      throw new Error(`[adapters/jobs] No adapter registered for "${String(exhaustive)}".`)
    }
  }
}

export async function getJobsAdapter(): Promise<JobsAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter()
  }
  return adapterPromise
}

/**
 * SOURCE OF TRUTH KEYWORDS: enqueue
 *
 * WHAT:  Send one background event.
 * WHERE: The call every router should use.
 */
export async function enqueue(event: JobEvent): Promise<void> {
  const adapter = await getJobsAdapter()
  await adapter.send(event)
}

export async function enqueueMany(events: readonly JobEvent[]): Promise<void> {
  const adapter = await getJobsAdapter()
  await adapter.sendMany(events)
}
