/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: REQUEST_ID_HEADER, resolveRequestId, newRequestId,
 *   ONE_ID_ACROSS_THE_WHOLE_JOURNEY, ID_IS_CARRIED_NOT_DERIVED
 *
 * WHAT:  The correlation id that follows one piece of work from the API call
 *        that started it, through the queued event, through every workflow
 *        step, to the render that comes out of the far end.
 *
 * WHY:   ONE_ID_ACROSS_THE_WHOLE_JOURNEY is the phase's own requirement and it
 *        is the difference between an error report you can act on and one you
 *        cannot. A generation touches a tRPC handler, four Inngest runs across
 *        two processes, three external providers and a webhook coming back from
 *        a fourth. Without a shared id, "a customer says their video failed" is
 *        a search through six log streams by timestamp; with one, it is one
 *        query.
 *
 *        ID_IS_CARRIED_NOT_DERIVED. A workflow cannot RECOMPUTE this — it has
 *        no request, no headers and no session — so the id has to travel on the
 *        event payload like any other datum. That is the whole reason it is a
 *        plain string rather than something clever: it has to survive JSON, a
 *        queue, a replayed step and a provider's webhook round-trip, and
 *        anything with structure would not.
 *
 *        It prefers an INBOUND id over minting one, because the platform in
 *        front of the app usually already has one (Vercel stamps
 *        `x-vercel-id`) and two ids for one request is worse than none —
 *        correlating our logs with the platform's becomes manual. We mint only
 *        when nobody upstream did.
 *
 *        PURE and framework-free: no `headers()`, no Prisma, no SDK. It takes a
 *        `Headers` and returns a string, so the same function works in a route
 *        handler, in a procedure, and in a test with a hand-built Headers.
 * WHERE: Stamped by src/proxy.ts onto every request, read by the procedure
 *        factory into `ctx`, carried on every `JobEvent`, and attached to every
 *        Sentry scope and log line.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: REQUEST_ID_HEADER
 *
 * WHAT:  The header the id travels on inside the app.
 * WHY:   `x-request-id` is the de-facto standard, so a reverse proxy, a load
 *        balancer or a platform log viewer will already surface it under a
 *        name an operator recognises — which is most of the value of having
 *        one. A bespoke `x-rotreels-trace` would be correct and invisible.
 * WHERE: src/proxy.ts sets it; this module reads it.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * SOURCE OF TRUTH KEYWORDS: INBOUND_ID_HEADERS
 *
 * Headers that may already carry a usable id, in preference order. Vercel's is
 * first because it is the one that correlates with the platform's own logs,
 * which is the only log stream we do not control.
 */
const INBOUND_ID_HEADERS = [
  REQUEST_ID_HEADER,
  "x-vercel-id",
  "cf-ray",
] as const;

/* Long enough not to collide across a day's traffic, short enough to paste
 * into a chat message and read out loud — which is what actually happens when
 * somebody is debugging with a customer. */
const ID_BYTES = 12;

/**
 * SOURCE OF TRUTH KEYWORDS: newRequestId, CRYPTO_IS_NOT_FOR_SECRECY
 *
 * WHAT:  A fresh id.
 * WHY:   CRYPTO_IS_NOT_FOR_SECRECY — `crypto.randomUUID` is used because it is
 *        available in every runtime this app runs in (Node, the edge runtime
 *        and the browser) without an import, not because the id needs to be
 *        unguessable. It is a correlation key, it appears in logs, and nothing
 *        is authorised by it.
 *
 *        Hyphens are stripped and it is truncated, because the full UUID is
 *        36 characters of which only the entropy matters here, and a shorter
 *        id is one somebody will actually quote accurately.
 * WHERE: resolveRequestId, when nothing upstream supplied one.
 */
export function newRequestId(): string {
  return globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, ID_BYTES * 2);
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveRequestId, INBOUND_ID_HEADERS
 *
 * WHAT:  This request's id — the one it arrived with, or a new one.
 * WHY:   Never returns null, so no caller has to decide what to do without an
 *        id. An unidentified log line is the one case this module exists to
 *        prevent, and making the id optional would mean every consumer carried
 *        a fallback and they would not all be the same.
 *
 *        Inbound values are TRUNCATED and stripped of anything exotic. The
 *        header is attacker-controlled on a request that reaches us directly,
 *        and this string ends up in log lines and in a Sentry tag — so a
 *        megabyte of newlines in it would be a log-injection vector rather
 *        than a correlation id.
 * WHERE: src/proxy.ts and the procedure factory.
 */
export function resolveRequestId(headers: Headers): string {
  for (const name of INBOUND_ID_HEADERS) {
    const raw = headers.get(name);
    if (raw === null) continue;
    const cleaned = sanitiseId(raw);
    if (cleaned.length > 0) return cleaned;
  }
  return newRequestId();
}

/* Conservative on purpose: an id is an opaque token, so anything outside this
 * alphabet is not information being lost. 64 characters is longer than any
 * platform's own id and short enough to bound a log line. */
function sanitiseId(value: string): string {
  return value.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 64);
}

/**
 * SOURCE OF TRUTH KEYWORDS: readRequestId, REQUEST_ID_CROSSES_THE_QUEUE,
 *   ID_IS_CARRIED_NOT_DERIVED
 *
 * WHAT:  The correlation id out of a queued event's payload.
 *
 * WHY:   REQUEST_ID_CROSSES_THE_QUEUE — the jobs adapter merges the envelope's
 *        `requestId` into the sent `data`, because that is the only channel a
 *        workflow can read on the far side. This is the reader, and it exists
 *        so twelve workflows do not each write their own
 *        `typeof data.requestId === 'string'` check.
 *
 *        It MINTS one when the event carries none rather than returning null,
 *        for the same reason `resolveRequestId` does: an unidentified log line
 *        is the thing this module exists to prevent. A cron tick and a provider
 *        webhook legitimately have no request behind them, and a fresh id still
 *        ties that single run's own lines together.
 *
 *        Takes `unknown`, because a workflow reads this BEFORE parsing its
 *        payload — the id is wanted precisely when the payload turns out to be
 *        invalid and somebody has to find out why.
 * WHERE: Every Inngest function, and the webhook routes.
 */
export function readRequestId(data: unknown): string {
  if (typeof data === "object" && data !== null && "requestId" in data) {
    const candidate = (data as { requestId?: unknown }).requestId;
    if (typeof candidate === "string") {
      const cleaned = sanitiseId(candidate);
      if (cleaned.length > 0) return cleaned;
    }
  }
  return newRequestId();
}
