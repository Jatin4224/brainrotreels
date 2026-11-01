/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: claimIdempotencyKey, storeIdempotentResponse,
 *   releaseIdempotencyKey, IDEMPOTENCY_IS_PER_ORGANIZATION,
 *   THE_FINGERPRINT_CATCHES_A_REUSED_KEY, A_FAILURE_RELEASES_THE_CLAIM,
 *   WITHOUT_REDIS_THERE_IS_NO_DEDUPLICATION
 *
 * WHAT:  `Idempotency-Key` support for the POST routes: claim a key, replay a
 *        stored response, or refuse a key being reused for something else.
 *
 * WHY:   The phase file asks for `Idempotency-Key` on POSTs, and its done-when
 *        is "repeating a POST with the same Idempotency-Key does not create a
 *        second render". The reason it matters more here than on the web is
 *        that an API client retries: a timeout, a lambda replay or a CI job
 *        run twice would otherwise each charge a render.
 *
 *        THE_FINGERPRINT_CATCHES_A_REUSED_KEY. A stored entry holds a hash of
 *        the method, path and body alongside the response. The same key with
 *        the SAME request replays the stored response; the same key with a
 *        DIFFERENT request is a CONFLICT rather than a replay, because that is
 *        a client bug — a key generated once per process instead of once per
 *        request — and silently returning the first call's answer to the second
 *        call's question is the worst possible response to it.
 *
 *        Three states, not two: `pending` exists so two concurrent requests
 *        with one key do not both run. The claim is a `SET NX`, so exactly one
 *        caller wins; the loser is told the first is still in flight rather
 *        than being allowed to duplicate the work.
 *
 *        A_FAILURE_RELEASES_THE_CLAIM. If the handler fails, the claim is
 *        deleted so the client's retry — the thing an idempotency key exists
 *        to make safe — can actually proceed. Leaving the claim would lock the
 *        key for its whole TTL and turn one failed request into 24 hours of
 *        conflicts. Only SUCCESSFUL responses are stored.
 *
 *        IDEMPOTENCY_IS_PER_ORGANIZATION. The Redis key includes the
 *        organization, so one tenant cannot probe for, collide with or replay
 *        another tenant's keys by guessing a value.
 *
 *        WITHOUT_REDIS_THERE_IS_NO_DEDUPLICATION, and this is stated rather
 *        than hidden: with nothing configured every call behaves as if no key
 *        was sent. That is the same fail-open choice rate limiting makes and
 *        for a weaker reason — here it means a retry can double-charge — so it
 *        is the one piece of this phase that genuinely needs Redis in
 *        production rather than merely benefiting from it.
 * WHERE: `runApiRoute` in ./handler.ts, for the POST routes only.
 */

import "server-only";

import { createHash } from "node:crypto";

import { getRedisClient } from "@/lib/redis";

/** A day, which is the convention clients expect for a retry window. */
const TTL_SECONDS = 24 * 60 * 60;

/** Enough to be unguessable, short enough to read in a log. */
const MAX_KEY_LENGTH = 255;

export const IDEMPOTENCY_HEADER = "idempotency-key";

interface StoredEntry {
  state: "pending" | "done";
  fingerprint: string;
  status?: number;
  body?: string;
}

export type IdempotencyClaim =
  /** Nothing to do — no key sent, or no Redis configured. */
  | { kind: "not-applicable" }
  /** This caller owns the key and must run the work. */
  | { kind: "claimed"; redisKey: string; fingerprint: string }
  /** A stored response for the identical request. */
  | { kind: "replay"; status: number; body: string }
  /** The key is in use for a different request, or one still running. */
  | { kind: "conflict"; message: string };

/**
 * SOURCE OF TRUTH KEYWORDS: requestFingerprint, THE_FINGERPRINT_CATCHES_A_REUSED_KEY
 *
 * WHAT:  A hash of what makes this request what it is.
 * WHY:   Method, path and body — not headers, because a retry legitimately
 *        changes `User-Agent`, tracing headers and `Content-Length`, and a
 *        fingerprint that included them would never match its own retry.
 * WHERE: Claiming and comparing.
 */
export function requestFingerprint(args: {
  method: string;
  path: string;
  body: string;
}): string {
  return createHash("sha256")
    .update(`${args.method}\n${args.path}\n${args.body}`, "utf8")
    .digest("hex");
}

/**
 * SOURCE OF TRUTH KEYWORDS: claimIdempotencyKey, A_FAILURE_RELEASES_THE_CLAIM
 *
 * WHAT:  Decides what this request may do: run, replay, or be refused.
 * WHERE: The start of a POST route, before any work.
 */
