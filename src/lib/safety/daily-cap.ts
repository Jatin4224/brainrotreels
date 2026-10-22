/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: DAILY_GENERATION_CAPS, dailyGenerationCapFor,
 *   checkDailyGenerationCap, DailyCapResult, GENERATION_CAP_WINDOW,
 *   CAP_IS_IN_REDIS_NOT_THE_COUNTER, A_RATE_NOT_A_QUOTA, CAP_FAILS_OPEN
 *
 * WHAT:  How many videos one workspace may generate per day, by plan.
 *
 * WHY:   CAP_IS_IN_REDIS_NOT_THE_COUNTER, and the choice needs defending
 *        because this codebase already has a per-plan limit mechanism. The
 *        registry's `limit` is counted in `UsageMetrics` and its `period` union
 *        is `'month'` only — deliberately, because that counter is the BILLING
 *        quota and a reset cron drives it (src/lib/usage-period.ts).
 *
 *        A_RATE_NOT_A_QUOTA is why this is a different thing. The daily cap is
 *        an abuse guardrail: it exists to stop an automated account spending a
 *        provider bill overnight, not to describe what a customer bought. It
 *        wants a rolling window, it must reset without a cron, and a workspace
 *        hitting it is not over its plan — it is going too fast. Modelling it
 *        as a registry `limit` would mean extending the period union to
 *        `'day'`, teaching the reset cron a second cadence, and then having a
 *        number in the billing counter that is not a billing number. The phase
 *        asks for Redis for exactly this reason, and Upstash already does
 *        rolling windows for every other limiter here.
 *
 *        What is NOT duplicated is the per-plan numbers. They live in ONE
 *        constant typed as a full `Record<PlanKey, …>`, so adding a plan is a
 *        compile error here rather than a plan that silently gets the free
 *        workspace's cap — the same property the registry's `perPlan` maps
 *        give.
 *
 *        CAP_FAILS_OPEN, like every other limiter in this app and unlike the
 *        moderation layer. With no Redis configured the cap does not apply, and
 *        that is the right trade for an abuse guardrail: refusing every
 *        generation because a cache is down would break paying customers to
 *        inconvenience an attacker. The moderation layer is where failing
 *        closed is worth the cost — see the note on `checkRateLimit`.
 * WHERE: `projects.generate`, before anything is enqueued.
 */

import "server-only";

import { PLAN_KEYS, type PlanKey } from "@/lib/config/plans";
import { checkRateLimit, getResourceLimiter } from "@/lib/rate-limit";

/**
 * SOURCE OF TRUTH KEYWORDS: GENERATION_CAP_WINDOW
 *
 * A ROLLING day, not a calendar one. A calendar reset at midnight UTC hands
 * an abuser two full allowances an hour apart either side of it, and gives
 * every honest customer in one timezone a worse product than the next.
 */
export const GENERATION_CAP_WINDOW = "1 d" as const;

/**
 * SOURCE OF TRUTH KEYWORDS: DAILY_GENERATION_CAPS
 *
 * WHAT:  Videos per rolling day, per plan.
 *
 * WHY:   The numbers are deliberately well ABOVE normal use and well below a
 *        runaway bill. A person making short-form video content publishes a
 *        handful a day; three hundred on a Pro plan is not a workflow, it is a
 *        script. Each one is a cap on STARTED generations, which is what costs
 *        money — a run that fails still consumed providers.
 *
 *        `free` is the one that matters most and is the tightest, because a
 *        free workspace is the one an attacker can make an unlimited number
 *        of (which is what the per-IP signup cap exists to slow) and the one
 *        that has paid nothing toward the bill it is running up.
 *
 *        `enterprise` and `portal` are `'unlimited'` rather than a large
 *        number. An enterprise customer who trips a guardrail nobody told them
 *        about is a support escalation, and the platform's own workspace must
 *        never be throttled while an operator is reproducing a problem.
 * WHERE: dailyGenerationCapFor, below. One constant, per the file header.
 */
export const DAILY_GENERATION_CAPS: Readonly<
  Record<PlanKey, number | "unlimited">
> = {
  free: 5,
  starter: 50,
  pro: 300,
  enterprise: "unlimited",
  portal: "unlimited",
};

/**
 * SOURCE OF TRUTH KEYWORDS: dailyGenerationCapFor, UNKNOWN_PLAN_IS_FREE
 *
 * WHAT:  The cap for a plan string.
 * WHY:   UNKNOWN_PLAN_IS_FREE. `Subscription.plan` is a string column, so a
 *        value this build does not recognise is possible — a plan renamed in
 *        Stripe, a row written by a newer release. It falls back to the FREE
 *        cap rather than to unlimited, because the unsafe direction has to be
 *        the one somebody types out deliberately.
 * WHERE: checkDailyGenerationCap.
 */
