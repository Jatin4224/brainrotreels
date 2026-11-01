/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getOutputOperation, SIGNING_BOUNDARY,
 *   A_SIGNED_URL_IS_NOT_A_FILE, NOT_YOURS_IS_NOT_FOUND
 *
 * WHAT:  A short-lived download URL for one finished output.
 *
 * WHY:   A_SIGNED_URL_IS_NOT_A_FILE. This returns a URL rather than bytes, and
 *        every surface hands that URL on rather than proxying it. A REST
 *        endpoint that streamed the video would put tens of megabytes through
 *        a serverless function with a response-size limit and a short
 *        timeout, for a file the storage provider will serve directly, faster
 *        and cheaper.
 *
 *        NOT_YOURS_IS_NOT_FOUND. `signAssetUrl` returns null both for an asset
 *        that does not exist and for one this workspace may not read, and that
 *        collapse is deliberate — see SIGNING_BOUNDARY in the assets service.
 *        Distinguishing the two with different statuses tells a caller holding
 *        a key which ids are real, so both become one `not_found`. There is no
 *        branch here to be tempted into splitting them.
 *
 *        The TTL is the LONG one, for the reason `getRenderOperation` gives: a
 *        link handed to a client that will download tens of megabytes, maybe
 *        on a phone on a train, must not expire mid-download.
 * WHERE: `GET /outputs/:id` (17b) and `fetch_output` (17c). The web app
 *        reaches the same URL through `getRenderOperation`, which signs it
 *        alongside the render it belongs to — one round trip instead of two.
 */

import "server-only";

import { OperationError } from "@/lib/errors";
import { signAssetUrl } from "@/services/assets.service";
import type { OperationContext } from "@/lib/types/api";
import { FINAL_URL_TTL_SECONDS } from "@/lib/types/render";

export async function getOutputOperation(
  ctx: OperationContext,
  input: { assetId: string },
) {
  const url = await signAssetUrl(
    input.assetId,
    ctx.organizationId,
    FINAL_URL_TTL_SECONDS,
  );

  if (url === null) {
    throw new OperationError("not_found", "That output is not available.");
  }

  return { url, expiresInSeconds: FINAL_URL_TTL_SECONDS };
}
