/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PROVIDER_UNIT_COSTS, PLACEHOLDER_UNIT_COSTS,
 *   ProviderKey, PROVIDER_KEYS, usdForRenderSeconds, usdForNarrationSeconds,
 *   usdForAlignmentSeconds, usdForScriptCall, CREDIT_USD_VALUE, creditsToUsd,
 *   COST_IS_OUR_ESTIMATE_NOT_AN_INVOICE, MARGIN_IS_THE_POINT
 *
 * WHAT:  What a video actually costs us to make, in dollars, derived from what
 *        we know we asked each provider to do.
 *
 * WHY:   COST_IS_OUR_ESTIMATE_NOT_AN_INVOICE, and that limitation is the first
 *        thing to understand about this module. It does NOT read AWS Cost
 *        Explorer, Anthropic's usage API or ElevenLabs' billing endpoint —
 *        none of which this app has credentials for. It multiplies units we
 *        recorded ourselves (render seconds, narration seconds, model calls) by
 *        published list prices held below. So it is accurate about OUR USAGE
 *        and approximate about the BILL: it cannot see a provider's minimum
 *        charge, a tiered discount, egress, or a retry some SDK made on our
 *        behalf. Treat a 20% gap against the real invoice as normal and a 200%
 *        gap as a bug.
 *
 *        It is still worth having, because the question the portal has to
 *        answer — "what did yesterday's videos cost us, and what did we charge?"
 *        — is unanswerable without it, and an approximate margin computed daily
 *        beats an exact one computed when the invoice lands a month later. The
 *        phase asks for exactly this comparison, which is also why Phase 05's
 *        estimator returns a BREAKDOWN rather than a total.
 *
 *        MARGIN_IS_THE_POINT. The two halves are deliberately computed by
 *        different code: cost comes from provider units, revenue comes from the
 *        credit ledger through `creditsToUsd`. If one function produced both,
 *        a pricing mistake would cancel itself out and the margin would always
 *        look fine.
 *
 *        PURE — no Prisma, no network, no clock. It takes counted units and
 *        returns dollars, so the arithmetic is unit-testable and the SERVICE
 *        does the counting. Same reasoning as ESTIMATE_IS_PURE in
 *        src/lib/credits/estimate.ts, and these two modules are deliberately
 *        separate: that one prices work for a CUSTOMER in credits, this one
 *        prices it for US in dollars, and merging them is how a change to one
 *        silently moves the other.
 * WHERE: src/services/portal.service.ts (the cost-vs-charged panel) and
 *        src/lib/costs/alerts.ts (the daily spend threshold).
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PROVIDER_KEYS, ProviderKey
 *
 * WHAT:  The providers whose spend is tracked separately.
 * WHY:   One per vendor that can independently run up a bill, which is the
 *        grouping an operator needs: "the bill doubled" is only actionable once
 *        you know which of the four did it. `jobs` (Inngest) is included even
 *        though it is priced per step rather than per second, because a runaway
 *        retry loop is a real way to spend money there.
 * WHERE: The keys of PROVIDER_UNIT_COSTS and of a spend breakdown.
 */
export const PROVIDER_KEYS = ["render", "llm", "tts", "stt", "jobs"] as const;

export type ProviderKey = (typeof PROVIDER_KEYS)[number];

/**
 * SOURCE OF TRUTH KEYWORDS: PROVIDER_UNIT_COSTS, PLACEHOLDER_UNIT_COSTS
 *
 * WHAT:  List price per unit, in US dollars.
 *
 * WHY:   ⚠ THESE ARE PUBLISHED LIST PRICES ENTERED BY HAND, NOT A FEED. ⚠
 *
 *        They will drift the moment a provider changes a price, and nothing in
 *        this codebase will notice. They are in ONE object for exactly that
 *        reason: correcting them is one edit with no arithmetic anywhere else
 *        to find, which is the same decision PLACEHOLDER_CREDIT_RATES made.
 *
 *        Two properties the code depends on, which any correction must keep:
 *        every value is a non-negative finite number, and a unit that does not
 *        apply to a provider is `0` rather than absent — a missing rate would
 *        produce `NaN`, and a `NaN` dollar figure would propagate silently
 *        through every total on the portal.
 * WHERE: The `usdFor*` functions below, and nowhere else.
 */
