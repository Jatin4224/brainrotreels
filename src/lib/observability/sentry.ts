/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: isSentryConfigured, SENTRY_DSN, captureError,
 *   withRequestScope, LAZY_SENTRY, SENTRY_OWNS_THE_STACK,
 *   NEVER_THROW_FROM_THE_REPORTER
 *
 * WHAT:  The app's one error reporter: a thin wrapper over `@sentry/nextjs`
 *        that attaches the correlation id and no-ops when no DSN is set.
 *
 * WHY:   LAZY_SENTRY, matching `isResendConfigured` and the R2 and Stripe
 *        clients: the SDK is reached through a dynamic import on first use, so
 *        a deployment with no DSN never evaluates it. That is not only about
 *        bundle size — a module-scope `Sentry.init` would run during the build
 *        and in the setup-checklist screen, whose entire job is to report which
 *        variables are still missing.
 *
 *        SENTRY_OWNS_THE_STACK is the division of labour with the logger. The
 *        JSON log line carries the event name, the request id and the fields
 *        you query on; Sentry carries the exception, its stack, its breadcrumbs
 *        and the grouping. Putting stacks in the log stream would break its
 *        one-line-per-event property, and putting queryable fields only in
 *        Sentry would mean paying per event to answer "how often".
 *
 *        NEVER_THROW_FROM_THE_REPORTER. Every function here swallows its own
 *        failures. A reporter that throws turns a handled error into an
 *        unhandled one — the single worst possible failure mode for a module
 *        whose only job is to tell you about failures — and it would do so
 *        precisely when something is already wrong.
 *
 *        `captureError` takes the correlation id as a REQUIRED argument rather
 *        than reading it from an ambient scope. Workflow steps and webhooks run
 *        outside any request scope, which is exactly where ambient context
 *        silently yields nothing, and those are the places an error report is
 *        hardest to reconstruct from timestamps.
 * WHERE: The procedure factory's error path, every Inngest `onFailure`, the
 *        Stripe and Remotion webhook routes.
 */

import "server-only";

import { logError } from "./logger";

/**
 * SOURCE OF TRUTH KEYWORDS: isSentryConfigured, SENTRY_DSN
 *
 * WHAT:  Whether error reporting is switched on.
 * WHY:   Reads `NEXT_PUBLIC_SENTRY_DSN` — a DSN is a write-only ingest key,
 *        designed to be public (the browser SDK ships it), so the
 *        `NEXT_PUBLIC_` prefix is correct rather than a leak. One variable for
 *        both halves means the server and the browser cannot disagree about
 *        whether reporting is on.
 * WHERE: Guards every function below, and the instrumentation hooks.
 */
export function isSentryConfigured(): boolean {
  return Boolean(process.env["NEXT_PUBLIC_SENTRY_DSN"]?.trim());
}

/** The sample rate for performance traces. Errors are always sent. */
export function sentryTracesSampleRate(): number {
  const raw = Number(process.env["SENTRY_TRACES_SAMPLE_RATE"]);
  /* Traces are priced per span and are the part of Sentry that gets expensive
   * quietly. 10% is enough to see a p95 and cheap enough to leave on. */
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.1;
}

/* Memoised so the dynamic import is paid once per process, not per error — a
 * run that fails every step would otherwise resolve the module repeatedly at
 * the worst moment. */
let sdkPromise: Promise<typeof import("@sentry/nextjs")> | null = null;

