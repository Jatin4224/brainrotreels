/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SIGNUP_IP_LIMIT, SIGNUP_IP_WINDOW,
 *   checkSignupIpLimit, ONE_PERSON_ONE_WORKSPACE, SIGNUP_IS_NOT_SIGN_IN,
 *   NO_IP_NO_LIMIT
 *
 * WHAT:  How many accounts one address may create, and how often.
 *
 * WHY:   SIGNUP_IS_NOT_SIGN_IN, which is why this is not just `authLimiter`.
 *        That limiter already covers the whole auth route at 10 requests per
 *        60 seconds, and it is tuned for the threat it was built for —
 *        credential stuffing, where the attacker makes hundreds of attempts a
 *        minute. The threat HERE is the opposite shape: an attacker who creates
 *        one free workspace every few minutes, all day, each with its own free
 *        quota and its own daily generation allowance. That traffic never comes
 *        close to the auth limiter and is the single cheapest way to run up a
 *        provider bill on a product with a free tier.
 *
 *        So the window is HOURS and the count is small. Both limiters apply:
 *        this one stacks on top rather than replacing it, because a burst of
 *        sign-ups is also a burst of auth requests.
 *
 *        ONE_PERSON_ONE_WORKSPACE is the intent, and an IP is a poor proxy for
 *        a person — an office, a university or a mobile carrier shares one.
 *        That is why the count is 5 rather than 1: enough that a family or a
 *        small team behind one NAT can all sign up, few enough that a scripted
 *        farm is slowed to a crawl. It is a speed bump by design, not an
 *        identity check; the real controls on a free workspace are the daily
 *        generation cap and the verified-email requirement, and this exists to
 *        stop someone cheaply obtaining a thousand of them.
 *
 *        NO_IP_NO_LIMIT: when the client IP cannot be resolved the check
 *        passes. `getClientIp` returns null when no trusted platform header is
 *        present, and the alternative — bucketing every unidentifiable request
 *        together — would make one unresolvable client able to block sign-up
 *        for all of them, which is a denial-of-service with extra steps.
 * WHERE: The POST branch of src/app/api/auth/[...all]/route.ts, on the
 *        sign-up path only.
 */

import "server-only";

import { checkRateLimit, getResourceLimiter } from "@/lib/rate-limit";

/**
 * SOURCE OF TRUTH KEYWORDS: SIGNUP_IP_LIMIT, SIGNUP_IP_WINDOW
 *
 * Five accounts per address per six hours. See ONE_PERSON_ONE_WORKSPACE for
 * why it is five and not one.
 */
export const SIGNUP_IP_LIMIT = 5;

export const SIGNUP_IP_WINDOW = "6 h" as const;

/**
 * SOURCE OF TRUTH KEYWORDS: checkSignupIpLimit, NO_IP_NO_LIMIT
 *
 * WHAT:  Consumes one unit of this address's sign-up allowance.
 * WHY:   Built on the SAME limiter factory as every other cap here, so the key
 *        naming, the sliding window and the memoisation are not reimplemented —
 *        and so it fails open with the rest of them when Redis is absent
 *        (see `checkRateLimit`).
 *
 *        It consumes on every CALL, so it must be called once per sign-up
 *        attempt and only on the sign-up path. Calling it for sign-in would
 *        exhaust a shared office's allowance in an afternoon of ordinary
 *        logins.
 * WHERE: The auth route, which knows the pathname and therefore which POSTs
 *        are sign-ups.
 */
export async function checkSignupIpLimit(
  ip: string | null,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  /* NO_IP_NO_LIMIT — see the file header. */
  if (ip === null) return { allowed: true, retryAfterSeconds: 0 };

  const limiter = getResourceLimiter(
    "signup",
    "perIp",
    SIGNUP_IP_LIMIT,
    SIGNUP_IP_WINDOW,
  );

  const result = await checkRateLimit(limiter, ip);
  if (result.allowed) return { allowed: true, retryAfterSeconds: 0 };

  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((result.resetAt - Date.now()) / 1000),
    ),
  };
}
