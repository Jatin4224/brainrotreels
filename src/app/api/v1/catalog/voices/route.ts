/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: GET /api/v1/catalog/voices, LOCKED_NOT_HIDDEN
 *
 * WHAT:  The voice catalogue, with each row's availability for this workspace.
 * WHY:   LOCKED_NOT_HIDDEN — a voice above the plan comes back with
 *        `locked: true` and the registry's upgrade sentence rather than being
 *        filtered out, so an agent can tell a person what upgrading would buy.
 *        The same function serves `voices.list` on the web, so the list and
 *        the lock state cannot differ between surfaces.
 * WHERE: Documented in the OpenAPI document at /api/v1/openapi.json.
 */

import { listVoiceCatalogOperation } from "@/lib/api/operations";
import { apiVoiceCatalogSchema } from "@/lib/types/api";

import { methodNotAllowed, runApiRoute } from "../../_lib/handler";

export async function GET(request: Request): Promise<Response> {
  return runApiRoute(request, {
    input: "query",
    schema: apiVoiceCatalogSchema,
    run: (operation, input) => listVoiceCatalogOperation(operation, input),
  });
}

export async function POST(request: Request): Promise<Response> {
  return Promise.resolve(methodNotAllowed(request, "GET"));
}
