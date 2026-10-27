/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: reddit url tests, HOST_IS_AN_ALLOWLIST,
 *   A_QUERY_PARAM_IS_NOT_A_HOST, SHARE_LINKS_ARE_REFUSED, POST_ID_IS_BASE36,
 *   CANONICAL_DROPS_THE_QUERY
 *
 * WHAT:  Tests for the host allowlist and the thread-id parser.
 *
 * WHY:   This is the check the phase singles out: "a URL that merely contains
 *        'reddit' in a query parameter is not a Reddit URL". The obvious
 *        implementations are all wrong in ways that only a hostile input shows,
 *        so the tests are mostly hostile inputs — a substring match, a suffix
 *        match, a lookalike domain and a credential-carrying URL each get their
 *        own case, and each one is a real technique rather than a hypothetical.
 *
 *        The parse is also the thing standing between a crafted permalink and
 *        the request path this adapter builds, which is why the id's character
 *        class is asserted directly (POST_ID_IS_BASE36).
 * WHERE: Run by `npm test`. Guards src/lib/adapters/reddit/url.ts. Pure — no
 *        network, no credential.
 */

import { describe, expect, it } from "vitest";

import { isRedditHost, parseRedditThreadUrl } from "./url";

describe("isRedditHost", () => {
  it("accepts the hostnames people actually paste", () => {
    for (const host of [
      "reddit.com",
      "www.reddit.com",
      "old.reddit.com",
      "np.reddit.com",
      "m.reddit.com",
      "redd.it",
    ]) {
      expect(isRedditHost(host), host).toBe(true);
    }
  });

  it("is case-insensitive and tolerates a fully-qualified trailing dot", () => {
    expect(isRedditHost("WWW.Reddit.COM")).toBe(true);
    expect(isRedditHost("www.reddit.com.")).toBe(true);
  });

  /**
   * A_QUERY_PARAM_IS_NOT_A_HOST and the two neighbouring mistakes. Each of
   * these passes a naive check:
   *   `includes('reddit.com')`  → the query-param and the path cases
   *   `endsWith('reddit.com')`  → notreddit.com
   *   a prefix check            → reddit.com.evil.example
   */
  it("rejects every lookalike", () => {
    for (const host of [
      "notreddit.com",
      "reddit.com.evil.example",
      "evil-reddit.com",
      "reddit.co",
      "reddit.com.br",
      "redditmedia.com",
      /* The API host is ours to call, never one a customer may name. */
      "oauth.reddit.com",
      "localhost",
      "169.254.169.254",
    ]) {
      expect(isRedditHost(host), host).toBe(false);
    }
  });
});

describe("parseRedditThreadUrl", () => {
  it("reads the id out of a canonical permalink", () => {
    const parsed = parseRedditThreadUrl(
      "https://www.reddit.com/r/AmItheAsshole/comments/1a2b3c/my_roommate_ate_my_leftovers/",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.postId).toBe("1a2b3c");
    expect(parsed.subreddit).toBe("AmItheAsshole");
  });

  it("accepts a permalink with the slug trimmed, and the short in-site form", () => {
    expect(
      parseRedditThreadUrl("https://www.reddit.com/r/tifu/comments/abcd12"),
    ).toMatchObject({ ok: true, postId: "abcd12" });
    expect(
      parseRedditThreadUrl("https://reddit.com/comments/abcd12"),
    ).toMatchObject({ ok: true, postId: "abcd12", subreddit: null });
  });

  it("accepts the shortener", () => {
    expect(parseRedditThreadUrl("https://redd.it/abcd12")).toMatchObject({
      ok: true,
      postId: "abcd12",
    });
  });

  /* CANONICAL_DROPS_THE_QUERY — tracking parameters, `?context=3` and session
   * junk never reach the database or a card on screen. */
  it("rebuilds a clean canonical URL", () => {
    const parsed = parseRedditThreadUrl(
      "https://old.reddit.com/r/tifu/comments/abcd12/slug/?utm_source=share&context=3",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.canonical).toBe(
      "https://www.reddit.com/r/tifu/comments/abcd12",
    );
  });

  it("lower-cases the id so one thread is one canonical URL", () => {
    expect(
      parseRedditThreadUrl("https://redd.it/ABCD12"),
    ).toMatchObject({ ok: true, postId: "abcd12" });
  });

  /**
   * The headline case. Each of these is a non-Reddit URL that a substring
   * check would accept.
   */
  it("refuses a URL that merely mentions reddit", () => {
    for (const url of [
      "https://evil.example/?next=https://www.reddit.com/r/tifu/comments/abcd12",
      "https://evil.example/www.reddit.com/comments/abcd12",
      "https://notreddit.com/r/tifu/comments/abcd12",
      "https://reddit.com.evil.example/comments/abcd12",
    ]) {
      expect(parseRedditThreadUrl(url), url).toEqual({
        ok: false,
        refusal: "not_reddit",
      });
    }
  });

  it("refuses a non-https scheme rather than upgrading it", () => {
    expect(
      parseRedditThreadUrl("http://www.reddit.com/comments/abcd12"),
    ).toEqual({ ok: false, refusal: "wrong_scheme" });
    expect(parseRedditThreadUrl("file:///etc/passwd")).toEqual({
      ok: false,
      refusal: "wrong_scheme",
    });
  });

  /* SHARE_LINKS_ARE_REFUSED — resolving one means following a redirect to find
   * out what the customer meant, which is a new attack surface for a
   * convenience. The refusal names the fix. */
  it("refuses a share link by name", () => {
    expect(
      parseRedditThreadUrl("https://www.reddit.com/r/tifu/s/aBcDeFgHiJ"),
    ).toEqual({ ok: false, refusal: "share_link" });
  });

  it("refuses a subreddit or profile URL, which is the common mistake", () => {
    for (const url of [
      "https://www.reddit.com/r/tifu/",
      "https://www.reddit.com/r/tifu/top/?t=week",
      "https://www.reddit.com/user/someone/",
      "https://www.reddit.com/",
    ]) {
      expect(parseRedditThreadUrl(url), url).toEqual({
        ok: false,
        refusal: "no_post_id",
      });
    }
  });

  /* POST_ID_IS_BASE36 — the id ends up in a request path, so a traversal or a
   * query injection must not survive the parse. */
  it("refuses an id that is not base-36", () => {
    for (const url of [
      "https://www.reddit.com/r/tifu/comments/..%2f..%2fetc/",
      "https://www.reddit.com/r/tifu/comments/ab/",
      "https://www.reddit.com/r/tifu/comments/abc-123/",
      "https://www.reddit.com/r/tifu/comments/abcdefghijklmnopqrstuvwxyz/",
    ]) {
      expect(parseRedditThreadUrl(url), url).toEqual({
        ok: false,
        refusal: "no_post_id",
      });
    }
  });

  it("refuses an unparseable string", () => {
    for (const value of ["", "   ", "not a url", "reddit.com/comments/abcd12"]) {
      expect(parseRedditThreadUrl(value), value).toEqual({
        ok: false,
        refusal: "unparseable",
      });
    }
  });

  /**
   * A credential-carrying URL reads to a human as pointing at reddit.com and
   * to a parser as pointing somewhere else. The host check sees the real host,
   * which is the only reading that cannot surprise anybody — and the SSRF
   * guard refuses it a second time for the same reason.
   */
  it("is not fooled by userinfo before the host", () => {
    expect(
      parseRedditThreadUrl(
        "https://www.reddit.com@evil.example/comments/abcd12",
      ),
    ).toEqual({ ok: false, refusal: "not_reddit" });
  });
});
