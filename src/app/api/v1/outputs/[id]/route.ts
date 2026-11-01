/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: GET /api/v1/outputs/:id, A_SIGNED_URL_IS_NOT_A_FILE,
 *   NOT_YOURS_IS_NOT_FOUND
 *
 * WHAT:  A short-lived download URL for one finished output.
 *
 * WHY:   A_SIGNED_URL_IS_NOT_A_FILE. This returns a URL in the envelope rather
 *        than redirecting or streaming bytes. Streaming would put tens of
 *        megabytes through a serverless function with a response-size limit,
 *        for a file the storage provider serves directly. A 302 was the other
 *        candidate and is worse for an API: a client would have to follow a
 *        redirect to discover the expiry, and every HTTP library handles
 *        redirect-with-auth-header differently.
 *
 *        NOT_YOURS_IS_NOT_FOUND — the operation collapses "no such asset" and
 *        "not yours" into one answer, so this endpoint cannot be used to
 *        discover which ids exist.
 * WHERE: Documented in the OpenAPI document at /api/v1/openapi.json.
 */

import { z } from "zod";

import { getOutputOperation } from "@/lib/api/operations";

import { methodNotAllowed, runApiRoute } from "../../_lib/handler";

const noQuery = z.object({});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return runApiRoute(request, {
    input: "query",
    schema: noQuery,
    run: (operation) => getOutputOperation(operation, { assetId: id }),
  });
}

export async function POST(request: Request): Promise<Response> {
  return Promise.resolve(methodNotAllowed(request, "GET"));
}
