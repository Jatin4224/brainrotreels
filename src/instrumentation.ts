/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: register, onRequestError, INSTRUMENTATION_IS_OPTIONAL,
 *   SENTRY_INIT_ONCE, LAZY_SENTRY
 *
 * WHAT:  Next.js's server instrumentation hook — initialises Sentry once per
 *        runtime, and reports the errors Next catches before any of our own
 *        code sees them.
 *
 * WHY:   INSTRUMENTATION_IS_OPTIONAL. Both exports do nothing at all when no
 *        DSN is configured, which is the same posture as Resend, R2 and the
 *        rate limiter: a fresh clone with no third-party accounts runs
 *        unchanged. The import of the SDK is INSIDE the guard, so an
 *        unconfigured deployment never evaluates it.
 *
 *        SENTRY_INIT_ONCE: `register` is Next's one guaranteed
 *        once-per-runtime entry point, which is the only correct place for
 *        `Sentry.init`. Calling init from a route or a procedure would
 *        reinitialise per invocation on a serverless runtime and lose the
 *        breadcrumbs that make a report readable.
 *
 *        `onRequestError` catches what our own error paths cannot: an exception
 *        in a Server Component, in a layout, or in rendering itself. Those
 *        never reach the tRPC procedure factory, so without this hook the
 *        most user-visible class of failure — a page that will not render —
 *        would be the one class that was never reported.
 *
 *        The runtime check matters: this file is evaluated in both the Node
 *        and the Edge runtimes, and the SDK's entry points differ. Importing
 *        the Node build into the edge runtime fails at module evaluation, which
 *        would take down the proxy.
 *
 *        NO_PII_OPTION_IS_SET, and that is a deliberate non-decision: the SDK
 *        v11 removed `sendDefaultPii`, so there is nothing to turn off here.
 *        What reaches Sentry is what `captureError` attaches — a user ID, an
 *        organization ID and named extras, never a header, a cookie or a
 *        request body. Keeping the attachment explicit at the call site rather
 *        than relying on a global switch is what makes that reviewable.
 * WHERE: Loaded automatically by Next.js. Reads configuration through
 *        src/lib/observability/sentry.ts so the DSN and sample rate are
 *        resolved in one place.
 */

import {
  isSentryConfigured,
  sentryTracesSampleRate,
} from "@/lib/observability/sentry";

export async function register(): Promise<void> {
  if (!isSentryConfigured()) return;

  const dsn = process.env["NEXT_PUBLIC_SENTRY_DSN"];
  const tracesSampleRate = sentryTracesSampleRate();

  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn,
      tracesSampleRate,
      /* The deploy this report came from. Without it, "did our fix work" is
       * unanswerable from the report alone. Vercel supplies the SHA; a
       * self-hosted deploy sets it or gets `unknown`. */
      release: process.env["VERCEL_GIT_COMMIT_SHA"] ?? undefined,
      environment: process.env.NODE_ENV,
    });
    return;
  }

  if (process.env["NEXT_RUNTIME"] === "edge") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn,
      tracesSampleRate,
      release: process.env["VERCEL_GIT_COMMIT_SHA"] ?? undefined,
      environment: process.env.NODE_ENV,
    });
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: onRequestError, RENDER_ERRORS_REACH_NOTHING_ELSE
 *
 * WHAT:  Reports an error Next.js caught while handling a request.
 * WHY:   RENDER_ERRORS_REACH_NOTHING_ELSE — see the file header. This is the
 *        only path by which a Server Component failure is reported.
 * WHERE: Called by Next.js. Signature is Next's own.
 */
export async function onRequestError(
  ...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>
): Promise<void> {
  if (!isSentryConfigured()) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
}
