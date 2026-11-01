/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: api key format test, mintApiKey, hashApiKey,
 *   looksLikeApiKey, THE_SECRET_IS_NEVER_STORED, SHOWN_ONCE_NEVER_AGAIN,
 *   REFUSE_BEFORE_READING
 *
 * WHAT:  That a minted key has the entropy and the shape the format promises,
 *        that the stored digest is derived from the key handed out, and that
 *        the cheap shape test accepts exactly what minting produces.
 *
 * WHY:   The entropy assertion is the one worth having. Everything about the
 *        key design — a single unsalted SHA-256, a unique index, no slow KDF —
 *        rests on the secret being long and random
 *        (SHA256_IS_RIGHT_FOR_A_HIGH_ENTROPY_SECRET). If somebody later
 *        shortens the random part to make keys prettier, that reasoning
 *        silently stops holding and nothing else in the codebase would notice.
 *        So the length is asserted against the documented constant.
 *
 *        REFUSE_BEFORE_READING is asserted in both directions: the guard must
 *        accept every key minting produces (or valid keys would be rejected
 *        before the database is consulted, which is an outage) and reject the
 *        obvious wrong things (or the guard buys nothing).
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import {
  API_KEY_BYTES,
  API_KEY_PREFIX,
  apiKeyPrefix,
  hashApiKey,
  looksLikeApiKey,
  mintApiKey,
  sameSecret,
} from "./keys";

describe("minting a key", () => {
  it("starts with the recognisable prefix", () => {
    /* THE_PREFIX_NAMES_THE_PRODUCT — a leaked key has to be identifiable by a
     * secret scanner and by a person reading a log. */
    expect(mintApiKey().secret.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it("carries the full documented entropy", () => {
    /* base64url of N bytes is ceil(N * 4 / 3) characters with no padding.
     * Asserted against the constant so shortening the key breaks this test
     * rather than quietly invalidating the hashing argument. */
    const random = mintApiKey().secret.slice(API_KEY_PREFIX.length);
    expect(random.length).toBe(Math.ceil((API_KEY_BYTES * 4) / 3));
    expect(API_KEY_BYTES).toBeGreaterThanOrEqual(32);
  });

  it("never repeats", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      seen.add(mintApiKey().secret);
    }
    expect(seen.size).toBe(200);
  });

  it("returns a hash that belongs to the key it handed out", () => {
    /* The one correctness property that matters at mint time: a row storing a
     * digest for a different string is a key that authenticates nothing. */
    const minted = mintApiKey();
    expect(minted.hash).toBe(hashApiKey(minted.secret));
  });

  it("returns a prefix that is a prefix of the key", () => {
    const minted = mintApiKey();
    expect(minted.secret.startsWith(minted.prefix)).toBe(true);
    expect(minted.prefix).toBe(apiKeyPrefix(minted.secret));
  });

  it("keeps far more of the key secret than it reveals", () => {
    /* SHOWN_ONCE_NEVER_AGAIN only works if the visible part is useless on its
     * own. Six random characters shown, 37 withheld. */
    const minted = mintApiKey();
    const hidden = minted.secret.length - minted.prefix.length;
    expect(hidden).toBeGreaterThan(30);
  });

  it("uses no characters that need escaping in a header or a shell", () => {
    /* base64url, chosen because these strings live in env files, YAML and curl
     * commands. A `+`, `/` or `=` in any of those is somebody's bad afternoon. */
    for (let index = 0; index < 50; index += 1) {
      expect(mintApiKey().secret).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("hashing", () => {
  it("is stable for the same key", () => {
    expect(hashApiKey("brr_live_abc")).toBe(hashApiKey("brr_live_abc"));
  });

  it("differs for a key that differs by one character", () => {
    expect(hashApiKey("brr_live_abc")).not.toBe(hashApiKey("brr_live_abd"));
  });

  it("produces a fixed-length hex digest", () => {
    /* Fixed length is what lets the column be uniquely indexed and what makes
     * a length mismatch in `sameSecret` mean "not a digest". */
    expect(hashApiKey(mintApiKey().secret)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the cheap shape test", () => {
  it("accepts every key minting produces", () => {
    /* A false negative here is an outage: valid keys refused before the
     * database is consulted. */
    for (let index = 0; index < 100; index += 1) {
      expect(looksLikeApiKey(mintApiKey().secret)).toBe(true);
    }
  });

  it("rejects the obvious wrong things", () => {
    expect(looksLikeApiKey("")).toBe(false);
    expect(looksLikeApiKey("sk_live_somebody_elses_key")).toBe(false);
    /* A truncated copy-paste — the commonest real failure. */
    expect(looksLikeApiKey(mintApiKey().secret.slice(0, 20))).toBe(false);
    /* Something longer than a key of ours is not a key of ours. */
    expect(looksLikeApiKey(`${mintApiKey().secret}extra`)).toBe(false);
  });
});

describe("comparing secrets", () => {
  it("is true for the same string and false for a different one", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
  });

  it("answers false rather than throwing on a length mismatch", () => {
    /* `timingSafeEqual` throws on mismatched lengths, and a throw on the
     * authentication path would be a 500 where a refusal belongs. */
    expect(sameSecret("abc", "abcd")).toBe(false);
    expect(sameSecret("", "a")).toBe(false);
  });
});
