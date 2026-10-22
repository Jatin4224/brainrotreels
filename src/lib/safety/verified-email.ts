/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: VERIFIED_EMAIL_PLANS, requiresVerifiedEmail,
 *   VERIFICATION_IS_A_GENERATION_GATE, FREE_TIER_IS_THE_ATTACK_SURFACE
 *
 * WHAT:  Which plans must have a verified email address before they may
 *        generate.
 *
 * WHY:   VERIFICATION_IS_A_GENERATION_GATE, not a sign-in gate, and the
 *        distinction is the whole reason this file exists. Better Auth already
 *        enforces verification at SIGN-IN — that is configured in
 *        src/lib/better-auth/auth.ts and nothing here duplicates it. What it
 *        cannot express is "you may look around, but you may not spend our
 *        provider budget until we know this address is real", which is the
 *        check the phase asks for.
 *
 *        FREE_TIER_IS_THE_ATTACK_SURFACE is why it applies to `free` and
 *        nothing else. A paying workspace has already presented a card, which
 *        is a far stronger identity signal than an email round-trip, and
 *        blocking a customer who has paid because they never clicked a link is
 *        a refund. An unverified free workspace is a throwaway address with a
 *        daily allowance of real provider spend attached.
 *
 *        It is a `Set` over plan keys rather than a boolean per plan in the
 *        registry, because this is not an ENTITLEMENT — it is not something a
 *        plan includes or excludes, and putting it in `RESOURCES` would make it
 *        appear on the pricing table as a feature. Typed against `PlanKey`, so
 *        a renamed plan is a compile error rather than a silently ungated tier.
 *
 *        PURE — no database, no adapter. It takes the two facts and returns a
 *        decision, so the rule is unit-testable and the CALLER does the reads.
 * WHERE: `projects.generate`, which has both facts in its context already.
 */

import { PLAN_KEYS, type PlanKey } from "@/lib/config/plans";

/**
 * SOURCE OF TRUTH KEYWORDS: VERIFIED_EMAIL_PLANS, FREE_TIER_IS_THE_ATTACK_SURFACE
 *
 * The plans for which an unverified address blocks generation. See the file
 * header for why this is only `free`.
 */
export const VERIFIED_EMAIL_PLANS: ReadonlySet<PlanKey> = new Set<PlanKey>([
  "free",
]);

/**
 * SOURCE OF TRUTH KEYWORDS: requiresVerifiedEmail, UNKNOWN_PLAN_IS_FREE
 *
 * WHAT:  Whether this plan demands a verified address before generating.
 * WHY:   UNKNOWN_PLAN_IS_FREE, the same fallback and the same reasoning as
 *        `dailyGenerationCapFor`: `Subscription.plan` is a string column, and
 *        an unrecognised value must land on the SAFE side of the rule rather
 *        than being waved through as though it were enterprise.
 * WHERE: `projects.generate`.
 */
export function requiresVerifiedEmail(plan: string): boolean {
  const known = (PLAN_KEYS as readonly string[]).includes(plan);
  if (!known) {
    console.warn(
      `[safety/verified-email] Unrecognised plan "${plan}"; requiring verification.`,
    );
    return true;
  }
  return VERIFIED_EMAIL_PLANS.has(plan as PlanKey);
}
