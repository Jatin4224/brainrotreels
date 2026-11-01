/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: authenticateApiRequest, AuthenticatedCaller,
 *   A_KEY_IS_ORG_AUTHORITY, REVOCATION_IS_CHECKED_EVERY_REQUEST,
 *   THE_GATE_IS_CALLED_NOT_REIMPLEMENTED, PER_KEY_DAILY_QUOTA,
 *   REFUSE_BEFORE_READING
 *
 * WHAT:  Turns a Bearer key into an `OperationContext`, or into the response
 *        that refuses the request.
 *
 * WHY:   THE_GATE_IS_CALLED_NOT_REIMPLEMENTED is the rule this file exists to
 *        obey. The phase file says the REST layer's only extra job is
 *        "translating a Bearer key into that context and applying the same
 *        `checkFeatureGate` / credit calls the procedure builder would have
 *        applied", and warns that a route reimplementing a rule means the
 *        surfaces have already drifted. So every entitlement decision below is
 *        a CALL into `src/lib/feature-gate.ts` — the same functions
 *        `protectedProcedure` calls, reading the same registry entries. There
 *        is no plan comparison, no limit arithmetic and no upgrade copy
 *        written in this file.
 *
 *        A_KEY_IS_ORG_AUTHORITY, and this is the decision to understand before
 *        extending it. A key is scoped to an ORGANIZATION, not a user, and it
 *        carries no scopes: it may do anything the seven public verbs do.
 *        Three consequences, stated rather than discovered:
 *
 *          - There is no permission check here, because there is no member
 *            whose role could be read. `userId` is null in the context
 *            (USER_IS_NULL_FOR_A_KEY), so audit rows attribute to the
 *            workspace rather than to whoever minted the key months ago.
 *          - Minting a key is therefore the privileged act, which is why
 *            `apiKeys.create` is permissioned and rate limited and why the
 *            UI is blunt about what a key can do.
 *          - Narrowing a key later (read-only keys, per-project keys) is an
 *            additive change to this file and the model, not a redesign. It
 *            is deliberately not in this phase: a scope system nobody has
 *            asked for would be guesswork about which combinations matter.
 *
 *        REVOCATION_IS_CHECKED_EVERY_REQUEST — the lookup filters on
 *        `revokedAt` and nothing here is cached, because a revoked key is a
 *        customer's only off switch and it has to be effective now. See the
 *        service.
 *
 *        PER_KEY_DAILY_QUOTA. The `dailyQuota` column is enforced here, in
 *        Redis, keyed by the KEY rather than the workspace — which is the
 *        opposite of the `apiCalls` quota and deliberately so. `apiCalls` is a
 *        plan entitlement shared by every surface; this is a blast radius: a
 *        leaked or looping key burns its own allowance and the workspace's
 *        other keys, and its dashboard, keep working.
 *
 *        REFUSE_BEFORE_READING: a presented string that is not shaped like one
 *        of our keys is refused without a database read, so a crawler spraying
 *        rubbish does not turn into a query per request.
 * WHERE: `withApiRoute` in ./handler.ts, which every route goes through.
 */

import "server-only";

import { looksLikeApiKey } from "@/lib/api/keys";
import { prisma } from "@/lib/config/prisma";
import { checkBooleanFeature, getOrganizationTier } from "@/lib/feature-gate";
import {
  buildRateLimitHeaders,
  checkRateLimit,
  getResourceLimiter,
} from "@/lib/rate-limit";
import { API_ERROR_CODES, type OperationContext } from "@/lib/types/api";
import { findActiveApiKey, touchApiKey } from "@/services/api-keys.service";

import { apiFail } from "./envelope";

export interface AuthenticatedCaller {
  operation: OperationContext;
  keyId: string;
  keyPrefix: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: authenticateApiRequest
 *
 * WHAT:  The caller, or the `Response` that refuses them.
 * WHY:   Returns a discriminated result rather than throwing, because every
 *        refusal here has a specific status, code and message that the shared
 *        handler must pass through untouched — and an exception would make
 *        each of those a `catch` branch guessing at which one it was.
 * WHERE: See the file header.
 */
export async function authenticateApiRequest(
  request: Request,
  requestId: string,
): Promise<
  { ok: true; caller: AuthenticatedCaller } | { ok: false; response: Response }
> {
  const header = request.headers.get("authorization");
  const presented = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : null;

  if (presented === null || !looksLikeApiKey(presented)) {
    /* REFUSE_BEFORE_READING. One message for a missing, malformed and unknown
     * key alike: telling a caller WHICH is a free oracle. */
    return {
      ok: false,
      response: unauthorized(requestId),
    };
  }

  const key = await findActiveApiKey(presented);
  if (key === null) {
    return { ok: false, response: unauthorized(requestId) };
  }

  /* LAST_USED_IS_BEST_EFFORT — not awaited, and its failure is swallowed
   * inside the service. The request must not wait on a convenience column. */
  void touchApiKey(key.id);

  /**
   * THE_GATE_IS_CALLED_NOT_REIMPLEMENTED. `apiAccess` is a registry flag and
   * this is the same function the procedure factory uses, so a plan change or
   * a trial rule lands on both surfaces at once. The message is the
   * registry's own upgrade sentence.
   */
  const access = await checkBooleanFeature(key.organizationId, "apiAccess");
  if (!access.enabled) {
    return {
      ok: false,
      response: apiFail(
        API_ERROR_CODES.feature_unavailable,
        access.upgradeMessage,
        403,
        requestId,
      ),
    };
  }

  /**
   * PER_KEY_DAILY_QUOTA. The limiter is cached by `resource.action`, so the
   * quota value is part of the action name — otherwise the first key to be
   * seen would fix the window size for every key in the process. The
   * IDENTIFIER is the key id, so two keys with the same quota still get their
   * own allowance.
   */
  const limiter = getResourceLimiter(
    "apiKey",
    `daily-${key.dailyQuota}`,
    key.dailyQuota,
    "24 h",
  );
  const quota = await checkRateLimit(limiter, key.id);
  if (!quota.allowed) {
    return {
      ok: false,
      response: apiFail(
        API_ERROR_CODES.rate_limited,
        `This key has used its daily quota of ${key.dailyQuota} requests.`,
        429,
        requestId,
        buildRateLimitHeaders(quota),
      ),
    };
  }

  const tier = await getOrganizationTier(key.organizationId);

  return {
    ok: true,
    caller: {
      keyId: key.id,
      keyPrefix: key.prefix,
      operation: {
        organizationId: key.organizationId,
        plan: tier.tier,
        /* USER_IS_NULL_FOR_A_KEY — there is no human on this request. */
        userId: null,
        /* The global client, not a transaction: a route is not inside one.
         * An operation that needs atomicity opens its own. */
        db: prisma,
        requestId,
      },
    },
  };
}

/* One response for every authentication failure — see REFUSE_BEFORE_READING. */
function unauthorized(requestId: string): Response {
  return apiFail(
    API_ERROR_CODES.unauthorized,
    "Send a valid API key as `Authorization: Bearer <key>`.",
    401,
    requestId,
    /* The conventional challenge header, so a generic HTTP client knows this
     * is an auth failure rather than a refusal it should report differently. */
    { "WWW-Authenticate": 'Bearer realm="api"' },
  );
}
