/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: POST /api/v1/projects, A_ROUTE_IS_FOUR_LINES,
 *   ONE_OPERATION_THREE_SURFACES
 *
 * WHAT:  Creates a project for the workspace the key belongs to.
 * WHY:   A_ROUTE_IS_FOUR_LINES. Everything a route could get wrong — the
 *        entitlement check, the quota, the counter, the envelope, the error
 *        translation — is in `runApiRoute`. What is left is the three things
 *        only this endpoint knows: its schema, its metered resource, and the
 *        operation it calls. That operation is the same function
 *        `projects.create` calls.
 * WHERE: Documented in the OpenAPI document at /api/v1/openapi.json.
 */

import { createProjectOperation } from "@/lib/api/operations";
import { apiCreateProjectSchema } from "@/lib/types/api";

import { methodNotAllowed, runApiRoute } from "../_lib/handler";

export async function POST(request: Request): Promise<Response> {
  return runApiRoute(request, {
    input: "body",
    schema: apiCreateProjectSchema,
    /* The monthly `projects` limit, shared with the dashboard — see
     * QUOTAS_ARE_SHARED_PER_ORGANIZATION. */
    resource: "projects",
    idempotent: true,
    successStatus: 201,
    run: (operation, input) => createProjectOperation(operation, input),
  });
}

export async function GET(request: Request): Promise<Response> {
  /* Listing projects is deliberately not in this phase's seven verbs. A 405 in
   * the normal envelope says so, rather than Next's bodiless default. */
  return Promise.resolve(methodNotAllowed(request, "POST"));
}
