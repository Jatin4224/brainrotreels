/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: toTRPCError, operationFailureToTRPCCode,
 *   ONE_FAILURE_VOCABULARY_MANY_TRANSPORTS, THE_TABLE_IS_TOTAL,
 *   AN_OPERATION_NEVER_THROWS_A_TRPC_ERROR
 *
 * WHAT:  Turns an `OperationError` from a shared operation into the tRPC error
 *        the web app's client already knows how to render.
 *
 * WHY:   This is the web surface's half of the contract that keeps the three
 *        surfaces honest. Operations speak six SITUATIONS and no status codes
 *        (AN_OPERATION_NEVER_THROWS_A_TRPC_ERROR); each transport owns exactly
 *        one table turning those into its own vocabulary. This is that table
 *        for tRPC, and Phase 17b writes the HTTP one.
 *
 *        THE_TABLE_IS_TOTAL — a `Record` over the whole union rather than a
 *        `switch` with a default, so a seventh failure added to
 *        `OPERATION_FAILURES` is a COMPILE ERROR here and in every other
 *        surface's table. A default branch would instead quietly map it to a
 *        500 on whichever surface nobody updated, which is the failure mode
 *        this file exists to make impossible.
 *
 *        It does not go through `createStructuredError`, and that is
 *        deliberate rather than an oversight: that helper's code union is
 *        narrower on purpose (it has no `CONFLICT` and no
 *        `UNPROCESSABLE_CONTENT`) because it exists for the gate refusals,
 *        which are a smaller set. Widening it so this file could reuse it
 *        would let any caller throw any code with any cause, which is the
 *        discipline it was added to impose.
 *
 *        The `detail` travels through as the tRPC `cause` untouched, so the
 *        existing error formatter and the client's `errorCode` switch keep
 *        working exactly as they did when the handler threw directly — a
 *        customer who cannot afford a render still gets the top-up prompt with
 *        `required` and `available` on it.
 * WHERE: The routers that call into src/lib/api/operations/.
 */

import { TRPCError } from "@trpc/server";

import { isOperationError, type OperationFailure } from "@/lib/errors";

/**
 * SOURCE OF TRUTH KEYWORDS: operationFailureToTRPCCode, THE_TABLE_IS_TOTAL
 *
 * One situation, one code. The pairings are not arbitrary and each has a
 * client consequence:
 *
 *   - `invalid` is a BAD_REQUEST, not UNPROCESSABLE_CONTENT: it means the
 *     caller must change what it sent.
 *   - `unprocessable` is the opposite — the input was fine and the thing it
 *     names cannot be used, so retrying the same call is pointless.
 *   - `precondition` is retryable once the state changes, which is why it is
 *     separate from both: "generate a timeline first" is an instruction, not
 *     an error in the request.
 *   - `refused` is a FORBIDDEN whether the reason is policy or money, because
 *     the distinction the client acts on lives in `detail.errorCode`.
 */
export const operationFailureToTRPCCode: Readonly<
  Record<OperationFailure, TRPCError["code"]>
> = {
  not_found: "NOT_FOUND",
  invalid: "BAD_REQUEST",
  precondition: "PRECONDITION_FAILED",
  refused: "FORBIDDEN",
  unprocessable: "UNPROCESSABLE_CONTENT",
  conflict: "CONFLICT",
};

/**
 * SOURCE OF TRUTH KEYWORDS: toTRPCError, RETHROW_WHAT_IS_NOT_OURS
 *
 * WHAT:  An `OperationError` as a `TRPCError`; anything else unchanged.
 * WHY:   RETHROW_WHAT_IS_NOT_OURS. A `TRPCError` the surface raised itself, a
 *        Prisma failure, a bug — none of those are operation failures and
 *        wrapping them would turn a 500 that deserves a stack trace into a
 *        tidy 4xx nobody investigates. Only the named vocabulary is
 *        translated.
 * WHERE: The `catch` in each router that calls an operation.
 */
export function toTRPCError(error: unknown): unknown {
  if (!isOperationError(error)) return error;

  return new TRPCError({
    code: operationFailureToTRPCCode[error.failure],
    message: error.message,
    ...(error.detail !== null ? { cause: error.detail } : {}),
  });
}
