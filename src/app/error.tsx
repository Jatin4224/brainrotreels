"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AppError, ERROR_BOUNDARY_CHAIN,
 *   LAYOUT_ERRORS_BUBBLE_PAST_THE_GROUP, RouteError, global-error
 *
 * WHAT:  The app-wide error boundary — everything inside the root layout that
 *        no closer boundary caught.
 *
 * WHY:   LAYOUT_ERRORS_BUBBLE_PAST_THE_GROUP, which is the reason this exists
 *        alongside the per-group boundaries. An `error.tsx` is rendered INSIDE
 *        its segment's layout, so it cannot catch that layout's own throw —
 *        and `(dashboard)/layout.tsx` is the heaviest server component in the
 *        app (session, org resolution, permission gating, five prefetches).
 *        When it fails, `(dashboard)/error.tsx` is not reachable and the error
 *        lands here instead. Without this file it would land on
 *        `global-error.tsx`, which throws away the theme provider and the
 *        fonts to report a failure that never touched the root layout.
 *
 *        The chain, innermost first: a segment's own error.tsx → the route
 *        group's → this one → global-error.tsx.
 *
 * WHERE: Rendered by Next.js. Composes RouteError like every other boundary.
 */

import { RouteError } from "@/components/global/route-error";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <RouteError
          error={error}
          reset={reset}
          logger="ui.app"
          titleAs="h1"
          action={{ href: "/", label: "Go to the homepage" }}
        />
      </div>
    </main>
  );
}
