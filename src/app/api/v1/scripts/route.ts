/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: POST /api/v1/scripts, REFUSE_BEFORE_PAYING,
 *   EXTRACT_SYNCHRONOUSLY_GENERATE_ASYNCHRONOUSLY, maxDuration
 *
 * WHAT:  Reads a source, charges for the writing, and queues it.
 *
 * WHY:   `maxDuration` is raised because this endpoint FETCHES the customer's
 *        source inside the request — the one operation in the seven that does
 *        real network work before returning. The web app's equivalent raises
 *        its transaction timeout to 30 seconds for the same reason, and a
 *        serverless default of ten would abort a legitimate fetch of a slow
 *        news site. It is bounded rather than open-ended; the extraction has
 *        its own 15-second cap inside.
 *
 *        No `successStatus: 201`: nothing was created, something was QUEUED.
 *        The response says `queued: true` and a 200 is the honest status —
 *        201 would invite a client to look for a `Location` header for a
 *        resource that does not exist yet.
 * WHERE: Documented in the OpenAPI document at /api/v1/openapi.json.
 */

import { generateScriptOperation } from "@/lib/api/operations";
import { apiGenerateScriptSchema } from "@/lib/types/api";

import { methodNotAllowed, runApiRoute } from "../_lib/handler";

/* Extraction is bounded at fifteen seconds; this leaves room for the model
 * request's enqueue and the response. */
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return runApiRoute(request, {
    input: "body",
    schema: apiGenerateScriptSchema,
    /* Scripts are metered in CREDITS by the operation, not by a registry
     * limit, so there is no resource to count here beyond `apiCalls`. */
    idempotent: true,
    run: (operation, input) => generateScriptOperation(operation, input),
  });
}

export async function GET(request: Request): Promise<Response> {
  return Promise.resolve(methodNotAllowed(request, "POST"));
}
