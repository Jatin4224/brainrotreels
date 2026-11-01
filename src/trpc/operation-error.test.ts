/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: operation error test, toTRPCError, THE_TABLE_IS_TOTAL,
 *   ONE_FAILURE_VOCABULARY_MANY_TRANSPORTS, RETHROW_WHAT_IS_NOT_OURS,
 *   AN_OPERATION_NEVER_THROWS_A_TRPC_ERROR
 *
 * WHAT:  That every operation failure has a tRPC code, that the pairings are
 *        the documented ones, that the structured payload survives the
 *        translation, and that anything which is not an operation failure is
 *        left alone.
 *
 * WHY:   This is the drift guard for Phase 17's central promise. The three
 *        surfaces share their business logic, so they must also share a
 *        failure vocabulary — and each one owns a table translating it. A
 *        missing entry is a compile error, but a WRONG entry is not: swapping
 *        `invalid` and `unprocessable`, or mapping `refused` to a 404, type-
 *        checks perfectly and changes what a client does about it. Nothing
 *        else in the codebase would notice, because the happy path is
 *        identical.
 *
 *        The `detail` assertion matters for the same reason: that payload is
 *        how a customer who cannot afford a render gets a top-up prompt
 *        instead of a shrug. It crosses from an operation, through this
 *        mapping, into tRPC's `cause`, and out through the error formatter —
 *        four hops, no types shared end to end, and one silent failure mode
 *        (a correct error with its specifics dropped).
 * WHERE: `npm test`.
 */

import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  OPERATION_FAILURES,
  OperationError,
  isOperationError,
} from "@/lib/errors";

import { operationFailureToTRPCCode, toTRPCError } from "./operation-error";

describe("the failure table", () => {
  it("has an entry for every failure, and no others", () => {
    /* THE_TABLE_IS_TOTAL. TypeScript enforces this at compile time; asserting
     * it at runtime catches the other direction — a stale key left behind
     * after a failure was renamed, which would otherwise sit there unread. */
    expect(Object.keys(operationFailureToTRPCCode).sort()).toEqual(
      [...OPERATION_FAILURES].sort(),
    );
  });

  it("maps each failure to the documented code", () => {
    /* The pairings are a product decision, not a detail: `invalid` tells a
     * caller to change what it sent, `unprocessable` tells it not to bother
     * retrying, and `precondition` tells it to do something else first. */
    expect(operationFailureToTRPCCode).toEqual({
      not_found: "NOT_FOUND",
      invalid: "BAD_REQUEST",
      precondition: "PRECONDITION_FAILED",
      refused: "FORBIDDEN",
      unprocessable: "UNPROCESSABLE_CONTENT",
      conflict: "CONFLICT",
    });
  });
});

describe("translating an operation failure", () => {
  it("produces a TRPCError with the mapped code and the same message", () => {
    for (const failure of OPERATION_FAILURES) {
      const translated = toTRPCError(
        new OperationError(failure, `a ${failure} happened`),
      );

      expect(translated).toBeInstanceOf(TRPCError);
      /* Narrowed rather than cast — the assertion above does not change the
       * static type, and a cast here would be the one TypeScript bypass in a
       * file about not bypassing things. */
      if (!(translated instanceof TRPCError)) throw new Error("unreachable");

      expect(translated.code).toBe(operationFailureToTRPCCode[failure]);
      expect(translated.message).toBe(`a ${failure} happened`);
    }
  });

  it("carries the structured payload through as the cause", () => {
    /**
     * SOURCE OF TRUTH KEYWORDS: THE_CAUSE_IS_WRAPPED
     *
     * Asserted field by field rather than by deep equality, because tRPC
     * wraps a cause that is not an `Error` in an `UnknownCauseError` and
     * copies the payload's properties onto it. The object that comes out is
     * therefore not the object that went in, while every field survives — and
     * the fields are what the client reads.
     *
     * That has always been true of this payload: `createStructuredError`
     * passes the same shape as a cause, so the error formatter and the
     * client's `errorCode` switch have been reading a wrapped object since
     * Phase 00. It is written down here because it is the sort of thing a
     * 17b REST handler would get wrong — on that surface the payload should
     * be read from `OperationError.detail` BEFORE translation, where it is
     * still the plain object.
     */
    const translated = toTRPCError(
      new OperationError("refused", "Not enough credits.", {
        errorCode: ERROR_CODES.INSUFFICIENT_CREDITS,
        resource: "credits",
        required: 12,
        available: 3,
        message: "Not enough credits. 12 needed, 3 available.",
      }),
    );

    if (!(translated instanceof TRPCError)) throw new Error("unreachable");

    const cause = translated.cause;
    expect(cause).toBeDefined();
    expect(cause).toMatchObject({
      errorCode: ERROR_CODES.INSUFFICIENT_CREDITS,
      resource: "credits",
      required: 12,
      available: 3,
      message: "Not enough credits. 12 needed, 3 available.",
    });
  });

  it("omits the cause entirely when there is no payload", () => {
    /* Rather than setting `cause: null`, which the error formatter would then
     * have to distinguish from a real payload. */
    const translated = toTRPCError(
      new OperationError("not_found", "Project not found"),
    );

    if (!(translated instanceof TRPCError)) throw new Error("unreachable");
    expect(translated.cause).toBeUndefined();
  });
});

describe("everything else", () => {
  it("passes a plain Error through untouched", () => {
    /* RETHROW_WHAT_IS_NOT_OURS — wrapping a bug would turn a 500 that
     * deserves a stack trace into a tidy 4xx nobody investigates. */
    const bug = new Error("cannot read properties of undefined");
    expect(toTRPCError(bug)).toBe(bug);
  });

  it("passes a TRPCError the surface raised itself through untouched", () => {
    const raised = new TRPCError({ code: "UNAUTHORIZED" });
    expect(toTRPCError(raised)).toBe(raised);
  });

  it("passes a non-Error through untouched", () => {
    expect(toTRPCError("a string nobody expected")).toBe(
      "a string nobody expected",
    );
  });
});

describe("isOperationError", () => {
  it("recognises one", () => {
    expect(isOperationError(new OperationError("conflict", "clashed"))).toBe(
      true,
    );
  });

  it("rejects a plain Error and a lookalike", () => {
    expect(isOperationError(new Error("conflict"))).toBe(false);
    expect(isOperationError({ failure: "conflict", message: "clashed" })).toBe(
      false,
    );
  });

  it("keeps the failure and the payload it was given", () => {
    const error = new OperationError("precondition", "No timeline yet.");
    expect(error.failure).toBe("precondition");
    expect(error.detail).toBeNull();
    expect(error.name).toBe("OperationError");
  });
});
