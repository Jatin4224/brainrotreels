/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: request-origin.test, originFromHeaders,
 *   FORWARDED_BEATS_HOST, HTTPS_IS_THE_DEFAULT_PROTOCOL,
 *   A_COPIED_SNIPPET_NAMES_ITS_DEPLOYMENT
 *
 * WHAT:  Which header wins, and what the protocol falls back to.
 *
 * WHY:   A_COPIED_SNIPPET_NAMES_ITS_DEPLOYMENT is the consequence being
 *        protected. The output of this function goes into a curl command and
 *        an MCP config block that a customer copies — so getting the
 *        precedence wrong does not throw, it hands somebody a snippet aimed at
 *        the wrong host, inside a code block where nobody looks twice.
 *
 *        `resolveRequestOrigin` is not tested: it is this function plus an
 *        `await headers()`, which needs a Next request scope. The precedence
 *        is the part worth pinning, which is why it was split out.
 * WHERE: src/lib/request-origin.ts.
 */

import { describe, expect, it } from "vitest";

import { APP_URL } from "@/lib/config/branding";
import { originFromHeaders } from "./request-origin";

const headers = (entries: Record<string, string>): Headers =>
  new Headers(entries);

describe("originFromHeaders", () => {
  it("prefers x-forwarded-host over host", () => {
    /* FORWARDED_BEATS_HOST — behind a proxy, `host` is the proxy's view of
     * itself and the forwarded name is what the client actually asked for. */
    expect(
      originFromHeaders(
        headers({
          "x-forwarded-host": "app.example.com",
          host: "internal-lb.local",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://app.example.com");
  });

  it("falls back to host when nothing was forwarded", () => {
    expect(
      originFromHeaders(
        headers({ host: "localhost:3000", "x-forwarded-proto": "http" }),
      ),
    ).toBe("http://localhost:3000");
  });

  it("defaults the protocol to https", () => {
    /* HTTPS_IS_THE_DEFAULT_PROTOCOL. A snippet pointing at `http://` fails in
     * a way that reads as our bug rather than as a missing header. */
    expect(originFromHeaders(headers({ host: "app.example.com" }))).toBe(
      "https://app.example.com",
    );
  });

  it("falls back to the configured URL when there is no host at all", () => {
    /* A direct server render or a synthetic request. Better a configured URL
     * than a broken one. */
    expect(originFromHeaders(headers({}))).toBe(APP_URL);
  });

  it("treats an empty host as no host", () => {
    /* `new Headers({ host: "" })` keeps the key with an empty value, which
     * would otherwise build `https://` and produce an unusable snippet. */
    expect(originFromHeaders(headers({ host: "" }))).toBe(APP_URL);
  });

  it("keeps the port, which is what makes a local snippet work", () => {
    expect(
      originFromHeaders(
        headers({ "x-forwarded-host": "127.0.0.1:4000", "x-forwarded-proto": "http" }),
      ),
    ).toBe("http://127.0.0.1:4000");
  });
});
