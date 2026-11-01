/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: envelope test, OPERATION_FAILURE_TO_API_ERROR,
 *   THE_TABLE_IS_TOTAL, ONE_ENVELOPE_EVERY_RESPONSE,
 *   REQUEST_ID_IS_ALWAYS_PRESENT, requestFingerprint
 *
 * WHAT:  That every operation failure has an HTTP mapping, that the two
 *        response shapes are the only two, and that an idempotency
 *        fingerprint changes when the request changes and not when it does
 *        not.
 *
 * WHY:   This is the REST half of the drift guard the tRPC mapping has. Phase
 *        17's whole promise is that three surfaces share their logic, which
 *        only works if each one translates the shared failure vocabulary
 *        completely. A MISSING entry is a compile error and also throws at
 *        module load; a WRONG one — `refused` as a 404, `invalid` and
 *        `unprocessable` swapped — type-checks perfectly and changes what a
 *        client does about it. So the pairings are asserted explicitly.
 *
 *        The fingerprint assertions are the ones that stop idempotency being
 *        worse than nothing. If it ignored the body, a client reusing a key
 *        for a second request would be handed the FIRST request's answer to a
 *        different question — a silently wrong success. If it included a
 *        header that changes between retries, the deduplication would never
 *        fire and the feature would be decorative.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { OPERATION_FAILURES } from "@/lib/errors";
import { API_ERROR_CODES } from "@/lib/types/api";

import { OPERATION_FAILURE_TO_API_ERROR, apiFail, apiOk } from "./envelope";
import { requestFingerprint } from "./idempotency";

describe("the failure table", () => {
  it("has an entry for every failure, and no others", () => {
    expect(Object.keys(OPERATION_FAILURE_TO_API_ERROR).sort()).toEqual(
      [...OPERATION_FAILURES].sort(),
    );
  });

  it("maps each failure to the documented status and code", () => {
    expect(OPERATION_FAILURE_TO_API_ERROR).toEqual({
      not_found: { status: 404, code: API_ERROR_CODES.not_found },
      invalid: { status: 400, code: API_ERROR_CODES.invalid_request },
      precondition: {
        status: 412,
        code: API_ERROR_CODES.precondition_failed,
      },
      refused: { status: 403, code: API_ERROR_CODES.forbidden },
      unprocessable: { status: 422, code: API_ERROR_CODES.unprocessable },
      conflict: { status: 409, code: API_ERROR_CODES.conflict },
    });
  });

  it("keeps 400 and 422 distinct", () => {
    /* The distinction most often collapsed, and the one that lets a client
     * retry intelligently: a 400 is the caller's bug, a 422 is a fact about
     * the thing it named. */
    expect(OPERATION_FAILURE_TO_API_ERROR.invalid.status).not.toBe(
      OPERATION_FAILURE_TO_API_ERROR.unprocessable.status,
    );
  });

  it("uses a status every HTTP client already understands", () => {
    for (const mapped of Object.values(OPERATION_FAILURE_TO_API_ERROR)) {
      expect(mapped.status).toBeGreaterThanOrEqual(400);
      expect(mapped.status).toBeLessThan(500);
    }
  });
});

describe("the success envelope", () => {
  it("is exactly { data, requestId }", async () => {
    const response = apiOk({ id: "p_1" }, "req_abc");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { id: "p_1" },
      requestId: "req_abc",
    });
  });

  it("can carry a created status", () => {
    expect(apiOk({}, "req_abc", { status: 201 }).status).toBe(201);
  });

  it("is never cached by a shared proxy", () => {
    /* Every response depends on a key, so a caching proxy would be able to
     * serve one workspace's answer to another. */
    expect(apiOk({}, "req_abc").headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("the failure envelope", () => {
  it("is exactly { error: { code, message }, requestId }", async () => {
    const response = apiFail(
      API_ERROR_CODES.not_found,
      "Project not found",
      404,
      "req_abc",
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Project not found" },
      requestId: "req_abc",
    });
  });

  it("carries the request id, which is what a customer quotes", () => {
    /* REQUEST_ID_IS_ALWAYS_PRESENT — on failures especially. */
    const response = apiFail(
      API_ERROR_CODES.internal_error,
      "Something went wrong.",
      500,
      "req_xyz",
    );
    return response.json().then((body: unknown) => {
      expect(body).toMatchObject({ requestId: "req_xyz" });
    });
  });

  it("passes extra headers through, for the 429 reset hint", () => {
    const response = apiFail(
      API_ERROR_CODES.rate_limited,
      "Slow down.",
      429,
      "req_abc",
      { "Retry-After": "60" },
    );
    expect(response.headers.get("Retry-After")).toBe("60");
  });
});

describe("the idempotency fingerprint", () => {
  const base = { method: "POST", path: "/api/v1/renders", body: '{"a":1}' };

  it("is stable for an identical request", () => {
    /* If this were unstable, a retry would never match and the header would be
     * decorative. */
    expect(requestFingerprint(base)).toBe(requestFingerprint({ ...base }));
  });

  it("changes when the body changes", () => {
    /* THE_FINGERPRINT_CATCHES_A_REUSED_KEY — the alternative is handing the
     * first request's answer to a different question. */
    expect(requestFingerprint(base)).not.toBe(
      requestFingerprint({ ...base, body: '{"a":2}' }),
    );
  });

  it("changes when the path changes", () => {
    expect(requestFingerprint(base)).not.toBe(
      requestFingerprint({ ...base, path: "/api/v1/projects" }),
    );
  });

  it("changes when the method changes", () => {
    expect(requestFingerprint(base)).not.toBe(
      requestFingerprint({ ...base, method: "PUT" }),
    );
  });

  it("cannot be confused by a field boundary", () => {
    /* The parts are joined with a newline rather than concatenated, so a path
     * ending in what the body begins with cannot produce the same digest as a
     * different split of the same characters. */
    expect(
      requestFingerprint({ method: "POST", path: "/a", body: "b" }),
    ).not.toBe(requestFingerprint({ method: "POST", path: "/ab", body: "" }));
  });
});