async function loadSdk(): Promise<typeof import("@sentry/nextjs") | null> {
  if (!isSentryConfigured()) return null;
  if (!sdkPromise) sdkPromise = import("@sentry/nextjs");
  try {
    return await sdkPromise;
  } catch (error) {
    /* A failed import must not take the caller down — see
     * NEVER_THROW_FROM_THE_REPORTER. Reported once through the logger, which
     * has no dependencies of its own. */
    console.error("[observability/sentry] SDK could not be loaded:", error);
    sdkPromise = null;
    return null;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: ErrorContext
 *
 * WHAT:  What is attached to a report.
 * WHY:   `requestId` is the TAG — tags are indexed and searchable in Sentry,
 *        which is the whole point of threading the id this far. The rest are
 *        context fields, which are readable on an event but not searchable;
 *        that split is deliberate rather than arbitrary, because tagging
 *        high-cardinality values like a project id degrades Sentry's own
 *        indexes.
 * WHERE: captureError.
 */
export interface ErrorContext {
  requestId: string;
  /** The subsystem, matching the logger's `logger` field. */
  logger: string;
  /** A short stable event name, matching the logger's `event` field. */
  event: string;
  organizationId?: string | undefined;
  userId?: string | undefined;
  extra?: Record<string, string | number | boolean | null> | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: captureError, ALWAYS_LOG_THEN_MAYBE_REPORT
 *
 * WHAT:  Records an error in the log stream, and in Sentry when it is
 *        configured.
 *
 * WHY:   ALWAYS_LOG_THEN_MAYBE_REPORT, in that order and unconditionally. The
 *        log line goes out whether or not Sentry exists, because a deployment
 *        with no DSN must still leave a trace of its failures — and because the
 *        log happens synchronously, so it survives a process that dies before
 *        an async report is flushed.
 *
 *        It is deliberately NOT awaited by most callers. Sentry's own transport
 *        buffers and flushes, and a failure handler that awaited a network
 *        round-trip to a reporter would add latency to the error path and could
 *        itself time out.
 * WHERE: See the file header.
 */
export function captureError(error: unknown, context: ErrorContext): void {
  /* ALWAYS. */
  logError({
    logger: context.logger,
    event: context.event,
    requestId: context.requestId,
    organizationId: context.organizationId,
    userId: context.userId,
    error,
    ...(context.extra !== undefined ? { data: context.extra } : {}),
  });

  void reportToSentry(error, context);
}

async function reportToSentry(
  error: unknown,
  context: ErrorContext,
): Promise<void> {
  try {
    const sdk = await loadSdk();
    if (sdk === null) return;

    sdk.withScope((scope) => {
      /* Indexed and searchable — see ErrorContext. */
      scope.setTag("requestId", context.requestId);
      scope.setTag("subsystem", context.logger);
      scope.setTag("event", context.event);

      if (context.organizationId !== undefined) {
        scope.setContext("organization", { id: context.organizationId });
      }
      if (context.userId !== undefined) {
        /* An id, never an email or a name. The reporter is a third party and
         * this is the one place personal data would reach it by default. */
        scope.setUser({ id: context.userId });
      }
      if (context.extra !== undefined) {
        scope.setContext("detail", context.extra);
      }

      sdk.captureException(error);
    });
  } catch (reporterError) {
    /* NEVER_THROW_FROM_THE_REPORTER. */
    console.error(
      "[observability/sentry] Reporting failed and was swallowed:",
      reporterError,
    );
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: flushSentry, FLUSH_BEFORE_THE_PROCESS_DIES
 *
 * WHAT:  Waits for buffered events to be sent.
 *
 * WHY:   FLUSH_BEFORE_THE_PROCESS_DIES. In a long-lived server the buffer
 *        drains on its own and nothing needs to wait. In a SERVERLESS
 *        invocation — a route handler, an Inngest step on a managed runtime —
 *        the process can be frozen the instant the response is returned, and a
 *        buffered error is simply lost. The one place that matters is a failure
 *        handler that is the last thing to run, which is why this exists and
 *        why it is bounded: a two-second ceiling, because an error report is
 *        not worth holding a response open for longer than that.
 * WHERE: The Inngest failure handlers.
 */
export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  try {
    const sdk = await loadSdk();
    if (sdk === null) return;
    await sdk.flush(timeoutMs);
  } catch (error) {
    console.error("[observability/sentry] Flush failed:", error);
  }
}
