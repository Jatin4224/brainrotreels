/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: checkApiEntitlements, countApiUsage,
 *   ONE_GATE_ORDER_TWO_SURFACES, THE_GATE_IS_CALLED_NOT_REIMPLEMENTED,
 *   QUOTAS_ARE_SHARED_PER_ORGANIZATION, COUNTED_AFTER_SUCCESS,
 *   THE_GATE_ALWAYS_THE_COUNTER_SOMETIMES
 *
 * WHAT:  The two quota decisions every key-authenticated call makes: may this
 *        workspace make the call, and what did the call consume.
 *
 * WHY:   ONE_GATE_ORDER_TWO_SURFACES. REST and MCP must gate identically, and
 *        the thing most easily got wrong is not WHICH gates but their ORDER
 *        and which one is checked before the work. Keeping the sequence in one
 *        function means the MCP server cannot drift from the REST API by
 *        forgetting the second check or by counting before running.
 *
 *        THE_GATE_IS_CALLED_NOT_REIMPLEMENTED — both decisions are calls into
 *        `src/lib/feature-gate.ts`, the same functions `protectedProcedure`
 *        calls, reading the same registry entries. There is no plan
 *        comparison, no limit arithmetic and no upgrade copy here.
 *
 *        QUOTAS_ARE_SHARED_PER_ORGANIZATION, the phase's step 12 and its most
 *        easily misread done-when: "burning the API quota does not block the
 *        same workspace's UI jobs beyond the shared cap — and the shared cap
 *        is the intended behaviour, not a bug". A render started through the
 *        API counts against the SAME monthly `renders` limit the dashboard
 *        counts against, because it is the same video on the same plan.
 *
 *        COUNTED_AFTER_SUCCESS, which is why these are two functions rather
 *        than one. A refused call must not consume the allowance it was
 *        refused by, or a workspace at its limit could not discover that it is
 *        at its limit.
 *
 *        THE_GATE_ALWAYS_THE_COUNTER_SOMETIMES: `countApiUsage` takes
 *        `consumed` because a render that was REUSED costs nothing while
 *        still having to pass the gate. The gate asks "are you allowed", the
 *        counter records "what happened", and the two genuinely differ for one
 *        verb.
 *
 *        Returns a REFUSAL rather than throwing or returning a `Response`, for
 *        the reason `authenticateApiKey` does: each surface renders it.
 * WHERE: `runApiRoute` for REST; the MCP tool dispatcher.
 */

import "server-only";

import { checkFeatureGate } from "@/lib/feature-gate";
import { buildRateLimitHeaders } from "@/lib/rate-limit";
import type { LimitResourceKey } from "@/lib/resources";
import { API_ERROR_CODES, type ApiRefusal } from "@/lib/types/api";
import { isPeriodicResource, nextPeriodStart } from "@/lib/usage-period";
import { incrementUsage } from "@/services/usage.service";

/* ONE_REFUSAL_SHAPE_EVERY_DECIDER — the shape `authenticateApiKey` returns,
 * read from @/lib/types/api. This file used to declare a near-identical one
 * WITHOUT `headers`, which is exactly why a quota 429 shipped with no reset
 * hint: there was no field to put one in. */
export type ApiEntitlementResult =
  | { allowed: true }
  | { allowed: false; refusal: ApiRefusal };

/**
 * SOURCE OF TRUTH KEYWORDS: checkApiEntitlements
 *
 * WHAT:  Whether this workspace may make this call at all.
 * WHY:   Two gates in a fixed order: the API's own call allowance first,
 *        because every request pays it, then the verb's own metered resource.
 *        The order matters for the message a customer sees — a workspace out
 *        of API calls should be told that rather than being told about
 *        renders.
 *
 *        A `429` for both, not a `403`: a quota is a thing that resets, and
 *        the distinction between "never" and "not yet" is exactly what a
 *        client's retry logic branches on.
 * WHERE: Before the work, on both surfaces.
 */
