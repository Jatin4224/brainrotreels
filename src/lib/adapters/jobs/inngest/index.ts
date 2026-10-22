/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: inngestJobsAdapter, JobsAdapter, send, sendMany,
 *   IDEMPOTENCY_KEY, PROVIDER_ISOLATION
 *
 * WHAT:  The Inngest implementation of JobsAdapter.
 * WHY:   A thin translation and nothing more — the adapter's job is to keep
 *        `inngest` out of call sites, not to wrap its execution model.
 *        The `id` on a JobEvent maps to Inngest's own event id, which is what
 *        gives us deduplication: two sends with the same id produce one run.
 *        Errors are deliberately NOT swallowed. A failed enqueue means the
 *        work will never happen, and a handler that "succeeded" while the job
 *        vanished is the worst outcome available — the caller's transaction
 *        should roll back.
 * WHERE: Loaded by ../index.ts through a dynamic import.
 */

import "server-only";

import { inngestClient } from "./client";
import type { JobEvent, JobsAdapter } from "../types";

/* Inngest wants `id` omitted rather than undefined — exactOptionalPropertyTypes
 * makes that distinction real, so build the payload conditionally. */
function toInngestPayload(event: JobEvent): {
  name: string;
  data: Record<string, unknown>;
  id?: string;
} {
  return {
    name: event.name,
    /* REQUEST_ID_CROSSES_THE_QUEUE — merged INTO the data, which is the only
     * channel a workflow can read on the far side. It is spread FIRST so a
     * domain payload that genuinely carries its own `requestId` wins instead of
     * being overwritten by the envelope's.
     *
     * The event schemas are strict about the fields they NAME but ignore extra
     * keys, so this costs nothing; see the note on `JobEvent.requestId` for why
     * it is not declared on each of them. */
    data: {
      ...(event.requestId !== undefined ? { requestId: event.requestId } : {}),
      ...event.data,
    },
    ...(event.id !== undefined ? { id: event.id } : {}),
  };
}

export const inngestJobsAdapter: JobsAdapter = {
  id: "inngest",

  async send(event) {
    await inngestClient.send(toInngestPayload(event));
  },

  async sendMany(events) {
    if (events.length === 0) return;
    await inngestClient.send(events.map(toInngestPayload));
  },
};