export function dailyGenerationCapFor(plan: string): number | "unlimited" {
  const known = (PLAN_KEYS as readonly string[]).includes(plan);
  if (!known) {
    console.warn(
      `[safety/daily-cap] Unrecognised plan "${plan}"; applying the free cap.`,
    );
    return DAILY_GENERATION_CAPS.free;
  }
  return DAILY_GENERATION_CAPS[plan as PlanKey];
}

/**
 * SOURCE OF TRUTH KEYWORDS: DailyCapResult
 *
 * WHAT:  Whether this workspace may start another generation today.
 * WHY:   Carries the numbers as well as the verdict, so the refusal can say
 *        "5 of 5 used, resets in 7 hours" instead of "limit reached" — the
 *        difference between a customer who knows to come back and a customer
 *        who opens a ticket. `retryAfterSeconds` is computed here because the
 *        reset timestamp is Redis's and the arithmetic should not be repeated
 *        at every call site.
 * WHERE: Returned by checkDailyGenerationCap.
 */
export interface DailyCapResult {
  allowed: boolean;
  /** The plan's cap, or null when the plan is unlimited or Redis is absent. */
  limit: number | null;
  remaining: number | null;
  retryAfterSeconds: number | null;
  /** Customer-facing. Empty when allowed. */
  message: string;
}

const ALLOWED: DailyCapResult = {
  allowed: true,
  limit: null,
  remaining: null,
  retryAfterSeconds: null,
  message: "",
};

/**
 * SOURCE OF TRUTH KEYWORDS: checkDailyGenerationCap, CAP_IS_PER_WORKSPACE,
 *   CAP_FAILS_OPEN
 *
 * WHAT:  Consumes one unit of the workspace's daily allowance and says whether
 *        it was there to consume.
 *
 * WHY:   CAP_IS_PER_WORKSPACE, keyed on `organizationId` alone — not on the
 *        user, and not on the IP. The thing being protected is the provider
 *        bill, which a workspace runs up collectively: a five-person team
 *        sharing one plan shares one allowance, because that is what the plan
 *        sold them. Keying on the user would multiply the cap by the number of
 *        seats, which is the opposite of a cap.
 *
 *        It CONSUMES rather than inspects, which makes it unsafe to call
 *        twice for one generation — the second call would charge the allowance
 *        again. It is called from exactly one place for that reason, and the
 *        idempotency key on the enqueue is what makes a double-clicked button
 *        one run rather than two deductions.
 *
 *        CAP_FAILS_OPEN — see the file header. `checkRateLimit` already
 *        returns `allowed: true` with zeroed numbers when there is no limiter,
 *        so the absence of Redis needs no branch here beyond not reporting
 *        counts nobody measured.
 * WHERE: `projects.generate`.
 */
export async function checkDailyGenerationCap(
  organizationId: string,
  plan: string,
): Promise<DailyCapResult> {
  const cap = dailyGenerationCapFor(plan);
  if (cap === "unlimited") return ALLOWED;

  /* Reuses the resource-limiter builder so the key naming, the sliding-window
   * algorithm and the memoisation are the ones every other limiter here uses.
   * The limiter is keyed per PLAN as well as per resource, because a workspace
   * that upgrades mid-day must get the new allowance rather than inheriting a
   * window sized for the old one. */
  const limiter = getResourceLimiter(
    "generations",
    `daily.${plan}`,
    cap,
    GENERATION_CAP_WINDOW,
  );

  const result = await checkRateLimit(limiter, organizationId);
  if (result.allowed) {
    return {
      allowed: true,
      limit: limiter === null ? null : cap,
      remaining: limiter === null ? null : result.remaining,
      retryAfterSeconds: null,
      message: "",
    };
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((result.resetAt - Date.now()) / 1000),
  );

  return {
    allowed: false,
    limit: cap,
    remaining: 0,
    retryAfterSeconds,
    message: `This workspace has generated its ${cap} videos for today. The limit resets in ${formatWait(retryAfterSeconds)}, or you can upgrade for a higher daily limit.`,
  };
}

/* "7 hours", not "25140 seconds". The message is the only thing a blocked
 * customer reads, and a seconds count is a number they have to do arithmetic
 * on to find out whether to wait. */
function formatWait(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
