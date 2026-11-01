/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: gates.test, quotaRefusal, A_429_CARRIES_ITS_RESET,
 *   THE_RESET_IS_A_FACT_NOT_A_GUESS, THE_PURE_HALF_IS_THE_TESTED_HALF
 *
 * WHAT:  The quota refusal's shape: its code, its status, its reset headers,
 *        and the cases that must NOT get a reset.
 *
 * WHY:   THE_PURE_HALF_IS_THE_TESTED_HALF. `checkApiEntitlements` reads the
 *        database, so what is asserted here is the function that decides what
 *        a refusal LOOKS like — which is where the phase's done-when actually
 *        lives: "exceeding the daily quota returns 429 with a reset hint".
 *
 *        The periodic / absolute distinction is the case most worth pinning.
 *        A `Retry-After` on a cap that does not reset tells a client to come
 *        back and be refused again, forever, which is worse than no hint at
 *        all — so it is asserted as an absence, not left to inspection.
 * WHERE: src/lib/api/gates.ts.
 */

import { describe, expect, it } from "vitest";

import { quotaRefusal } from "./gates";
import { API_ERROR_CODES } from "@/lib/types/api";

/* `apiCalls` is monthly; `member` is an absolute cap — seats a workspace holds
 * until somebody removes one. Both are read from the registry by the function
 * under test, so these are not stand-ins: they are the real resources whose
 * `period` (or absence of one) decides the behaviour. */
const PERIODIC = "apiCalls";
const ABSOLUTE = "member";

const GATE = {
  reason: "You have reached your plan limit for API calls.",
  upgradeMessage: "Upgrade to Pro for more API calls",
  limit: 1000,
} as const;

describe("quotaRefusal", () => {
  it("is a 429 with the quota_exceeded code, not a 403", () => {
    /* A quota is a thing that RESETS, and the difference between "never" and
     * "not yet" is exactly what a client's retry logic branches on. */
    const refusal = quotaRefusal(PERIODIC, GATE);

    expect(refusal.status).toBe(429);
    expect(refusal.code).toBe(API_ERROR_CODES.quota_exceeded);
  });

  it("carries RateLimit-Reset and Retry-After for a periodic quota", () => {
    const refusal = quotaRefusal(PERIODIC, GATE);

    expect(refusal.headers["RateLimit-Reset"]).toBeDefined();
    expect(refusal.headers["Retry-After"]).toBeDefined();
    /* The one wire format, from `buildRateLimitHeaders` — the same headers the
     * per-key sliding window emits, so a client parses one shape. */
    expect(refusal.headers["RateLimit-Limit"]).toBe("1000");
    expect(refusal.headers["RateLimit-Remaining"]).toBe("0");
  });

  it("points the reset at a future instant", () => {
    const refusal = quotaRefusal(PERIODIC, GATE);

    const resetSeconds = Number(refusal.headers["RateLimit-Reset"]);
    expect(Number.isFinite(resetSeconds)).toBe(true);
    expect(resetSeconds * 1000).toBeGreaterThan(Date.now());

    /* And `Retry-After` is a positive number of seconds, never zero — a client
     * told to wait zero seconds retries immediately and is refused again. */
    expect(Number(refusal.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("says the reset time in the message too, for the surfaces with no headers", () => {
    /* MCP has no response headers and a model reads prose, so the same fact
     * appears twice for two kinds of reader. */
    const refusal = quotaRefusal(PERIODIC, GATE);

    expect(refusal.message).toContain(GATE.reason);
    expect(refusal.message).toContain("resets on");
  });

  it("gives an absolute cap NO reset, because it does not reset", () => {
    const refusal = quotaRefusal(ABSOLUTE, GATE);

    expect(refusal.status).toBe(429);
    expect(refusal.headers).toEqual({});
    /* And the message makes no promise about a reset that will never happen. */
    expect(refusal.message).not.toContain("resets on");
  });

  it("falls back to the registry's upgrade sentence when the gate gave no reason", () => {
    /* The upgrade copy is written for a customer; a generic "quota exceeded"
     * would make every refusal a support ticket. */
    const refusal = quotaRefusal(ABSOLUTE, {
      upgradeMessage: GATE.upgradeMessage,
    });

    expect(refusal.message).toBe(GATE.upgradeMessage);
  });

  it("reports a zero limit rather than omitting the header when the gate gave none", () => {
    /* A trial refusal has no numeric limit. The header set stays complete so a
     * client never has to branch on a missing one. */
    const refusal = quotaRefusal(PERIODIC, {
      upgradeMessage: GATE.upgradeMessage,
    });

    expect(refusal.headers["RateLimit-Limit"]).toBe("0");
    expect(refusal.headers["Retry-After"]).toBeDefined();
  });
});
