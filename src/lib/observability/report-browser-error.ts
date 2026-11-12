/**
 * SOURCE OF TRUTH KEYWORDS: reportBrowserError, BrowserErrorContext,
 *   DIGEST_IS_THE_CORRELATION_ID, NEVER_THROW_FROM_THE_REPORTER,
 *   NO_SERVER_ONLY_HERE, RouteError, ONE_LOGGER
 *
 * WHAT:  Records an error that an error boundary caught in the browser, and
 *        returns the id the reader can quote.
 *
 * WHY:   NO_SERVER_ONLY_HERE, and that is the entire reason this file exists
 *        separately. `@/lib/observability` (the barrel) and `sentry.ts` both
 *        start with `import "server-only"`, so an error boundary — which is a
 *        client component by definition — cannot reach `captureError`. Without
 *        this module the boundaries would each invent their own `console.error`
 *        and ONE_LOGGER would be broken by the components whose only job is to
 *        report. It composes `logError` and `newRequestId`, which are the two
 *        modules in the folder with no server dependency; `request-id.ts` is
 *        already documented as deliberately importable on its own.
 *
 *        DIGEST_IS_THE_CORRELATION_ID. When the throw happened on the server,
 *        Next.js hides the message and hands the client an `error.digest` —
 *        the same hash it logged server-side and the same one
 *        `instrumentation.ts`'s `onRequestError` reported to Sentry. Using it
 *        as the `requestId` is what joins the line this function writes to the
 *        report that already exists, instead of minting a second unrelated id
 *        for one failure. A purely client-side throw has no digest, so it gets
 *        a fresh id.
 *
 *        NEVER_THROW_FROM_THE_REPORTER, matching sentry.ts: this runs inside a
 *        component that is already rendering because something failed, and a
 *        reporter that throws there takes out the error boundary itself and
 *        gives the reader a blank page.
 *
 *        It does NOT send to Sentry. There is no `instrumentation-client.ts`
 *        in this app, so the browser SDK is never initialised and a
 *        `captureException` call here would be silently dropped — see the
 *        boundaries' own note. Server-side throws are already reported through
 *        `onRequestError`; only a client-side render throw goes unreported,
 *        and adding the browser SDK is a bundle decision, not this module's.
 *
 * WHERE: src/components/global/route-error, which every error.tsx composes.
 */

import { logError } from "./logger";
import { newRequestId } from "./request-id";

export interface BrowserErrorContext {
  /** The subsystem, matching the logger's `logger` field — e.g. `ui.dashboard`. */
  logger: string;
  /** A short stable event name, not the error's message. */
  event: string;
  /** Next's server-error hash, when the throw happened on the server. */
  digest?: string | undefined;
  extra?: Record<string, string | number | boolean | null> | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: reportBrowserError, DIGEST_IS_THE_CORRELATION_ID
 *
 * WHAT:  Writes one structured error line and returns its correlation id.
 * WHY:   The id is RETURNED rather than only logged so a caller that wants to
 *        show it does not have to re-derive it and risk displaying a different
 *        string from the one in the log. RouteError deliberately displays only
 *        a server `digest` (see REFERENCE_ONLY_WHEN_IT_IS_LOOKUPABLE) and so
 *        ignores the return value — it is kept for the next caller, and
 *        because a reporter that silently discards its own correlation key is
 *        the thing you need when debugging the reporter.
 * WHERE: The `useEffect` in RouteError.
 */
export function reportBrowserError(
  error: unknown,
  context: BrowserErrorContext,
): string {
  const requestId = context.digest ?? newRequestId();

  try {
    logError({
      logger: context.logger,
      event: context.event,
      requestId,
      error,
      ...(context.extra !== undefined ? { data: context.extra } : {}),
    });
  } catch {
    /* NEVER_THROW_FROM_THE_REPORTER — the id is still worth returning. */
  }

  return requestId;
}
