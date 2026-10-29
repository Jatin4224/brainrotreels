/**
 * SOURCE OF TRUTH KEYWORDS: isStockDownloadHost, assertStockDownloadUrl,
 *   HOST_ALLOWLIST_IS_THE_CHECK, NO_SSRF_THROUGH_A_STORED_URL,
 *   stock host tests
 *
 * WHAT:  Which URLs the server will fetch a stock clip from.
 *
 * WHY:   This is the one check in Phase 14 with security consequences, and the
 *        only one whose failure is not visible in the finished video. A `stock`
 *        choice is STORED on a project and read back by a workflow that fetches
 *        it with our own network position — so anything that can write a
 *        project's settings and get that URL fetched has a request-forgery
 *        primitive aimed at our internal network, cloud metadata included.
 *
 *        The cases below are the ones a suffix check gets wrong, and they are
 *        written out as literals rather than generated, because the whole point
 *        is that somebody reading the diff can see the attack:
 *
 *          `pexels.com.attacker.example` ENDS WITH nothing in the list, but
 *          passes a naive `host.endsWith('pexels.com')` — which is the
 *          implementation anybody would write first. The dot boundary is the
 *          single line separating an allowlist from a decoration.
 *
 *          `http://` and `file://` have to be refused even on a legitimate
 *          host: a plaintext fetch of media we are about to store and serve is
 *          an on-path rewrite of the bytes.
 *
 *        Tested as an ALLOWLIST rather than against a list of bad hosts, so a
 *        host that nobody thought of is refused by default.
 * WHERE: Run by `npm test`. Guards src/lib/adapters/stock/hosts.ts, which is
 *        called before a choice is stored AND before its bytes are fetched.
 */

import { describe, expect, it } from "vitest";

import { assertStockDownloadUrl, isStockDownloadHost } from "./hosts";

describe("isStockDownloadHost", () => {
  it("accepts the provider's own delivery hosts", () => {
    expect(
      isStockDownloadHost("pexels", "https://videos.pexels.com/video-files/1/x.mp4"),
    ).toBe(true);
    expect(isStockDownloadHost("pexels", "https://pexels.com/x.mp4")).toBe(true);
  });

  /**
   * The case a suffix check gets wrong, and the reason the comparison is on a
   * dot boundary. If this ever returns true, every stored stock URL is an
   * outbound request to wherever an attacker likes.
   */
  it("refuses a host that merely ends with the allowed domain", () => {
    expect(
      isStockDownloadHost("pexels", "https://pexels.com.attacker.example/x.mp4"),
    ).toBe(false);
    expect(
      isStockDownloadHost("pexels", "https://notpexels.com/x.mp4"),
    ).toBe(false);
    expect(
      isStockDownloadHost("pexels", "https://evil.example/pexels.com/x.mp4"),
    ).toBe(false);
  });

  it("refuses anything that is not https, even on an allowed host", () => {
    expect(isStockDownloadHost("pexels", "http://videos.pexels.com/x.mp4")).toBe(
      false,
    );
    expect(isStockDownloadHost("pexels", "file:///etc/passwd")).toBe(false);
    expect(isStockDownloadHost("pexels", "ftp://videos.pexels.com/x.mp4")).toBe(
      false,
    );
  });

  /* The classic SSRF targets. They are refused because they are not on the
   * allowlist rather than because they are recognised as dangerous, which is
   * exactly why an allowlist was chosen over a blocklist. */
  it("refuses internal and metadata addresses", () => {
    for (const url of [
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/x.mp4",
      "https://127.0.0.1/x.mp4",
      "https://10.0.0.5/x.mp4",
      "https://[::1]/x.mp4",
    ]) {
      expect(isStockDownloadHost("pexels", url), url).toBe(false);
    }
  });

  /* A provider this build does not have means a choice written by an older
   * release or somebody probing — either way there is no allowlist to check
   * against, so it fails closed. */
  it("refuses a provider it has no hosts for", () => {
    expect(
      isStockDownloadHost("unsplash", "https://images.unsplash.com/x.jpg"),
    ).toBe(false);
  });

  it("refuses a string that is not a URL at all", () => {
    expect(isStockDownloadHost("pexels", "not a url")).toBe(false);
    expect(isStockDownloadHost("pexels", "")).toBe(false);
  });
});

describe("assertStockDownloadUrl", () => {
  it("passes a registered host silently", () => {
    expect(() =>
      assertStockDownloadUrl("pexels", "https://videos.pexels.com/x.mp4"),
    ).not.toThrow();
  });

  /* THROWS rather than returning a boolean, at both callsites, because a
   * boolean is a check somebody forgets to read. The reason is in the message
   * so an operator can tell a probe from a provider that changed its CDN. */
  it("throws for a bad host and names why", () => {
    expect(() =>
      assertStockDownloadUrl("pexels", "https://pexels.com.attacker.example/x.mp4"),
    ).toThrow(/bad_host/);
  });

  it("throws for an unregistered provider and names why", () => {
    expect(() =>
      assertStockDownloadUrl("unsplash", "https://images.unsplash.com/x.jpg"),
    ).toThrow(/unknown_provider/);
  });
});