export async function claimIdempotencyKey(args: {
  organizationId: string;
  presentedKey: string | null;
  fingerprint: string;
}): Promise<IdempotencyClaim> {
  const { organizationId, presentedKey, fingerprint } = args;

  if (presentedKey === null || presentedKey.length === 0) {
    return { kind: "not-applicable" };
  }
  if (presentedKey.length > MAX_KEY_LENGTH) {
    return {
      kind: "conflict",
      message: `Idempotency-Key must be ${MAX_KEY_LENGTH} characters or fewer.`,
    };
  }

  const redis = getRedisClient();
  /* WITHOUT_REDIS_THERE_IS_NO_DEDUPLICATION — see the file header. */
  if (redis === null) return { kind: "not-applicable" };

  /* IDEMPOTENCY_IS_PER_ORGANIZATION. The presented key is hashed rather than
   * interpolated, so a caller cannot shape the Redis keyspace with colons. */
  const redisKey = `idem:${organizationId}:${createHash("sha256")
    .update(presentedKey, "utf8")
    .digest("hex")}`;

  const pending: StoredEntry = { state: "pending", fingerprint };

  try {
    const claimed = await redis.set(redisKey, JSON.stringify(pending), {
      nx: true,
      ex: TTL_SECONDS,
    });

    if (claimed === "OK") {
      return { kind: "claimed", redisKey, fingerprint };
    }

    const existing = await redis.get<string | StoredEntry>(redisKey);
    const entry = parseEntry(existing);

    /* A key that expired between the SET and the GET: treat it as ours rather
     * than refusing a request nobody else is handling. */
    if (entry === null) {
      return { kind: "claimed", redisKey, fingerprint };
    }

    if (entry.fingerprint !== fingerprint) {
      return {
        kind: "conflict",
        message:
          "This Idempotency-Key was already used for a different request. Use a new key for each request.",
      };
    }

    if (entry.state === "done" && entry.body !== undefined) {
      return {
        kind: "replay",
        status: entry.status ?? 200,
        body: entry.body,
      };
    }

    return {
      kind: "conflict",
      message:
        "A request with this Idempotency-Key is still in progress. Retry once it has finished.",
    };
  } catch (error) {
    /* The same fail-open choice as rate limiting: a Redis outage must not stop
     * the API working. It does mean a retry during an outage can duplicate,
     * which is why the file header calls Redis a production requirement. */
    console.error(
      "[api/v1] Idempotency check failed, proceeding without it:",
      error,
    );
    return { kind: "not-applicable" };
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: storeIdempotentResponse
 *
 * WHAT:  Records a successful response so a retry replays it.
 * WHY:   Only successes are stored — see A_FAILURE_RELEASES_THE_CLAIM. Its own
 *        failure is swallowed, because by this point the work is DONE and the
 *        customer is owed their response; a Redis write that fails costs a
 *        replay, not a request.
 * WHERE: After a successful POST, before the response is returned.
 */
export async function storeIdempotentResponse(args: {
  redisKey: string;
  fingerprint: string;
  status: number;
  body: string;
}): Promise<void> {
  const redis = getRedisClient();
  if (redis === null) return;

  const entry: StoredEntry = {
    state: "done",
    fingerprint: args.fingerprint,
    status: args.status,
    body: args.body,
  };

  try {
    await redis.set(args.redisKey, JSON.stringify(entry), { ex: TTL_SECONDS });
  } catch (error) {
    console.error("[api/v1] Could not store an idempotent response:", error);
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: releaseIdempotencyKey, A_FAILURE_RELEASES_THE_CLAIM
 *
 * WHAT:  Drops the claim so the client's retry can proceed.
 * WHY:   See A_FAILURE_RELEASES_THE_CLAIM. A failed request that kept its
 *        claim would turn into 24 hours of conflicts for the one client doing
 *        exactly what the header is for.
 * WHERE: The failure path of a claimed POST.
 */
export async function releaseIdempotencyKey(redisKey: string): Promise<void> {
  const redis = getRedisClient();
  if (redis === null) return;

  try {
    await redis.del(redisKey);
  } catch (error) {
    console.error("[api/v1] Could not release an idempotency claim:", error);
  }
}

/* Upstash may return a parsed object or a string depending on what was stored
 * and how the client is configured, so both are accepted rather than assuming
 * one. Anything else is treated as absent. */
function parseEntry(value: string | StoredEntry | null): StoredEntry | null {
  if (value === null) return null;

  const raw: unknown = typeof value === "string" ? safeParse(value) : value;
  if (raw === null || typeof raw !== "object") return null;

  const record: Record<string, unknown> = { ...raw };
  const state = record["state"];
  const fingerprint = record["fingerprint"];
  if (state !== "pending" && state !== "done") return null;
  if (typeof fingerprint !== "string") return null;

  const status = record["status"];
  const body = record["body"];

  return {
    state,
    fingerprint,
    ...(typeof status === "number" ? { status } : {}),
    ...(typeof body === "string" ? { body } : {}),
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
