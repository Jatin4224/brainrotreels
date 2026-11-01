/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: GET /api/v1/renders/:id, DOWNLOAD_URL_IS_SIGNED_ON_READ,
 *   THE_POLL_PATH_HAS_NO_LIMIT_GATE
 *
 * WHAT:  One render's status, with a download URL once there is something to
 *        download.
 *
 * WHY:   THE_POLL_PATH_HAS_NO_LIMIT_GATE — no `resource`, so this read is
 *        gated only by `apiAccess` and the `apiCalls` allowance every request
 *        pays. That is deliberate and it is what makes the render flow usable
 *        from a script: a client polls this endpoint until the render is done,
 *        and a workspace at its monthly RENDER limit must still be able to
 *        collect the renders it already paid for.
 *
 *        DOWNLOAD_URL_IS_SIGNED_ON_READ with the long TTL, so a client on a
 *        slow connection can finish the download. The URL is signed per
 *        request rather than stored, which is what makes revoking access a
 *        matter of not signing again.
 * WHERE: Documented in the OpenAPI document at /api/v1/openapi.json.
 */

import { z } from "zod";

import { getRenderOperation } from "@/lib/api/operations";

import { methodNotAllowed, runApiRoute } from "../../_lib/handler";

/* Nothing in the query string: the id is in the path and there is nothing to
 * filter. An empty schema still runs, so an unexpected `?foo=` is ignored
 * rather than refused — a read is the wrong place to be strict about noise. */
const noQuery = z.object({});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return runApiRoute(request, {
    input: "query",
    schema: noQuery,
    run: (operation) => getRenderOperation(operation, { id }),
  });
}

export async function POST(request: Request): Promise<Response> {
  return Promise.resolve(methodNotAllowed(request, "GET"));
}
