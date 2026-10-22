/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: costAlertFunction, cost.alert, cron,
 *   ALERT_IS_A_LOG_LINE_FIRST, EVALUATE_EVERY_DAY_FIRE_RARELY,
 *   OUR_RECORDS_NOT_THEIR_INVOICE
 *
 * WHAT:  Totals the last day's estimated provider spend and raises an alert
 *        when it crosses the threshold.
 *
 * WHY:   EVALUATE_EVERY_DAY_FIRE_RARELY. It runs daily and logs its verdict
 *        every time, including the quiet days — the daily "spend was $12 of a
 *        $50 threshold" line is what proves the tripwire is armed. A check that
 *        only writes something when it fires is one whose silence nobody can
 *        distinguish from a broken cron.
 *
 *        ALERT_IS_A_LOG_LINE_FIRST, and deliberately not an email. The spend
 *        figure goes to the structured log and, when it crosses, to Sentry as a
 *        warning-level event — because that is where an on-call operator
 *        already looks and it needs no recipient list to maintain. An email
 *        would need a configured operator address and would be the second
 *        notification channel in this app for the same audience. Grep
 *        `SENTRY_IS_THE_OPERATOR_CHANNEL`.
 *
 *        It is a CRON rather than a reaction to each job, because spend is a
 *        daily aggregate: alerting per render would fire on the first
 *        expensive video and tell nobody anything about the trend.
 *
 *        OUR_RECORDS_NOT_THEIR_INVOICE — these dollars are our own usage at
 *        list prices held in src/lib/costs, not a provider bill. The threshold
 *        should therefore sit well below the figure that would actually hurt.
 * WHERE: Registered in src/inngest/functions/index.ts, served at /api/inngest.
 */

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import { evaluateSpendAlert } from "@/lib/costs/alerts";
import { captureError, logLine, newRequestId } from "@/lib/observability";
import { costVersusCharged, windowFromDays } from "@/services/video-ops.service";

export const costAlertFunction = inngestClient.createFunction(
  {
    id: "cost-alert",
    name: "Check yesterday's provider spend",
    /* Just after midnight UTC, so the window it reports on is a whole day. The
     * hour is arbitrary; nothing downstream depends on it. */
    triggers: [{ cron: "15 0 * * *" }],
    /* One retry. The read is a handful of aggregates — if it fails twice the
     * database is having a worse day than the bill is. */
    retries: 1,
  },
  async ({ step }) => {
    /* A cron has no request behind it, so it mints its own id — every line
     * this run emits still ties together (ID_IS_CARRIED_NOT_DERIVED). */
    const requestId = newRequestId();

    const alert = await step.run("evaluate-spend", async () => {
      const economics = await costVersusCharged(windowFromDays(1));
      return {
        ...evaluateSpendAlert(economics.spend),
        chargedUsd: economics.chargedUsd,
        marginUsd: economics.marginUsd,
        videos: economics.videos,
      };
    });

    /* EVALUATE_EVERY_DAY_FIRE_RARELY — logged whether or not it crossed. */
    logLine({
      level: alert.triggered ? "warn" : "info",
      logger: "cost",
      event: alert.triggered ? "spend_threshold_crossed" : "spend_checked",
      requestId,
      data: {
        totalUsd: alert.totalUsd,
        thresholdUsd: alert.thresholdUsd,
        topProvider: alert.topProvider,
        topProviderUsd: alert.topProviderUsd,
        chargedUsd: alert.chargedUsd,
        marginUsd: alert.marginUsd,
        videos: alert.videos,
      },
    });

    if (alert.triggered) {
      /* SENTRY_IS_THE_OPERATOR_CHANNEL. An Error is constructed rather than
       * caught, which is the one place in this codebase that happens — the
       * threshold crossing is not an exception, but Sentry is the surface an
       * operator is already paged from, and inventing a second notification
       * path for one alert would be the worse trade. The message is the one
       * `evaluateSpendAlert` built, so the log line and the alert agree. */
      captureError(new Error(alert.message), {
        requestId,
        logger: "cost",
        event: "spend_threshold_crossed",
        extra: {
          totalUsd: alert.totalUsd,
          thresholdUsd: alert.thresholdUsd,
          topProvider: alert.topProvider,
          topProviderUsd: alert.topProviderUsd,
        },
      });
    }

    return {
      triggered: alert.triggered,
      totalUsd: alert.totalUsd,
      thresholdUsd: alert.thresholdUsd,
      topProvider: alert.topProvider,
    };
  },
);
