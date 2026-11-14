/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: toRoleTRPCError, RoleEscalationError,
 *   UnknownPermissionError, OWNER_IS_NEVER_ASSIGNABLE,
 *   PERMISSIONS_ARE_VALIDATED_NOT_TRUSTED
 *
 * WHAT:  Turns the two refusals `processRole` can throw into the tRPC error the
 *        team UI already renders, and returns `null` for anything else.
 *
 * WHY:   Both the member router and the invitation router reach the role
 *        decoder through the membership adapter, so both need the same two
 *        mappings. Written once here for the reason `operation-error.ts` exists
 *        one directory up: a second copy of a security refusal is a second
 *        answer, and the copy nobody updated is the one that leaks.
 *
 *        The codes are not interchangeable. An owner-role request is a
 *        FORBIDDEN — the caller is asking for something no request may ever be
 *        granted, so retrying with the same payload is pointless and the
 *        attempt is worth an audit line. An unknown permission is a
 *        BAD_REQUEST — the payload was malformed, which is a client bug, and
 *        the message names the offending strings so it is fixable.
 *
 *        Returning `null` rather than rethrowing keeps the decision at the call
 *        site: a router that wants to add context around the refusal still can,
 *        and an unrelated error is never swallowed by this file.
 * WHERE: member.update and invitation.create, around the adapter call that
 *        decodes the role.
 */

import { TRPCError } from "@trpc/server";

import {
  PermissionEscalationError,
  RoleEscalationError,
  UnknownPermissionError,
} from "@/services/role.service";

export function toRoleTRPCError(error: unknown): TRPCError | null {
  if (error instanceof RoleEscalationError) {
    return new TRPCError({
      code: "FORBIDDEN",
      message: error.message,
      cause: error,
    });
  }

  /* A_GRANT_CANNOT_EXCEED_THE_GRANTER. FORBIDDEN, not BAD_REQUEST: the payload
   * is well-formed and every permission in it is real — what the caller lacks
   * is the authority to hand it out, which the same payload will never gain.
   * The message already names the over-reached permissions so the team UI can
   * show which toggles to drop. */
  if (error instanceof PermissionEscalationError) {
    return new TRPCError({
      code: "FORBIDDEN",
      message: error.message,
      cause: error,
    });
  }

  if (error instanceof UnknownPermissionError) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }

  return null;
}
