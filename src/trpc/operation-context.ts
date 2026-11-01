/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: runOperation, operationContextFrom,
 *   OperationContext, CONTEXT_IS_EXPLICIT_NOT_AMBIENT, THE_TX_IS_THE_DB,
 *   ONE_OPERATION_THREE_SURFACES, THE_MAPPING_CANNOT_BE_FORGOTTEN
 *
 * WHAT:  Builds the `OperationContext` a shared operation needs, from what a
 *        tRPC procedure already has.
 *
 * WHY:   This is the web app's adapter into the shared seam, and it is small
 *        on purpose: the whole point of Phase 17's split is that a surface
 *        contributes authentication, gating and response shaping, and nothing
 *        else. Everything below is either already resolved by the procedure
 *        factory or is one lookup.
 *
 *        THE_TX_IS_THE_DB. `ctx.db` inside a mutation is the procedure's
 *        TRANSACTION, not the global client, and passing it through is what
 *        keeps an operation's writes inside the caller's transaction — so a
 *        failure after the write still rolls back, and the factory's usage
 *        bump still commits atomically with the work. An operation that
 *        imported `prisma` itself would silently escape that.
 *
 *        The plan is resolved here rather than taken from the procedure
 *        context because the procedure context does not carry it: the factory
 *        resolves a tier for its own gates and does not expose one.
 *
 *        That lookup is FREE, which is the obvious objection to answer.
 *        `getOrganizationTier` is wrapped in React's `cache()`, so the many
 *        gate checks in one request already share a single adapter round trip
 *        — and the factory has run its gates before this line, so by the time
 *        a procedure builds a context the tier is a cache hit. Resolving it
 *        here rather than inside each operation is therefore not a trade: it
 *        removes the second call the handlers used to make, and it means an
 *        operation cannot disagree with its surface about which plan it is
 *        acting under.
 * WHERE: Every router procedure that calls into src/lib/api/operations/.
 */

import "server-only";

import { getOrganizationTier } from "@/lib/feature-gate";
import type { DbClient } from "@/lib/config/prisma";
import type { OperationContext } from "@/lib/types/api";

import { toTRPCError } from "./operation-error";

/**
 * SOURCE OF TRUTH KEYWORDS: runOperation, THE_MAPPING_CANNOT_BE_FORGOTTEN
 *
 * WHAT:  Builds the context, runs one operation, and translates its failures
 *        into tRPC errors.
 *
 * WHY:   THE_MAPPING_CANNOT_BE_FORGOTTEN. Without this, every procedure that
 *        calls an operation needs the same four-line context build and the
 *        same try/catch around `toTRPCError` — seven copies of a pattern whose
 *        failure mode is invisible. A procedure that forgot the catch would
 *        still compile and still work, right up until an operation refused
 *        something: the customer would get a 500 and a stack trace instead of
 *        "not enough credits", and no test would say so, because the happy
 *        path is identical.
 *
 *        So the two halves are welded together and there is no supported way
 *        to do one without the other. The same reason the procedure factory
 *        owns the gates rather than trusting each handler to call them.
 *
 *        The first argument is STRUCTURAL rather than the tRPC context type:
 *        it asks for the three fields it uses, so this file does not import a
 *        procedure's inferred context and the helper stays testable.
 * WHERE: Every router procedure that calls into src/lib/api/operations/.
 */
export async function runOperation<T>(
  ctx: { db: DbClient; user: { id: string }; requestId: string },
  organizationId: string,
  run: (operation: OperationContext) => Promise<T>,
): Promise<T> {
  const operation = await operationContextFrom({
    organizationId,
    db: ctx.db,
    userId: ctx.user.id,
    requestId: ctx.requestId,
  });

  try {
    return await run(operation);
  } catch (error) {
    throw toTRPCError(error);
  }
}

export async function operationContextFrom(args: {
  organizationId: string;
  db: DbClient;
  /** The signed-in user. Never null on this surface — see USER_IS_NULL_FOR_A_KEY. */
  userId: string;
  requestId: string;
}): Promise<OperationContext> {
  const tier = await getOrganizationTier(args.organizationId);

  return {
    organizationId: args.organizationId,
    plan: tier.tier,
    userId: args.userId,
    db: args.db,
    requestId: args.requestId,
  };
}
