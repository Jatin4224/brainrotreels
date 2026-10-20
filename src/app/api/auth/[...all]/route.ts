/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: GET, POST, loadBetterAuthHandlers, PROVIDER_ISOLATION
 *
 * WHAT:  Better Auth's catch-all Next.js route handler with an IP-keyed
 *        rate-limit wrapper on POST — active only when Better Auth is the
 *        selected provider.
 * WHY:   POSTs cover every credential-bearing flow — wrapping with authLimiter
 *        blocks brute-force/stuffing before the handler runs; GET stays raw.
 *        PROVIDER_ISOLATION: Better Auth is loaded through a DYNAMIC import, not
 *        a static one. `src/lib/better-auth/auth.ts` builds the Better Auth
 *        instance at module scope and throws when BETTER_AUTH_SECRET is missing
 *        in production — which is exactly the state of a deployment that runs on
 *        a different provider. A static import therefore crashed the production
 *        build there even though the handler itself was already guarded.
 *        Deferring the import to request time means the module is never
 *        evaluated on a deployment that does not use it, and the route simply
 *        404s.
 * WHERE: Mounts Better Auth from src/lib/better-auth/auth; rate limiter and
 *        helpers come from src/lib/rate-limit; provider from
 *        src/lib/adapters/provider.
 */

import { AUTH_PROVIDER } from "@/lib/adapters/provider";
import {
  authLimiter,
  buildRateLimitHeaders,
  checkRateLimit,
  getClientIp,
} from "@/lib/rate-limit";

/* PROVIDER_ISOLATION: when Better Auth is not the selected provider this route
 * must not exist. Returning 404 keeps a stale bookmark or a probing request from
 * reaching Better Auth's handler — and therefore its database adapter — in a
 * deployment that runs on a different provider entirely. */
const IS_ACTIVE = AUTH_PROVIDER === "better-auth";

const notFound = (): Response =>
  new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });

/* Memoised per runtime instance so the dynamic import cost is paid once, not
 * on every auth request. */
let handlersPromise: Promise<{
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
}> | null = null;

async function loadBetterAuthHandlers() {
  if (!handlersPromise) {
    handlersPromise = (async () => {
      const [{ auth }, { toNextJsHandler }] = await Promise.all([
        import("@/lib/better-auth/auth"),
        import("better-auth/next-js"),
      ]);
      return toNextJsHandler(auth);
    })();
  }
  return handlersPromise;
}

export async function GET(request: Request): Promise<Response> {
  if (!IS_ACTIVE) return notFound();
  const handlers = await loadBetterAuthHandlers();
  return handlers.GET(request);
}

// POSTs cover every credential-bearing flow (sign-in, sign-up, password reset,
// 2FA, OAuth start) — IP-keyed limit blocks brute-force and stuffing.
export async function POST(request: Request): Promise<Response> {
  if (!IS_ACTIVE) return notFound();

  const ip = getClientIp(request.headers);
  const identifier = ip ?? "auth:anonymous";

  /* Rate limit BEFORE loading Better Auth so a flood cannot be used to force
   * repeated module resolution work. */
  const result = await checkRateLimit(authLimiter, identifier);
  if (!result.allowed) {
    return new Response(
      JSON.stringify({
        error: "TOO_MANY_REQUESTS",
        message: "Too many authentication attempts. Please try again shortly.",
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          ...buildRateLimitHeaders(result),
        },
      },
    );
  }

  const handlers = await loadBetterAuthHandlers();
  return handlers.POST(request);
}
