/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: safety test, UNKNOWN_PLAN_IS_FREE,
 *   FREE_TIER_IS_THE_ATTACK_SURFACE, DAILY_GENERATION_CAPS,
 *   ONE_PERSON_ONE_WORKSPACE, isModerationCleared, NOT_APPROVED_DOES_NOT_RENDER
 *
 * WHAT:  The launch guardrails' pure decisions — which plans are capped, which
 *        need a verified address, and which moderation states may render.
 *
 * WHY:   Every one of these is a rule whose unsafe direction is a silent
 *        failure rather than an error: an unrecognised plan treated as
 *        unlimited, a verification check that passes for everybody, a
 *        moderation state that renders because nobody enumerated it. The tests
 *        are written against the SAFE direction specifically, because that is
 *        the half a reviewer skims.
 *
 *        The Redis-backed halves — the daily cap and the signup cap actually
 *        counting — are not covered here: they are `checkRateLimit` calls, and
 *        asserting them would mean asserting Upstash. What IS covered is every
 *        decision made before Redis is consulted.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { PLAN_KEYS } from "@/lib/config/plans";
import { isModerationCleared } from "@/services/assets.service";
import { MODERATION_STATUSES } from "@/lib/types/asset";
import {
  DAILY_GENERATION_CAPS,
  GENERATION_CAP_WINDOW,
  dailyGenerationCapFor,
} from "./daily-cap";
import { SIGNUP_IP_LIMIT, SIGNUP_IP_WINDOW } from "./signup-limit";
import { VERIFIED_EMAIL_PLANS, requiresVerifiedEmail } from "./verified-email";

describe("DAILY_GENERATION_CAPS", () => {
  /* One entry per plan, which is the property that makes this a single source
   * of truth rather than a lookup with a hole in it. */
  it("has a cap for every plan and no others", () => {
    expect(Object.keys(DAILY_GENERATION_CAPS).sort()).toEqual(
      [...PLAN_KEYS].sort(),
    );
  });

  it("rises with the plan and is unlimited only at the top", () => {
    expect(DAILY_GENERATION_CAPS.free).toBeLessThan(
      DAILY_GENERATION_CAPS.starter as number,
    );
    expect(DAILY_GENERATION_CAPS.starter as number).toBeLessThan(
      DAILY_GENERATION_CAPS.pro as number,
    );
    expect(DAILY_GENERATION_CAPS.enterprise).toBe("unlimited");
    expect(DAILY_GENERATION_CAPS.portal).toBe("unlimited");
  });

  /* A ROLLING window. A calendar day would hand an abuser two allowances an
   * hour apart across the boundary. */
  it("uses a rolling day", () => {
    expect(GENERATION_CAP_WINDOW).toBe("1 d");
  });
});

describe("dailyGenerationCapFor", () => {
  it("returns each plan's own cap", () => {
    for (const plan of PLAN_KEYS) {
      expect(dailyGenerationCapFor(plan), plan).toBe(
        DAILY_GENERATION_CAPS[plan],
      );
    }
  });

  /* UNKNOWN_PLAN_IS_FREE. `Subscription.plan` is a string column, so this is
   * reachable — and the unsafe answer (`unlimited`) must be the one somebody
   * has to type out deliberately. */
  it("falls back to the free cap for a plan it does not know", () => {
    expect(dailyGenerationCapFor("enterprise-plus")).toBe(
      DAILY_GENERATION_CAPS.free,
    );
    expect(dailyGenerationCapFor("")).toBe(DAILY_GENERATION_CAPS.free);
    expect(dailyGenerationCapFor("UNLIMITED")).toBe(
      DAILY_GENERATION_CAPS.free,
    );
  });
});

describe("requiresVerifiedEmail", () => {
  /* FREE_TIER_IS_THE_ATTACK_SURFACE — and a paying customer is not blocked for
   * never clicking a link, because that is a refund. */
  it("requires verification on free and not on paid plans", () => {
    expect(requiresVerifiedEmail("free")).toBe(true);
    expect(requiresVerifiedEmail("starter")).toBe(false);
    expect(requiresVerifiedEmail("pro")).toBe(false);
    expect(requiresVerifiedEmail("enterprise")).toBe(false);
  });

  it("does not gate the platform's own workspace", () => {
    /* An operator reproducing a customer's problem must not be stopped by a
     * verification flow on an internal account. */
    expect(requiresVerifiedEmail("portal")).toBe(false);
  });

  it("requires verification for a plan it does not know", () => {
    expect(requiresVerifiedEmail("mystery-tier")).toBe(true);
  });

  it("names its plans from the plan union", () => {
    for (const plan of VERIFIED_EMAIL_PLANS) {
      expect((PLAN_KEYS as readonly string[]).includes(plan), plan).toBe(true);
    }
  });
});

describe("the signup cap", () => {
  /* ONE_PERSON_ONE_WORKSPACE is the intent and an IP is a poor proxy for a
   * person, so the count has to leave room for a shared network. A cap of 1
   * would lock out an office; a cap of 100 would not slow a farm. */
  it("leaves room for a shared network while still being a cap", () => {
    expect(SIGNUP_IP_LIMIT).toBeGreaterThan(1);
    expect(SIGNUP_IP_LIMIT).toBeLessThanOrEqual(10);
  });

  /* Hours, not seconds. The threat is a slow farm, which the auth limiter's
   * 60-second window never notices. */
  it("spans hours rather than minutes", () => {
    expect(SIGNUP_IP_WINDOW.endsWith("h")).toBe(true);
  });
});

describe("isModerationCleared", () => {
  /* NOT_APPROVED_DOES_NOT_RENDER. This is the chokepoint every render passes
   * through, so each state is asserted individually rather than as "not
   * rejected" — the shape that would let `pending` through. */
  it("clears approved and skipped only", () => {
    expect(isModerationCleared("approved")).toBe(true);
    /* SKIPPED_IS_CLEARED — our own narration and render output, whose content
     * was moderated as text upstream. Blocking it would mean no generated
     * video could ever play. */
    expect(isModerationCleared("skipped")).toBe(true);
  });

  it("withholds pending and rejected", () => {
    /* `pending` is the one Phase 10 changed: before it, nothing consulted this
     * column and `pending` rendered exactly like `approved`. */
    expect(isModerationCleared("pending")).toBe(false);
    expect(isModerationCleared("rejected")).toBe(false);
  });

  /* The unknown case fails CLOSED here, unlike almost everywhere else in this
   * codebase — a state we cannot read is not a state we may render. */
  it("withholds a state it does not recognise", () => {
    expect(isModerationCleared("quarantined")).toBe(false);
    expect(isModerationCleared("")).toBe(false);
  });

  it("has an answer for every declared status", () => {
    for (const status of MODERATION_STATUSES) {
      expect(typeof isModerationCleared(status), status).toBe("boolean");
    }
  });
});
