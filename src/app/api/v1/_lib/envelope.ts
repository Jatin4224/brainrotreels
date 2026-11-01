/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: apiOk, apiFail, API_ERROR_CODES, ApiErrorCode,
 *   OPERATION_FAILURE_TO_API_ERROR, ONE_ENVELOPE_EVERY_RESPONSE,
 *   THE_TABLE_IS_TOTAL, REQUEST_ID_IS_ALWAYS_PRESENT
 *
 * WHAT:  The two shapes every `/api/v1` response takes, the wire error codes,
 *        and the one table turning an operation failure into a status and a
 *        code.
 *
 * WHY:   ONE_ENVELOPE_EVERY_RESPONSE. The phase file asks for `{ data,
 *        requestId }` or `{ error: { code, message }, requestId }` and nothing
 *        else, which is worth holding to literally: a client that must branch
 *        on three response shapes writes three parsers and gets the third one
 *        wrong. These two functions are the only way a route may answer, so
 *        the shape cannot drift per endpoint.
 *
 *        REQUEST_ID_IS_ALWAYS_PRESENT, on success as well as failure. It is
 *        the one thing a customer can quote in a support message that lets an
 *        operator find the request in the logs, and asking for it only when
 *        something went wrong means it is missing from the one request that
 *        went wrong silently.
 *
 *        THE_TABLE_IS_TOTAL — the same discipline as the tRPC mapping and the
 *        second half of the contract 17a set up. Operations speak six
 *        situations and no status codes; this file is the HTTP table for them,
 *        written as a `Record` over the whole union so a seventh situation is
 *        a COMPILE ERROR here rather than a 500 on whichever surface nobody
 *        updated.
 *
 *        The CODE is separate from the status on purpose. A status is for
 *        caches, proxies and retry logic; a code is for a program deciding
 *        what to do. Two different refusals can share `403` and still need
 *        different handling — `feature_unavailable` means upgrade, `forbidden`
 *        means stop — and a client that had to tell them apart by reading the
 *        message would break the first time the copy improved.
 *
 *        This file is PURE: no Prisma, no gates, no request. It is the piece
 *        of the REST layer that can be tested exhaustively, and the mapping is
 *        the piece most worth testing.
 * WHERE: Every route under src/app/api/v1/.
 */

import { OPERATION_FAILURES, type OperationFailure } from "@/lib/errors";
import { API_ERROR_CODES, type ApiErrorCode } from "@/lib/types/api";

/* API_ERROR_CODES moved to @/lib/types/api — the wire vocabulary is part of
 * the PUBLIC CONTRACT, and the OpenAPI generator in src/lib/api/ needs it too.
 * A lib module may not import from src/app, so the constant lives in lib and
 * both read it from there. */

/**
 * SOURCE OF TRUTH KEYWORDS: OPERATION_FAILURE_TO_API_ERROR, THE_TABLE_IS_TOTAL
 *
 * One situation, one status, one code. The pairings match the tRPC table's
 * reasoning — `invalid_request` means change what you sent, `unprocessable`
 * means do not bother retrying, `precondition_failed` means do something else
 * first — and the statuses are the conventional ones for each.
 *
 * `422` for `unprocessable` and `400` for `invalid` is the distinction most
 * often collapsed, and keeping it is what lets a client retry intelligently: a
 * 400 is the caller's bug, a 422 is a fact about the thing it named.
 */
export const OPERATION_FAILURE_TO_API_ERROR: Readonly<
  Record<OperationFailure, { status: number; code: ApiErrorCode }>
> = {
  not_found: { status: 404, code: API_ERROR_CODES.not_found },
  invalid: { status: 400, code: API_ERROR_CODES.invalid_request },
  precondition: { status: 412, code: API_ERROR_CODES.precondition_failed },
  refused: { status: 403, code: API_ERROR_CODES.forbidden },
  unprocessable: { status: 422, code: API_ERROR_CODES.unprocessable },
  conflict: { status: 409, code: API_ERROR_CODES.conflict },
};

/* Asserted at module load rather than only in a test, because this file is the
 * public contract's translation layer and an incomplete table here answers a
 * real customer with a 500. The cost is one loop at import. */
for (const failure of OPERATION_FAILURES) {
  if (!(failure in OPERATION_FAILURE_TO_API_ERROR)) {
    throw new Error(
      `[api/v1] Operation failure "${failure}" has no HTTP mapping. ` +
        `Add it to OPERATION_FAILURE_TO_API_ERROR.`,
    );
  }
}

export interface ApiSuccess<T> {
  data: T;
  requestId: string;
}

export interface ApiFailure {
  error: { code: ApiErrorCode; message: string };
  requestId: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: apiOk, ONE_ENVELOPE_EVERY_RESPONSE
 *
 * WHAT:  A successful response.
 * WHY:   `status` is a parameter because a POST that created something should
 *        say 201 and one that was deduplicated by an idempotency key should
 *        say 200 — the body is identical and the status is the only place that
 *        distinction can live.
 * WHERE: Every route's happy path.
 */
export function apiOk<T>(
  data: T,
  requestId: string,
  options: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const body: ApiSuccess<T> = { data, requestId };

  return Response.json(body, {
    status: options.status ?? 200,
    headers: {
      /* A response that depends on a key must never be cached by a shared
       * proxy, and these responses always depend on one. */
      "Cache-Control": "no-store",
      ...options.headers,
    },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: apiFail, THE_MESSAGE_IS_FOR_A_PERSON
 *
 * WHAT:  A failed response.
 * WHY:   THE_MESSAGE_IS_FOR_A_PERSON and the code is for the program. The
 *        messages passed in here come from the operations and the registry —
 *        "This render costs 12 credits and this workspace has 3", the
 *        registry's own upgrade sentence — because those are already written
 *        for a customer. A generic "forbidden" would make every refusal a
 *        support ticket.
 * WHERE: Every route's failure paths, and the shared handler.
 */
export function apiFail(
  code: ApiErrorCode,
  message: string,
  status: number,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  const body: ApiFailure = { error: { code, message }, requestId };

  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
