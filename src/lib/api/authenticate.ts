/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: authenticateApiKey, ApiRefusal, AuthenticatedCaller,
 *   ONE_AUTHENTICATION_TWO_SURFACES, A_KEY_IS_ORG_AUTHORITY,
 *   REVOCATION_IS_CHECKED_EVERY_REQUEST, THE_GATE_IS_CALLED_NOT_REIMPLEMENTED,
 *   PER_KEY_DAILY_QUOTA, REFUSE_BEFORE_READING, A_REFUSAL_IS_DATA_NOT_A_RESPONSE
 *
 * WHAT:  Turns a presented Bearer key into an `OperationContext`, or into a
 *        description of why it was refused.
 *
 * WHY:   ONE_AUTHENTICATION_TWO_SURFACES. This lived under
 *        `src/app/api/v1/_lib/` while REST was the only key-authenticated
 *        surface. 17c added the MCP server, which needs the identical
 *        sequence — the shape check, the digest lookup, the revocation filter,
 *        the `apiAccess` flag, the per-key daily quota — and the one thing it
 *        must NOT do is repeat it. A second implementation of this order is
 *        exactly the drift the phase warns about, and the failure would be
 *        silent: an MCP server that forgot the flag check would work perfectly
 *        for a paying workspace and quietly serve a free one.
 *
 *        A_REFUSAL_IS_DATA_NOT_A_RESPONSE, which is what made the move
 *        possible. The function returns a `code`, a `message`, an HTTP
 *        `status` and any headers, and each surface renders them its own way:
 *        REST as the `{ error, requestId }` envelope, MCP as a JSON-RPC error
 *        or a tool error. Returning a `Response` from here would have forced
 *        the MCP route to unpick one.
 *
 *        A_KEY_IS_ORG_AUTHORITY. A key is scoped to an ORGANIZATION, not a
 *        user, and carries no scopes: it may do anything the public verbs do.
 *        So there is no permission check here — there is no member whose role
 *        could be read — and `userId` is null in the context, which is what
 *        makes an audit row attribute to the workspace rather than to whoever
 *        minted the key months ago. Minting is therefore the privileged act,
 *        which is why `apiKeys.create` is permissioned and rate limited.
 *
 *        THE_GATE_IS_CALLED_NOT_REIMPLEMENTED: `apiAccess` is checked through
 *        the same `checkBooleanFeature` the procedure factory uses, reading
 *        the same registry entry, so a plan change or a trial rule lands on
 *        every surface at once. The message is the registry's own upgrade
 *        sentence rather than copy invented here.
 *
 *        REVOCATION_IS_CHECKED_EVERY_REQUEST — the lookup filters on
 *        `revokedAt` and nothing is cached, because a revoked key is a
 *        customer's only off switch.
 *
 *        PER_KEY_DAILY_QUOTA is enforced here, keyed by the KEY rather than
 *        the workspace, which is the opposite of the `apiCalls` quota and
 *        deliberately so: `apiCalls` is a plan entitlement shared by every
 *        surface, this is a blast radius. A leaked or looping key burns its
 *        own allowance and the workspace's other keys keep working.
 *
 *        REFUSE_BEFORE_READING: a string that is not shaped like one of our
 *        keys is refused without a database read.
 * WHERE: `runApiRoute` for REST; the MCP route handler. Both render the
 *        refusal themselves.
 */

import "server-only";

import { prisma } from "@/lib/config/prisma";
import { checkBooleanFeature, getOrganizationTier } from "@/lib/feature-gate";
import {
  buildRateLimitHeaders,
  checkRateLimit,
  getResourceLimiter,
} from "@/lib/rate-limit";
import {
  API_ERROR_CODES,
  type ApiRefusal,
  type OperationContext,
} from "@/lib/types/api";
import { findActiveApiKey, touchApiKey } from "@/services/api-keys.service";

import { looksLikeApiKey } from "./keys";

export interface AuthenticatedCaller {
  operation: OperationContext;
  keyId: string;
  keyPrefix: string;
}

/* ApiRefusal moved to @/lib/types/api — ONE_REFUSAL_SHAPE_EVERY_DECIDER. The
 * gates return the same shape, and a second copy here is what let a quota
 * refusal ship without its reset hint. Re-exported so a surface importing the
 * authenticator does not need a second import to render what it returns. */
export type { ApiRefusal };

export type ApiAuthResult =
  | { ok: true; caller: AuthenticatedCaller }
  | { ok: false; refusal: ApiRefusal };

/**
 * SOURCE OF TRUTH KEYWORDS: authenticateApiKey
 *
 * WHAT:  The caller, or the refusal.
 * WHY:   Takes the raw `Authorization` header rather than a `Request`, because
 *        a JSON-RPC transport may carry credentials differently and because a
 *        function that takes a string is one a test can call.
 * WHERE: See the file header.
 */
export async function authenticateApiKey(args: {
  authorization: string | null;
  requestId: string;
}): Promise<ApiAuthResult> {
  const { authorization } = args;

  const presented = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;

  /* REFUSE_BEFORE_READING. One refusal for a missing, malformed and unknown
   * key alike: telling a caller WHICH is a free oracle. */
  if (presented === null || !looksLikeApiKey(presented)) {
    return { ok: false, refusal: unauthorized() };
  }

  const key = await findActiveApiKey(presented);
  if (key === null) {
    return { ok: false, refusal: unauthorized() };
  }

  /* LAST_USED_IS_BEST_EFFORT — not awaited, and its failure is swallowed
   * inside the service. The request must not wait on a convenience column. */
  void touchApiKey(key.id);

  const access = await checkBooleanFeature(key.organizationId, "apiAccess");
  if (!access.enabled) {
    return {
      ok: false,
      refusal: {
        code: API_ERROR_CODES.feature_unavailable,
        message: access.upgradeMessage,
        status: 403,
        headers: {},
      },
    };
  }

  /**
   * PER_KEY_DAILY_QUOTA. The limiter is cached by `resource.action`, so the
   * quota value is part of the action name — otherwise the first key seen
   * would fix the window size for every key in the process. The IDENTIFIER is
   * the key id, so two keys with the same quota still get their own
   * allowance.
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
      refusal: {
        code: API_ERROR_CODES.rate_limited,
        message: `This key has used its daily quota of ${key.dailyQuota} requests.`,
        status: 429,
        headers: buildRateLimitHeaders(quota),
      },
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
        /* The global client, not a transaction: neither surface is inside one.
         * An operation that needs atomicity opens its own. */
        db: prisma,
        requestId: args.requestId,
      },
    },
  };
}

function unauthorized(): ApiRefusal {
  return {
    code: API_ERROR_CODES.unauthorized,
    message: "Send a valid API key as `Authorization: Bearer <key>`.",
    status: 401,
    /* The conventional challenge header, so a generic HTTP client knows this
     * is an auth failure rather than a refusal it should report differently. */
    headers: { "WWW-Authenticate": 'Bearer realm="api"' },
  };
}
