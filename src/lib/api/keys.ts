/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: mintApiKey, hashApiKey, apiKeyPrefix, API_KEY_BYTES,
 *   API_KEY_PREFIX, SHOWN_ONCE_NEVER_AGAIN, SHA256_IS_RIGHT_FOR_A_HIGH_ENTROPY_SECRET,
 *   THE_SECRET_IS_NEVER_STORED
 *
 * WHAT:  Generating a key, deriving the hash that is stored for it, and the
 *        visible prefix that identifies it afterwards. Pure, and separate from
 *        the service that persists any of it.
 *
 * WHY:   SHA256_IS_RIGHT_FOR_A_HIGH_ENTROPY_SECRET, and this is the decision
 *        most likely to be "corrected" by somebody applying password advice to
 *        something that is not a password.
 *
 *        A password hash is deliberately SLOW (bcrypt, argon2) because a
 *        password has perhaps 30 bits of entropy and the attack is an offline
 *        dictionary run: the only defence is to make each guess expensive. An
 *        API key here is 32 bytes from a CSPRNG — 256 bits, no dictionary, no
 *        structure to guess. Making each verification expensive defends
 *        against nothing and costs something real: this runs on EVERY request
 *        to the public API, so a deliberately slow KDF would add its own
 *        latency to every call and put our hashing cost into a customer's p99.
 *
 *        A single SHA-256 also buys the property that makes verification
 *        cheap: the digest is UNIQUE in the table, so checking a key is ONE
 *        indexed read. A slow KDF with a per-row salt cannot be looked up —
 *        it forces a scan over candidate rows and a comparison each, which is
 *        both slower and a worse shape (the number of keys a tenant holds
 *        would affect their API latency).
 *
 *        THE_SECRET_IS_NEVER_STORED. Only the digest and the prefix reach the
 *        database, so a leaked dump leaks no usable credential.
 *
 *        SHOWN_ONCE_NEVER_AGAIN: `mintApiKey` returns the plaintext exactly
 *        once, to its immediate caller, which hands it to the customer in the
 *        response that created it. Nothing stores it and no later read can
 *        recover it — which is why the UI has to be explicit that this is the
 *        only time they will see it.
 *
 *        This file is PURE: no Prisma, no `server-only`, no environment. It
 *        holds the FORMAT, so the format can be unit tested, and so the
 *        service below it is only about rows.
 * WHERE: src/services/api-keys.service.ts; the REST authenticator.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * SOURCE OF TRUTH KEYWORDS: API_KEY_PREFIX, THE_PREFIX_NAMES_THE_PRODUCT
 *
 * The literal start of every key. It exists so a leaked key is RECOGNISABLE:
 * secret scanners and a person reading a log can tell what this string is and
 * who to tell, which is the difference between a revoked key and a key nobody
 * realised was a key. `live` leaves room for a `test` sibling later without
 * changing the shape.
 */
export const API_KEY_PREFIX = "brr_live_";

/** 32 bytes — 256 bits from a CSPRNG. See the file header. */
export const API_KEY_BYTES = 32;

/**
 * How much of a key the UI may keep. Enough to tell two keys apart in a list,
 * far too little to be guessed from: the remaining secret is still 232 bits.
 */
const VISIBLE_RANDOM_CHARS = 6;

/**
 * SOURCE OF TRUTH KEYWORDS: mintApiKey, MintedApiKey, SHOWN_ONCE_NEVER_AGAIN
 *
 * WHAT:  A new key: the plaintext to show once, the digest to store, and the
 *        prefix to show forever.
 * WHY:   All three are derived together, so a caller cannot store a hash that
 *        does not belong to the key it handed out — which would produce a key
 *        that authenticates nothing and a row nobody can match to it.
 * WHERE: `apiKeys.create`.
 */
export interface MintedApiKey {
  /** Show this to the customer once. Never store it. */
  secret: string;
  hash: string;
  prefix: string;
}

export function mintApiKey(): MintedApiKey {
  /* base64url rather than hex: the same entropy in a third fewer characters,
   * and no characters that need escaping in a header, a shell or a YAML file —
   * which is where these actually live. */
  const random = randomBytes(API_KEY_BYTES).toString("base64url");
  const secret = `${API_KEY_PREFIX}${random}`;

  return {
    secret,
    hash: hashApiKey(secret),
    prefix: apiKeyPrefix(secret),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: hashApiKey, SHA256_IS_RIGHT_FOR_A_HIGH_ENTROPY_SECRET
 *
 * WHAT:  The digest stored for a key, and recomputed to verify one.
 * WHY:   Unsalted, deliberately. A salt defends against precomputation across
 *        a shared dictionary, and there is no dictionary of 256-bit random
 *        strings to precompute. What a salt WOULD cost here is the unique
 *        index — see the file header.
 * WHERE: Minting, and every authenticated API request.
 */
export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * SOURCE OF TRUTH KEYWORDS: apiKeyPrefix, THE_PREFIX_NAMES_THE_PRODUCT
 *
 * WHAT:  The part of a key the UI keeps showing.
 * WHERE: Minting, the key list, and the audit templates.
 */
export function apiKeyPrefix(secret: string): string {
  return secret.slice(0, API_KEY_PREFIX.length + VISIBLE_RANDOM_CHARS);
}

/**
 * SOURCE OF TRUTH KEYWORDS: looksLikeApiKey, REFUSE_BEFORE_READING
 *
 * WHAT:  Whether a presented string is shaped like one of our keys at all.
 *
 * WHY:   REFUSE_BEFORE_READING. A request carrying a session cookie's value,
 *        a truncated copy-paste or somebody's Stripe key should be refused
 *        WITHOUT a database read. It is not a security boundary — the digest
 *        lookup is — but it keeps a crawler spraying rubbish at the endpoint
 *        from turning into a query per request.
 *
 *        It checks the shape and NOT the characters, because the random half
 *        is base64url and a stricter test would be a second definition of the
 *        format that could drift from `mintApiKey`.
 * WHERE: The REST authenticator, before it touches the database.
 */
export function looksLikeApiKey(presented: string): boolean {
  if (!presented.startsWith(API_KEY_PREFIX)) return false;

  const random = presented.slice(API_KEY_PREFIX.length);
  /* base64url of 32 bytes is 43 characters with no padding. Exact rather than
   * a minimum: a longer string is not a key of ours. */
  return random.length === 43;
}

/**
 * SOURCE OF TRUTH KEYWORDS: sameSecret, CONSTANT_TIME_COMPARE
 *
 * WHAT:  Compares two digests without leaking where they first differ.
 *
 * WHY:   The lookup is by digest on a unique index, so in the normal path
 *        there is nothing to compare — the row either exists or it does not.
 *        This exists for the defence-in-depth comparison a caller may want
 *        after a lookup, and it is here rather than inline so the one correct
 *        way to compare a secret in this codebase has a name.
 *
 *        `timingSafeEqual` throws on a length mismatch, which is itself a
 *        leak-free answer (digests are fixed length, so a mismatch means the
 *        input was never a digest) — so the length is checked first and
 *        answered `false`.
 * WHERE: src/services/api-keys.service.ts.
 */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
