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
import type { LimitResourceKey } from "@/lib/resources";
import { API_ERROR_CODES, type ApiErrorCode } from "@/lib/types/api";
import { incrementUsage } from "@/services/usage.service";

export interface ApiEntitlementRefusal {
  code: ApiErrorCode;
  message: string;
  status: number;
}

export type ApiEntitlementResult =
  | { allowed: true }
  | { allowed: false; refusal: ApiEntitlementRefusal };

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
      refusal: {
        code: API_ERROR_CODES.quota_exceeded,
        message: callGate.reason ?? callGate.upgradeMessage,
        status: 429,
      },
    };
  }

  if (resource !== undefined) {
    const resourceGate = await checkFeatureGate(organizationId, resource);
    if (!resourceGate.allowed) {
      return {
        allowed: false,
        refusal: {
          code: API_ERROR_CODES.quota_exceeded,
          message: resourceGate.reason ?? resourceGate.upgradeMessage,
          status: 429,
        },
      };
    }
  }

  return { allowed: true };
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
