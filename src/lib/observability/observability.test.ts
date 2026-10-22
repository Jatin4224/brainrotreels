/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: observability test, ONE_ID_ACROSS_THE_WHOLE_JOURNEY,
 *   ID_IS_CARRIED_NOT_DERIVED, REQUEST_ID_CROSSES_THE_QUEUE,
 *   THE_FUNNEL_IS_FIVE_EVENTS
 *
 * WHAT:  The correlation id's two halves — resolving one from a request, and
 *        reading one back off a queued event.
 *
 * WHY:   The phase's own check is that a forced error appears in Sentry with
 *        its `requestId`, traceable to the render it came from. That property
 *        is the whole chain holding: the proxy stamps an id, the context reads
 *        it, the enqueue carries it, and the workflow reads it back. The two
 *        pure ends of that chain are testable here, and both failure modes are
 *        silent — an id that is minted twice produces two unrelated halves of
 *        one journey, and an id that is dropped at the queue produces a
 *        workflow whose logs correlate with nothing.
 *
 *        The SANITISATION is the part worth testing hardest. The inbound header
 *        is attacker-controlled on a request that reaches the app directly, and
 *        the value ends up in log lines and a Sentry tag — so an unbounded or
 *        newline-bearing id is a log-injection vector rather than a correlation
 *        key.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { FUNNEL_EVENTS } from "./analytics";
import {
  REQUEST_ID_HEADER,
  newRequestId,
  readRequestId,
  resolveRequestId,
} from "./request-id";

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("newRequestId", () => {
  it("produces a short, opaque, URL-safe id", () => {
    const id = newRequestId();
    expect(id).toMatch(/^[a-f0-9]+$/);
    /* Short enough to read out loud to a customer, which is what it is for. */
    expect(id.length).toBeLessThanOrEqual(32);
    expect(id.length).toBeGreaterThanOrEqual(16);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRequestId()));
    expect(ids.size).toBe(500);
  });
});

describe("resolveRequestId", () => {
  /* ID_IS_CARRIED_NOT_DERIVED — an id the platform already set is PREFERRED,
   * so our logs correlate with the one log stream we do not control. */
  it("prefers an id the request already carries", () => {
    expect(resolveRequestId(headers({ [REQUEST_ID_HEADER]: "abc123" }))).toBe(
      "abc123",
    );
  });

  it("falls back through the platform headers in order", () => {
    expect(resolveRequestId(headers({ "x-vercel-id": "iad1::xyz" }))).toBe(
      "iad1::xyz",
    );
    expect(resolveRequestId(headers({ "cf-ray": "8a1b2c3d4e5f" }))).toBe(
      "8a1b2c3d4e5f",
    );
  });

  it("prefers our own header over the platform's", () => {
    const id = resolveRequestId(
      headers({ [REQUEST_ID_HEADER]: "ours", "x-vercel-id": "theirs" }),
    );
    /* Ours wins because the proxy sets it from the platform's value anyway —
     * so by the time anything downstream reads it, the two agree. */
    expect(id).toBe("ours");
  });

  it("mints one when nothing upstream supplied it", () => {
    const id = resolveRequestId(headers({}));
    expect(id.length).toBeGreaterThan(0);
  });

  /* Never null, so no consumer needs a fallback of its own — an unidentified
   * log line is the thing this module exists to prevent. */
  it("never returns an empty id", () => {
    expect(resolveRequestId(headers({ [REQUEST_ID_HEADER]: "" }))).not.toBe("");
    expect(
      resolveRequestId(headers({ [REQUEST_ID_HEADER]: "   " })).length,
    ).toBeGreaterThan(0);
  });

  /* A raw newline cannot reach us through a header at all — the `Headers` API
   * rejects the value outright, which is one layer of this defence and is
   * asserted below. What CAN arrive is everything else a forged log line
   * needs: quotes, braces, colons, commas and spaces. Those are stripped. */
  it("strips the characters a forged log line would need", () => {
    const hostile = resolveRequestId(
      headers({
        [REQUEST_ID_HEADER]: 'abc", "level": "info", "event": "forged"',
      }),
    );

    expect(hostile).not.toContain('"');
    expect(hostile).not.toContain(" ");
    expect(hostile).not.toContain(",");
    expect(hostile).toContain("abc");
  });

  it("cannot receive a newline in the first place", () => {
    /* Documenting the platform guarantee this module leans on, so that a
     * future change to a non-header source (a query parameter, a body field)
     * is understood to be LOSING a layer rather than merely moving one. */
    expect(() => headers({ [REQUEST_ID_HEADER]: "abc\ninjected" })).toThrow();
  });

  it("strips braces if they do arrive", () => {
    expect(resolveRequestId(headers({ [REQUEST_ID_HEADER]: "a{b}c" }))).toBe(
      "abc",
    );
  });

  it("bounds the length of an inbound id", () => {
    const id = resolveRequestId(
      headers({ [REQUEST_ID_HEADER]: "a".repeat(5_000) }),
    );
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it("keeps the characters a real platform id uses", () => {
    /* Vercel uses `::`, and ids commonly carry hyphens and underscores.
     * Stripping those would mean never matching the platform's own value. */
    expect(resolveRequestId(headers({ "x-vercel-id": "iad1::a-b_c" }))).toBe(
      "iad1::a-b_c",
    );
  });
});

describe("readRequestId", () => {
  /* REQUEST_ID_CROSSES_THE_QUEUE — the jobs adapter merges the envelope's id
   * into `data`, and this is the reader on the far side. */
  it("reads the id a queued event carries", () => {
    expect(readRequestId({ projectId: "p1", requestId: "req_42" })).toBe(
      "req_42",
    );
  });

  it("mints one for an event with no id — a cron tick or a webhook", () => {
    expect(readRequestId({ projectId: "p1" }).length).toBeGreaterThan(0);
  });

  /* It takes `unknown` because a workflow reads this BEFORE parsing its
   * payload — the id is wanted precisely when the payload turns out to be
   * invalid and somebody has to find out why. */
  it("survives anything at all", () => {
    expect(readRequestId(null).length).toBeGreaterThan(0);
    expect(readRequestId(undefined).length).toBeGreaterThan(0);
    expect(readRequestId("a string").length).toBeGreaterThan(0);
    expect(readRequestId(42).length).toBeGreaterThan(0);
    expect(readRequestId([]).length).toBeGreaterThan(0);
    expect(readRequestId({ requestId: 42 }).length).toBeGreaterThan(0);
    expect(readRequestId({ requestId: "" }).length).toBeGreaterThan(0);
  });

  it("sanitises an id that crossed the queue too", () => {
    const id = readRequestId({ requestId: 'x"\ninjected' });
    expect(id).not.toContain("\n");
    expect(id).toContain("x");
  });
});

describe("the funnel", () => {
  /* THE_FUNNEL_IS_FIVE_EVENTS. The set is closed on purpose — an event nobody
   * has a question for is a row in somebody's bill forever. */
  it("is the five steps the phase asks for, in order", () => {
    expect([...FUNNEL_EVENTS]).toEqual([
      "signed_up",
      "first_script",
      "first_generation",
      "first_render",
      "purchased",
    ]);
  });

  it("names every event in snake case, matching PostHog's convention", () => {
    for (const event of FUNNEL_EVENTS) {
      expect(event, event).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});
