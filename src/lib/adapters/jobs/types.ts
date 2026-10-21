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
  /**
   * RENDER_FINISHED_IS_DOMAIN_VERB. Sent by
   * src/app/api/webhooks/remotion/route.ts, NOT by app code: it is the render
   * provider telling us a render ended, relayed onto the queue so the waiting
   * workflow can resume. It is the one event here whose producer is a webhook
   * rather than a router, which is exactly why it exists — a `waitForEvent`
   * needs an event, and the webhook has nowhere else to put the news.
   *
   * Phase 04's brief calls this `remotion/render.finished`. It is NOT named
   * that, for two reasons. The shape rule in select-provider.test.ts requires
   * `domain/verb` with no dots — a convention worth more than one literal from
   * a brief, because it is what keeps every event name greppable and
   * machine-checkable. And the domain here is `render`, not `remotion`: the
   * event means "a render finished", which is true whatever renders it, and
   * naming it after the current provider would put a vendor in a contract that
   * exists precisely so the vendor can be swapped (see the render adapter
   * seam). The webhook ROUTE is still provider-specific and still named after
   * Remotion; the event it relays is not.
   */
  'render/finished',
  /**
   * SCRIPT_IS_ITS_OWN_EVENT. Sent by `scripts.generate` once the source text
   * has been extracted, so the model call — which takes tens of seconds at the
   * effort this product asks for — happens in a durable run rather than inside
   * the request's 10-second Prisma transaction.
   *
   * Distinct from `project/requested`, which Phase 09 uses for the WHOLE
   * pipeline (script → voices → TTS → align → timeline). This one is the
   * script step alone, and it exists because the script is editable on its own
   * long before that pipeline is built: a customer regenerates a script
   * without re-synthesising audio. Phase 09 composes this step rather than
   * replacing it.
   */
  'script/requested',
  /**
   * NARRATION_IS_ITS_OWN_EVENT. Sent once a script exists and the cast is
   * complete. Separate from `script/requested` because narration is
   * re-runnable on its own: editing one line re-synthesises that line without
   * rewriting the script, and Phase 15's editor drives exactly that. Phase 09
   * composes this step rather than replacing it.
   */
  'tts/requested',
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
