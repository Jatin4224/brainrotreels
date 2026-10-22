/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: DAILY_SPEND_THRESHOLD_USD, evaluateSpendAlert,
 *   SpendAlert, THRESHOLD_IS_A_TRIPWIRE, ALERT_ON_THE_PROVIDER_NOT_THE_TOTAL,
 *   OUR_RECORDS_NOT_THEIR_INVOICE
 *
 * WHAT:  Whether yesterday's estimated provider spend crossed a threshold
 *        worth waking somebody for, and which provider caused it.
 *
 * WHY:   THRESHOLD_IS_A_TRIPWIRE, not a budget. Generative work can run up a
 *        bill faster than anybody checks a dashboard — one broken retry loop,
 *        one customer scripting the API, one runaway render — and the thing
 *        that catches it is a crude number that fires. It deliberately does not
 *        try to forecast, prorate or compare against a monthly allowance:
 *        every one of those makes the alert cleverer and later.
 *
 *        ALERT_ON_THE_PROVIDER_NOT_THE_TOTAL. The alert carries the biggest
 *        contributor, because "spend is high" sends an operator to a dashboard
 *        and "Lambda was 94% of it" sends them to the render queue. A total
 *        alone is the version of this that gets acknowledged and ignored.
 *
 *        OUR_RECORDS_NOT_THEIR_INVOICE — inherited from ./index.ts and worth
 *        repeating at the point somebody gets paged: these dollars are our own
 *        usage at list prices, so the threshold should be set well below the
 *        real pain point. An alert that under-reports is the dangerous
 *        direction, which is why the unit costs round unknown cases UP.
 *
 *        PURE — it takes a breakdown and returns a verdict. The SERVICE counts
 *        and the WORKFLOW sends, so the rule is testable with no database and
 *        no mail provider.
 * WHERE: Evaluated by src/inngest/functions/cost-alert.ts, which runs daily.
 */

import { PROVIDER_KEYS, totalSpend, type SpendBreakdown } from "./index";

/**
 * SOURCE OF TRUTH KEYWORDS: DAILY_SPEND_THRESHOLD_USD, COST_ALERT_THRESHOLD_USD
 *
 * WHAT:  The daily figure that fires the alert, in US dollars.
 *
 * WHY:   Overridable by environment, because the right number is a business
 *        decision that changes with scale and must not need a deploy — the
 *        same reasoning as `ANTHROPIC_MODEL` being configurable. The DEFAULT is
 *        deliberately low: a pre-launch product spending fifty dollars of
 *        providers in a day is either doing well or badly, and both are worth
 *        knowing about on day one. A high default would mean the alert never
 *        fires until it matters, which is when nobody has tested it.
 * WHERE: evaluateSpendAlert.
 */
export const DEFAULT_DAILY_SPEND_THRESHOLD_USD = 50;

export function dailySpendThresholdUsd(): number {
  const raw = Number(process.env["COST_ALERT_THRESHOLD_USD"]);
  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_DAILY_SPEND_THRESHOLD_USD;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SpendAlert, ALERT_ON_THE_PROVIDER_NOT_THE_TOTAL
 *
 * WHAT:  The verdict, and everything a message needs.
 * WHY:   `message` is built here rather than at the send site, so the Slack
 *        line, the log line and any future email all say the same thing — the
 *        same reasoning as MESSAGE_IS_BUILT_ONCE in the moderation service.
 * WHERE: Returned by evaluateSpendAlert.
 */
export interface SpendAlert {
  triggered: boolean;
  totalUsd: number;
  thresholdUsd: number;
  /** The provider that contributed most, and its share of the total. */
  topProvider: string;
  topProviderUsd: number;
  topProviderShare: number;
  /** Ready to log or send. Empty when nothing triggered. */
  message: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: evaluateSpendAlert, THRESHOLD_IS_A_TRIPWIRE
 *
 * WHAT:  Compares a day's spend against the threshold.
 * WHY:   Returns a verdict even when nothing fired, with the numbers filled
 *        in, so the caller can LOG every evaluation rather than only the
 *        failures. A tripwire nobody can see working is one nobody trusts the
 *        silence of — the daily "spend was $12 of a $50 threshold" line is what
 *        proves the check ran.
 * WHERE: The daily cost-alert workflow.
 */
export function evaluateSpendAlert(spend: SpendBreakdown): SpendAlert {
  const totalUsd = totalSpend(spend);
  const thresholdUsd = dailySpendThresholdUsd();

  /* Picked from the tuple rather than Object.entries, so the comparison is
   * over the declared providers and a new key added to the breakdown without
   * being added to PROVIDER_KEYS cannot silently win. */
  let topProvider: string = PROVIDER_KEYS[0];
  let topProviderUsd = 0;
  for (const provider of PROVIDER_KEYS) {
    const amount = spend[provider];
    if (amount > topProviderUsd) {
      topProvider = provider;
      topProviderUsd = amount;
    }
  }

  const topProviderShare =
    totalUsd === 0 ? 0 : Math.round((topProviderUsd / totalUsd) * 100) / 100;

  const triggered = totalUsd >= thresholdUsd;

  return {
    triggered,
    totalUsd,
    thresholdUsd,
    topProvider,
    topProviderUsd,
    topProviderShare,
    message: triggered
      ? `Estimated provider spend was $${totalUsd.toFixed(2)} in the last day, over the $${thresholdUsd.toFixed(2)} threshold. Largest contributor: ${topProvider} at $${topProviderUsd.toFixed(2)} (${Math.round(topProviderShare * 100)}%). These are our own usage records at list prices, not an invoice.`
      : "",
  };
}