export const PROVIDER_UNIT_COSTS = {
  /**
   * Lambda render, per second of OUTPUT video. A 1080p render costs materially
   * more than 720p because it is the same frames at more pixels, and the
   * concurrency that makes a render fast is what makes it expensive.
   */
  renderPerOutputSecond: {
    "720p": 0.004,
    "1080p": 0.009,
  },
  /** Narration, per second of synthesised audio. */
  ttsPerSecond: 0.0022,
  /** Forced alignment, per second of audio sent to the aligner. */
  sttPerSecond: 0.0004,
  /**
   * One script generation. A flat figure rather than per-token, because this
   * app's script calls are a narrow band — one system prompt, one article, a
   * few hundred words out — and a per-token model would need token counts
   * nothing currently records.
   */
  llmPerScriptCall: 0.09,
  /** One moderation classification. Far cheaper: short output, small budget. */
  llmPerModerationCall: 0.006,
  /** One workflow step, Inngest's own billing unit. */
  jobsPerStep: 0.000_02,
} as const;

/**
 * SOURCE OF TRUTH KEYWORDS: CREDIT_USD_VALUE, creditsToUsd, MARGIN_IS_THE_POINT
 *
 * WHAT:  What one credit is worth in revenue.
 *
 * WHY:   Derived from the credit packs' own pricing rather than guessed — but
 *        it is deliberately a SINGLE number rather than a per-pack
 *        calculation, because a workspace's credits are fungible once bought
 *        and nothing records which pack a particular credit came from. A
 *        customer who bought the bulk pack and one who bought the small pack
 *        contribute different revenue per credit; this is the blended figure,
 *        and the margin it produces is therefore directional.
 *
 *        It is NOT read from `CREDIT_PACKS` programmatically, and that is the
 *        one thing here worth arguing about. Doing so would make the margin
 *        move whenever a pack's price changed, which sounds right and is
 *        wrong: it would retroactively revalue credits that were already sold
 *        at the old price. A stated constant with a note beats a derived number
 *        that silently rewrites history.
 * WHERE: creditsToUsd, used by the portal's revenue half.
 */
export const CREDIT_USD_VALUE = 0.02;

export function creditsToUsd(credits: number): number {
  if (!Number.isFinite(credits) || credits <= 0) return 0;
  return round(credits * CREDIT_USD_VALUE);
}

/**
 * SOURCE OF TRUTH KEYWORDS: usdForRenderSeconds, UNKNOWN_RESOLUTION_COSTS_MORE
 *
 * WHAT:  What rendering this many seconds cost.
 * WHY:   UNKNOWN_RESOLUTION_COSTS_MORE: `Render.resolution` is a string column,
 *        so an unrecognised value is possible — and it is priced at the HIGHER
 *        rate. Under-reporting cost is the dangerous direction for a number
 *        whose whole job is to tell you whether you are losing money.
 * WHERE: The portal's cost aggregation.
 */
export function usdForRenderSeconds(
  seconds: number,
  resolution: string,
): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;

  const rate =
    resolution === "720p"
      ? PROVIDER_UNIT_COSTS.renderPerOutputSecond["720p"]
      : PROVIDER_UNIT_COSTS.renderPerOutputSecond["1080p"];

  return round(seconds * rate);
}

export function usdForNarrationSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return round(seconds * PROVIDER_UNIT_COSTS.ttsPerSecond);
}

export function usdForAlignmentSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return round(seconds * PROVIDER_UNIT_COSTS.sttPerSecond);
}

export function usdForScriptCalls(calls: number): number {
  if (!Number.isFinite(calls) || calls <= 0) return 0;
  return round(calls * PROVIDER_UNIT_COSTS.llmPerScriptCall);
}

export function usdForModerationCalls(calls: number): number {
  if (!Number.isFinite(calls) || calls <= 0) return 0;
  return round(calls * PROVIDER_UNIT_COSTS.llmPerModerationCall);
}

export function usdForJobSteps(steps: number): number {
  if (!Number.isFinite(steps) || steps <= 0) return 0;
  return round(steps * PROVIDER_UNIT_COSTS.jobsPerStep);
}

/**
 * SOURCE OF TRUTH KEYWORDS: SpendBreakdown, totalSpend, BREAKDOWN_NEVER_A_BARE_TOTAL
 *
 * WHAT:  Dollars by provider, and their sum.
 * WHY:   BREAKDOWN_NEVER_A_BARE_TOTAL, the same rule as `CostBreakdown` in the
 *        credit estimator and for the same reason: "yesterday cost $412" is
 *        unactionable, and "$390 of it was Lambda" is a decision. The total is
 *        computed from the parts rather than carried alongside them, so the two
 *        cannot disagree.
 * WHERE: The portal panel and the alert threshold.
 */
export interface SpendBreakdown {
  render: number;
  llm: number;
  tts: number;
  stt: number;
  jobs: number;
}

export function totalSpend(spend: SpendBreakdown): number {
  return round(
    spend.render + spend.llm + spend.tts + spend.stt + spend.jobs,
  );
}

/* Dollars to the cent plus two, because a single narration second costs a tiny
 * fraction of a cent and rounding each line to the cent would floor most of
 * them to zero. Rounded at every boundary rather than at the end, so the
 * figures an operator sees add up exactly to the total shown. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
