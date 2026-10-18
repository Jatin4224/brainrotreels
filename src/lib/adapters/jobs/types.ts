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
 * SOURCE OF TRUTH KEYWORDS: JobsAdapter, JobEvent, JobEventName, JOBS_PROVIDER_IDS,
 *   JobsProviderId, IDEMPOTENCY_KEY, enqueue
 *
 * WHAT:  The contract for durable background work: enqueue an event, let the
 *        workflow engine run the steps.
 * WHY:   Deliberately tiny. The app only ever needs to SEND — workflows are
 *        defined in src/inngest/functions/ against the engine's own API,
 *        because a step/retry/fan-out abstraction that spans engines would be
 *        a worse version of the engine. What must stay provider-neutral is the
 *        call sites: a tRPC handler says "this happened", never "run this now".
 *        That is the whole point — a mutation runs inside a 10s Prisma
 *        transaction, so anything slower than a provider round-trip has to
 *        leave the request.
 *        `id` is the idempotency key and is strongly encouraged, not optional
 *        by accident: two rapid identical requests must produce one run.
 *        Phase 09 keys generation on `projectId + docHash`.
 * WHERE: Implemented by ./inngest. Reached through getJobsAdapter() in ./index.
 */

/**
 * Event names are a closed union so a typo cannot silently enqueue an event
 * no workflow listens for — a failure mode that looks exactly like "the job
 * never ran" and costs an afternoon. Add the name here and the workflow in
 * src/inngest/functions/ together.
 */
export const JOB_EVENT_NAMES = [
  'hello/requested',
  'project/requested',
  'project/cancelled',
  'render/requested',
  'asset/uploaded',
  'footage/requested',
  'line/changed',
] as const

export type JobEventName = (typeof JOB_EVENT_NAMES)[number]

export interface JobEvent {
  name: JobEventName
  /** Keep payloads small: ids, never documents or audio. */
  data: Record<string, unknown>
  /**
   * IDEMPOTENCY_KEY. Two sends carrying the same id collapse to one run.
   * Omit only for events where a duplicate run is genuinely harmless.
   */
  id?: string
}

export interface JobsAdapter {
  readonly id: JobsProviderId
  send(event: JobEvent): Promise<void>
  /** Batched send. Same idempotency rules per event. */
  sendMany(events: readonly JobEvent[]): Promise<void>
}

export const JOBS_PROVIDER_IDS = ['inngest'] as const

export type JobsProviderId = (typeof JOBS_PROVIDER_IDS)[number]
