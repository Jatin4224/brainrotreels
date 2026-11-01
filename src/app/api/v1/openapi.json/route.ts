/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: GET /api/v1/openapi.json, GENERATED_FROM_THE_SCHEMAS,
 *   THE_DESCRIPTION_IS_PUBLIC, SERVER_URL_IS_THE_REQUEST_ORIGIN
 *
 * WHAT:  The machine-readable description of this API.
 *
 * WHY:   THE_DESCRIPTION_IS_PUBLIC — no key required, deliberately. A client
 *        generator, a docs viewer or somebody deciding whether to integrate
 *        all need this BEFORE they have a key, and it contains no customer
 *        data: it describes shapes, not rows. Requiring a key would mean the
 *        only people who can read the documentation are the ones who already
 *        signed up.
 *
 *        SERVER_URL_IS_THE_REQUEST_ORIGIN, with the configured URL as the
 *        fallback. A generated client should point at the deployment it was
 *        generated from, so a preview deployment describes itself rather than
 *        handing somebody a client aimed at production.
 *
 *        It is CACHEABLE, unlike every other route here, because it is the
 *        same for everybody and changes only on deploy.
 * WHERE: Linked from /dashboard/settings/developers.
 */

import { buildOpenApiDocument } from "@/lib/api/openapi";
import { APP_URL } from "@/lib/config/branding";

export async function GET(request: Request): Promise<Response> {
  /* The origin this request actually arrived on, so the document describes the
   * deployment serving it. Falls back to the configured URL when the request
   * URL is not something we can read an origin from. */
  let origin = APP_URL;
  try {
    origin = new URL(request.url).origin;
  } catch {
    /* Keep the configured value. */
  }

  const document = buildOpenApiDocument(origin);

  return Promise.resolve(
    Response.json(document, {
      headers: {
        /* Changes only on deploy, and a stale copy for an hour is harmless. */
        "Cache-Control": "public, max-age=3600",
      },
    }),
  );
}
