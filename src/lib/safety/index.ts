/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: safety barrel, DAILY_GENERATION_CAPS,
 *   checkDailyGenerationCap, SIGNUP_IP_LIMIT, checkSignupIpLimit,
 *   requireVerifiedEmail, GenerationGateResult, LAUNCH_GUARDRAILS
 *
 * WHAT:  The public surface of the launch guardrails — the per-plan daily
 *        generation cap, the per-IP signup cap, and the verified-email
 *        requirement.
 *
 * WHY:   LAUNCH_GUARDRAILS. These three exist because the product is about to
 *        be opened to strangers, and each one closes a hole that only matters
 *        once anybody can sign up: an automated account generating videos until
 *        the provider bill hurts, one person creating a hundred free workspaces
 *        to get a hundred free quotas, and a throwaway address doing either.
 *
 *        They are grouped as `safety` rather than scattered because they share
 *        one property that is easy to get wrong individually: each is a
 *        PRE-FLIGHT REFUSAL that must happen before any paid work, and each has
 *        to return a reason a customer can act on rather than a bare boolean.
 *        A barrel makes the set reviewable as a set — "what stops abuse" has
 *        one answer and one folder.
 *
 *        Importers use this barrel, exactly as src/lib/timeline and
 *        src/lib/captions do, so the internal split stays free to change.
 * WHERE: Imported as '@/lib/safety' by `projects.generate` and by the POST
 *        branch of src/app/api/auth/[...all]/route.ts.
 */

export {
  DAILY_GENERATION_CAPS,
  GENERATION_CAP_WINDOW,
  checkDailyGenerationCap,
  dailyGenerationCapFor,
} from "./daily-cap";
export type { DailyCapResult } from "./daily-cap";

export {
  SIGNUP_IP_LIMIT,
  SIGNUP_IP_WINDOW,
  checkSignupIpLimit,
} from "./signup-limit";

export {
  VERIFIED_EMAIL_PLANS,
  requiresVerifiedEmail,
} from "./verified-email";
