"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: PortalError, RouteError, ui.portal,
 *   ERROR_KEEPS_THE_CHROME, OPERATOR_SEES_THE_REFERENCE
 *
 * WHAT:  The boundary for the internal operator portal.
 *
 * WHY:   OPERATOR_SEES_THE_REFERENCE. Same shape as the dashboard boundary,
 *        and kept separate for the `logger` value alone: portal failures are
 *        an operator's own tooling breaking, not a customer's, and splitting
 *        `ui.portal` from `ui.dashboard` in the log stream is what lets one be
 *        alerted on without the other. The reference code matters more here
 *        than anywhere — the person reading it is the person who can look it
 *        up.
 *
 *        No ContentLayout: the portal layout renders its own chrome, and
 *        `notFound()` in that layout (when the portal is switched off) is
 *        handled by not-found.tsx, never by this file.
 *
 * WHERE: Rendered by Next.js for any throw under src/app/(portal).
 */

import { RouteError } from "@/components/global/route-error";

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <RouteError
          error={error}
          reset={reset}
          logger="ui.portal"
          titleAs="h1"
          description="This portal page could not be loaded. Quote the reference below if it keeps happening."
          action={{ href: "/dashboard", label: "Back to dashboard" }}
        />
      </div>
    </div>
  );
}
