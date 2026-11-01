/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: POST /api/v1/renders, REUSE_COSTS_NOTHING,
 *   THE_OPERATION_REPORTS_THE_SURFACE_METERS, THE_GATE_ALWAYS_THE_COUNTER_SOMETIMES,
 *   RENDER_STARTS_OUTSIDE_THE_REQUEST
 *
 * WHAT:  Starts a render, or returns the one that already exists for this
 *        document at this resolution.
 *
 * WHY:   THE_OPERATION_REPORTS_THE_SURFACE_METERS, and this route is the other
 *        half of the decision recorded in the operation. On the web, the
 *        procedure factory auto-increments the `renders` counter and the
 *        router posts a compensating `-1` when a render was reused. Here the
 *        metering is EXPLICIT, so there is nothing to compensate for — the
 *        reuse case simply must not be counted, which is what
 *        `countOnSuccess` says.
 *
 *        The GATE still applies on every call, including one that would have
 *        been free: a workspace at its monthly limit is refused before any
 *        work, with a 429 and the registry's own sentence. That mirrors the
 *        web, where the factory's gate also runs before the handler. The
 *        caveat is the same one `renders.create` records and so is the answer:
 *        nothing has to call this to fetch an existing render —
 *        `GET /renders/:id` is the download path and has no limit gate at all.
 *
 *        RENDER_STARTS_OUTSIDE_THE_REQUEST — this returns as soon as the row
 *        exists and the job is queued. A client polls `GET /renders/:id`, and
 *        closing the connection cancels nothing, because the work lives in the
 *        queue.
 * WHERE: Documented in the OpenAPI document at /api/v1/openapi.json.
 */

import { createRenderOperation } from "@/lib/api/operations";
import { apiCreateRenderSchema } from "@/lib/types/api";

import { methodNotAllowed, runApiRoute } from "../_lib/handler";

export async function POST(request: Request): Promise<Response> {
  return runApiRoute(request, {
    input: "body",
    schema: apiCreateRenderSchema,
    /* Gated on every call, counted only when a render was made — see
     * THE_GATE_ALWAYS_THE_COUNTER_SOMETIMES. */
    resource: "renders",
    idempotent: true,
    successStatus: 201,
    run: (operation, input) => createRenderOperation(operation, input),
    /* After `run`, so the output type is inferred by the time this predicate
     * is checked — TypeScript resolves an object literal's properties in
     * order, and a predicate written above `run` would see `unknown`. */
    countOnSuccess: (result) => !result.reused,
  });
}

export async function GET(request: Request): Promise<Response> {
  return Promise.resolve(methodNotAllowed(request, "POST"));
}
