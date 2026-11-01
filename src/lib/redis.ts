/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getRedisClient, ONE_REDIS_CLIENT,
 *   REDIS_IS_OPTIONAL, GLOBAL_REDIS_KEY
 *
 * WHAT:  The single Upstash client this process uses, resolved once and cached
 *        on `globalThis`.
 *
 * WHY:   ONE_REDIS_CLIENT. This lived privately inside src/lib/rate-limit.ts,
 *        which was right while rate limiting was the only consumer. Phase 17b
 *        added a second — the REST API's idempotency store, which needs plain
 *        `get`/`set` rather than a sliding window — and a second client would
 *        mean two connection pools, two places to read the environment, and
 *        two answers to "is Redis configured". So the client moved up and
 *        `rate-limit.ts` imports it: the limiters are unchanged and there is
 *        still exactly one client.
 *
 *        REDIS_IS_OPTIONAL and every consumer must handle null. With nothing
 *        configured, rate limits fail OPEN (a guardrail refusing all traffic
 *        during an outage is worse than letting requests through) and
 *        idempotency degrades to "not deduplicated" rather than refusing
 *        writes. Each consumer states its own choice; this module only reports
 *        the absence.
 *
 *        Cached on `globalThis` under a symbol rather than in a module-level
 *        `let`, because a dev server re-evaluates modules on every hot reload
 *        and would otherwise open a client per reload until the process was
 *        restarted.
 * WHERE: src/lib/rate-limit.ts and the REST API's idempotency store.
 */

import "server-only";

import { Redis } from "@upstash/redis";

const GLOBAL_REDIS_KEY = Symbol.for("app.upstash.redis");

type GlobalWithRedis = typeof globalThis & {
  [GLOBAL_REDIS_KEY]?: Redis | null;
};

export function getRedisClient(): Redis | null {
  const globalWithRedis = globalThis as GlobalWithRedis;
  if (GLOBAL_REDIS_KEY in globalWithRedis) {
    return globalWithRedis[GLOBAL_REDIS_KEY] ?? null;
  }

  const url = process.env["UPSTASH_REDIS_REST_URL"];
  const token = process.env["UPSTASH_REDIS_REST_TOKEN"];
  if (!url || !token) {
    globalWithRedis[GLOBAL_REDIS_KEY] = null;
    return null;
  }

  globalWithRedis[GLOBAL_REDIS_KEY] = new Redis({ url, token });
  return globalWithRedis[GLOBAL_REDIS_KEY];
}
