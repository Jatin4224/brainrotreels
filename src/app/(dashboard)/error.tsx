"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: DashboardError, ERROR_KEEPS_THE_CHROME,
 *   ContentLayout, RouteError, ui.dashboard
 *
 * WHAT:  The boundary for every page under /dashboard.
 *
 * WHY:   ERROR_KEEPS_THE_CHROME. This renders inside `(dashboard)/layout.tsx`,
 *        so the sidebar, the org switcher and the user menu survive the
 *        failure — which means a broken page is one broken panel the reader
 *        can navigate away from, instead of a dead end they have to use the
 *        back button to escape. It is wrapped in ContentLayout for the same
 *        reason every dashboard page is: the header row and the content share
 *        one left edge, and an error panel that ignored the container would be
 *        the one surface in the app that is not aligned with the rest.
 *
 *        The layout's OWN failures do not arrive here — see
 *        LAYOUT_ERRORS_BUBBLE_PAST_THE_GROUP in src/app/error.tsx.
 *
 * WHERE: Rendered by Next.js for any throw under src/app/(dashboard).
 */

import { ContentLayout } from "@/components/global/page-header";
import { RouteError } from "@/components/global/route-error";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ContentLayout title="Something went wrong">
      <RouteError
        error={error}
        reset={reset}
        logger="ui.dashboard"
        description="This page could not be loaded. Trying again usually clears it — your work is not affected."
        action={{ href: "/dashboard", label: "Back to dashboard" }}
      />
    </ContentLayout>
  );
}
