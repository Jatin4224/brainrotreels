/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: GET /api/v1/catalog/caption-styles, LOCKED_NOT_HIDDEN
 *
 * WHAT:  The caption styles, with availability and the contrast verdict.
 * WHY:   `contrastOk` travels with each style because it is a FACT about the
 *        style rather than a warning for a screen — a client choosing one
 *        programmatically has no eye to check it with, which is exactly the
 *        case the contrast check exists for. The same function serves
 *        `captions.styles` on the web.
 * WHERE: Documented in the OpenAPI document at /api/v1/openapi.json.
 */

import { listCaptionStyleCatalogOperation } from "@/lib/api/operations";
import { apiCaptionStyleCatalogSchema } from "@/lib/types/api";

import { methodNotAllowed, runApiRoute } from "../../_lib/handler";

export async function GET(request: Request): Promise<Response> {
  return runApiRoute(request, {
    input: "query",
    schema: apiCaptionStyleCatalogSchema,
    run: (operation, input) =>
      listCaptionStyleCatalogOperation(operation, input),
  });
}

export async function POST(request: Request): Promise<Response> {
  return Promise.resolve(methodNotAllowed(request, "GET"));
}
