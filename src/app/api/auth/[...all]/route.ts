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
import { checkSignupIpLimit } from "@/lib/safety";

/**
 * SOURCE OF TRUTH KEYWORDS: SIGNUP_PATHS, SIGNUP_IS_NOT_SIGN_IN
 *
 * WHAT:  The Better Auth POST paths that create an account.
 * WHY:   The per-IP sign-up cap must fire on these and nothing else — see
 *        SIGNUP_IS_NOT_SIGN_IN in src/lib/safety/signup-limit.ts. Matching on
 *        the path is crude and is the only signal available at this layer: the
 *        request body is a stream that Better Auth needs to read, so consuming
 *        it here to inspect the action would break the handler.
 *
 *        Matched with `endsWith` rather than equality because Better Auth is
 *        mounted under a catch-all and the base path is configurable.
 *        Social sign-in is deliberately NOT in the list: an OAuth callback also
 *        creates accounts, but it arrives from a provider rather than from the
 *        client, and capping it per IP would throttle every user behind one
 *        corporate egress.
 * WHERE: POST, below.
 */
const SIGNUP_PATHS = ["/sign-up/email", "/sign-up"] as const;

function isSignupRequest(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return SIGNUP_PATHS.some((path) => pathname.endsWith(path));
}

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

  /* ONE_PERSON_ONE_WORKSPACE. Stacked ON TOP of the auth limiter above rather
   * than replacing it: that one stops a burst of attempts, this one stops a
   * slow farm of free workspaces, and the two have different shapes. Checked
   * after the auth limiter so a flood pays the cheaper check first. */
  if (isSignupRequest(request)) {
    const signup = await checkSignupIpLimit(ip);
    if (!signup.allowed) {
      return new Response(
        JSON.stringify({
          error: "TOO_MANY_REQUESTS",
          message:
            "Too many accounts have been created from this network recently. Please try again later.",
          retryAfter: signup.retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(signup.retryAfterSeconds),
          },
        },
      );
    }
  }

  const handlers = await loadBetterAuthHandlers();
  return handlers.POST(request);
}
