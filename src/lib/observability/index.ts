/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: observability barrel, logLine, captureError,
 *   trackFunnelEvent, resolveRequestId, REQUEST_ID_HEADER, ONE_LOGGER
 *
 * WHAT:  The public surface of the observability layer — the correlation id,
 *        the one structured logger, the error reporter and the funnel.
 *
 * WHY:   Grouped because the four are one concern with one thread running
 *        through them: `requestId`. A log line, an error report and a funnel
 *        event about the same piece of work all carry the same id, which is
 *        what lets an operator move between the three. Splitting them across
 *        the codebase is how that correspondence quietly stops holding.
 *
 *        ONE_LOGGER — nothing outside this folder may construct a log format.
 *        The phase's instruction was to extend the procedure builder's existing
 *        structured JSON rather than add a second logger, and the barrel is
 *        what makes that reviewable: anything emitting telemetry imports from
 *        here.
 *
 *        `request-id.ts` is the only PURE module in it and is deliberately
 *        importable on its own — src/proxy.ts runs in the edge runtime and
 *        must not pull in `server-only`, Sentry or the PostHog client to stamp
 *        a header.
 * WHERE: Imported as '@/lib/observability' by the procedure factory, the
 *        Inngest functions, the webhook routes and the routers.
 */

export { logError, logLine } from "./logger";
export type { LogLine } from "./logger";

export {
  REQUEST_ID_HEADER,
  newRequestId,
  readRequestId,
  resolveRequestId,
} from "./request-id";

export {
  captureError,
  flushSentry,
  isSentryConfigured,
  sentryTracesSampleRate,
} from "./sentry";
export type { ErrorContext } from "./sentry";

export {
  FUNNEL_EVENTS,
  flushAnalytics,
  isPostHogConfigured,
  trackFunnelEvent,
} from "./analytics";
export type { FunnelEvent } from "./analytics";
