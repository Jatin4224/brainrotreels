/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ERROR_CODES, ErrorCode, StructuredError,
 *   StructuredErrorCause
 *
 * WHAT:  Discriminated union of every structured error the server may attach
 *        to a tRPC error's `cause`, keyed by ERROR_CODES.
 * WHY:   Clients narrow on `errorCode` to render specific UI (upgrade modal,
 *        invitation accept screen, 2FA prompt) instead of generic error text.
 *        The two upgrade-shaped codes carry `upgradeMessage` + `currentPlan` so
 *        the global upgrade modal can open itself straight off the error with
 *        the registry's own copy — the client never re-derives which plan comes
 *        next or what to say about the resource.
 * WHERE: Codes thrown via createStructuredError in src/trpc/init.ts; consumed
 *        by the tRPC client error handler and UI gate components.
 */

import type { ResourceKey } from "@/lib/resources";
import type { PlanKey } from "@/lib/config/plans";

/**
 * SOURCE OF TRUTH KEYWORDS: ERROR_CODES, ErrorCode
 *
 * WHAT:  String enum of every structured error code the server emits.
 * WHY:   Frozen at the type level so adding a new variant forces an exhaustive
 *        check on every switch consuming StructuredErrorCause.
 * WHERE: Used everywhere a StructuredError is created or matched.
 */
export const ERROR_CODES = {
  ONBOARDING_INCOMPLETE: "ONBOARDING_INCOMPLETE",
  NOT_ORGANIZATION_MEMBER: "NOT_ORGANIZATION_MEMBER",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  FEATURE_NOT_AVAILABLE: "FEATURE_NOT_AVAILABLE",
  USAGE_LIMIT_REACHED: "USAGE_LIMIT_REACHED",
  INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS",
  /* Phase 10. A SEPARATE code from INSUFFICIENT_PERMISSIONS on purpose: the
   * customer is permitted to do this and simply has not proved their address,
   * so the client's response is "resend the link" rather than "ask an admin".
   * Grep VERIFICATION_IS_A_GENERATION_GATE. */
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  /* Phase 10. Content refused by moderation. Distinct from VALIDATION_ERROR
   * because the input was well-formed and the refusal is a POLICY decision the
   * customer can act on — and distinct from a bare FORBIDDEN so the client can
   * render the named category rather than a generic failure. Grep
   * REFUSAL_NAMES_THE_REASON. */
  CONTENT_POLICY: "CONTENT_POLICY",
  RATE_LIMITED: "RATE_LIMITED",
  PENDING_INVITATION: "PENDING_INVITATION",
  INVITATION_NOT_FOUND: "INVITATION_NOT_FOUND",
  INVITATION_ALREADY_USED: "INVITATION_ALREADY_USED",
  INVITATION_EXPIRED: "INVITATION_EXPIRED",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * SOURCE OF TRUTH KEYWORDS: StructuredErrorCause, StructuredError
 *
 * WHAT:  Discriminated union of every structured error payload.
 * WHY:   `errorCode` narrows the union in switch statements, giving callers
 *        type-safe access to error-specific fields (resource, retryAfter, etc.).
 * WHERE: Set as `cause` on TRPCError via createStructuredError; surfaced to
 *        clients through the tRPC errorFormatter.
 */
/* Discriminated union — `errorCode` narrows in switch statements. */
export type StructuredErrorCause =
  | {
      errorCode: typeof ERROR_CODES.ONBOARDING_INCOMPLETE;
      requiredStep: "onboarding";
      message: string;
    }
  | {
      errorCode: typeof ERROR_CODES.NOT_ORGANIZATION_MEMBER;
      organizationId: string;
      message: string;
    }
  | {
      errorCode: typeof ERROR_CODES.INSUFFICIENT_PERMISSIONS;
      required: string[];
      current: string;
      message: string;
    }
  | {
      errorCode: typeof ERROR_CODES.VALIDATION_ERROR;
      message: string;
    }
  | {
      errorCode: typeof ERROR_CODES.FEATURE_NOT_AVAILABLE;
      resource: ResourceKey;
      currentPlan: PlanKey;
      upgradeRequired: true;
      message: string;
      /* UPGRADE_COPY_FROM_REGISTRY: the resource's own upgrade sentence with
       * {nextPlan} already resolved against currentPlan — see getUpgradeMessage
       * in src/lib/resources.ts. Carried on the error so the client can open the
       * upgrade modal with the RIGHT sentence without a follow-up round trip. */
      upgradeMessage: string;
    }
  | {
      errorCode: typeof ERROR_CODES.USAGE_LIMIT_REACHED;
      /* ResourceKey, not `string`: the client narrows on this to name the
       * feature and highlight it in the pricing table. */
      resource: ResourceKey;
      limit: number;
      current: number;
      currentPlan: PlanKey;
      upgradeRequired: true;
      message: string;
      /* See FEATURE_NOT_AVAILABLE above. */
      upgradeMessage: string;
    }
  | {
      errorCode: typeof ERROR_CODES.INSUFFICIENT_CREDITS;
      resource: ResourceKey;
      required: number;
      available: number;
      message: string;
    }
  | {
      errorCode: typeof ERROR_CODES.EMAIL_NOT_VERIFIED;
      /* The address the link was sent to, so the client can say WHICH inbox to
       * check — the commonest cause of "I never got it" is a typo the customer
       * cannot see from the error. */
      email: string;
      message: string;
    }
  | {
      errorCode: typeof ERROR_CODES.CONTENT_POLICY;
      /* The named categories, already customer-facing. Carried separately from
       * `message` so a client can render them as chips without parsing a
       * sentence. */
      categories: string[];
      /* `flagged` means a person will look; `rejected` means edit and retry.
       * The client's copy differs, so the distinction is on the error. */
      review: boolean;
      message: string;
    }
  | {
      errorCode: typeof ERROR_CODES.RATE_LIMITED;
      limit: number;
      remaining: number;
      resetAt: number;
      retryAfter: number;
      message: string;
    }
  | {
      errorCode: typeof ERROR_CODES.PENDING_INVITATION;
      invitationId: string;
      organizationId: string;
      organizationName: string;
      role: string;
      message: string;
    }
  | {
      errorCode: typeof ERROR_CODES.INVITATION_NOT_FOUND;
      message: string;
    }
  | {
      errorCode: typeof ERROR_CODES.INVITATION_ALREADY_USED;
      status: string;
      message: string;
    }
  | {
      errorCode: typeof ERROR_CODES.INVITATION_EXPIRED;
      message: string;
    };

export type StructuredError = StructuredErrorCause;