export async function checkApiEntitlements(args: {
  organizationId: string;
  /** The verb's own metered resource, when it has one. */
  resource?: LimitResourceKey | undefined;
}): Promise<ApiEntitlementResult> {
  const { organizationId, resource } = args;

  const callGate = await checkFeatureGate(organizationId, "apiCalls");
  if (!callGate.allowed) {
    return {
      allowed: false,
      refusal: quotaRefusal("apiCalls", callGate),
    };
  }

  if (resource !== undefined) {
    const resourceGate = await checkFeatureGate(organizationId, resource);
    if (!resourceGate.allowed) {
      return {
        allowed: false,
        refusal: quotaRefusal(resource, resourceGate),
      };
    }
  }

  return { allowed: true };
}

/**
 * SOURCE OF TRUTH KEYWORDS: quotaRefusal, A_429_CARRIES_ITS_RESET,
 *   THE_RESET_IS_A_FACT_NOT_A_GUESS, THE_HEADER_BUILDER_IS_REUSED
 *
 * WHAT:  A quota refusal, with the reset hint the phase file's done-when asks
 *        for: "exceeding the daily quota returns 429 with a reset hint".
 *
 * WHY:   A_429_CARRIES_ITS_RESET. A `429` is the one refusal that is a
 *        statement about TIME — it means "not yet", and a client's only
 *        correct response is to wait. Without a reset it has to invent an
 *        interval, and every client invents a different one; the aggressive
 *        ones then spend the rest of the window being refused.
 *
 *        THE_HEADER_BUILDER_IS_REUSED. The numbers go through
 *        `buildRateLimitHeaders`, the same function the per-key sliding window
 *        uses, so both kinds of `429` emit one wire format. A second header
 *        spelling would mean a client parsing two, and the one it got wrong
 *        would be the rarer one.
 *
 *        A `429` for a quota and not a `403`: see the header. Only PERIODIC
 *        resources get a reset, because an absolute cap — seats, stored
 *        projects — does not reset on its own and `Retry-After` on one would
 *        promise a recovery that never comes. A trial refusal has no limit
 *        either; it is answered by the upgrade sentence, not by waiting.
 *
 *        EXPORTED BECAUSE IT IS THE PURE HALF. `checkApiEntitlements` reads
 *        the database and cannot be unit-tested here; this function is the
 *        part that holds the phase's done-when ("a 429 with a reset hint"),
 *        and it is pure — a resource key and a gate result in, a refusal out.
 *        Exporting it is what makes that promise checkable rather than
 *        inspectable.
 * WHERE: `checkApiEntitlements`, both gates; `gates.test.ts`.
 */
export function quotaRefusal(
  resource: LimitResourceKey,
  gate: { reason?: string; upgradeMessage: string; limit?: number },
): ApiRefusal {
  const resetsAt = isPeriodicResource(resource)
    ? nextPeriodStart().getTime()
    : null;

  return {
    code: API_ERROR_CODES.quota_exceeded,
    message:
      resetsAt === null
        ? (gate.reason ?? gate.upgradeMessage)
        : /* The sentence says it too, because MCP has no headers at all and a
           * model reads prose. Same fact, twice, for two kinds of reader. */
          `${gate.reason ?? gate.upgradeMessage} This quota resets on ${new Date(resetsAt).toISOString()}.`,
    status: 429,
    headers:
      resetsAt === null
        ? {}
        : buildRateLimitHeaders({
            allowed: false,
            limit: gate.limit ?? 0,
            remaining: 0,
            resetAt: resetsAt,
          }),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: countApiUsage, COUNTED_AFTER_SUCCESS,
 *   THE_GATE_ALWAYS_THE_COUNTER_SOMETIMES
 *
 * WHAT:  Records what a successful call consumed.
 * WHY:   `apiCalls` always, because the call happened. The verb's resource
 *        only when `consumed` — see the file header. Never called on a
 *        refusal, and never on a deduplicated replay, because a replay did
 *        nothing.
 * WHERE: After the work, on both surfaces.
 */
export async function countApiUsage(args: {
  organizationId: string;
  resource?: LimitResourceKey | undefined;
  consumed: boolean;
}): Promise<void> {
  const { organizationId, resource, consumed } = args;

  await incrementUsage(organizationId, "apiCalls", 1);

  if (resource !== undefined && consumed) {
    await incrementUsage(organizationId, resource, 1);
  }
}
