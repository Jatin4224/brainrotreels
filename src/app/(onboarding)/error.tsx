"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: OnboardingError, RouteError, ui.onboarding,
 *   ONBOARDING_HAS_NO_WAY_BACK, ROUTES
 *
 * WHAT:  The boundary for the onboarding wizard.
 *
 * WHY:   ONBOARDING_HAS_NO_WAY_BACK. Every other boundary offers a link out;
 *        this one deliberately offers only the retry. A customer in onboarding
 *        has no organisation yet, and `(dashboard)/layout.tsx` redirects
 *        anyone without one straight back to onboarding — so a "back to
 *        dashboard" button here would be a loop that looks like a dead
 *        product. Retry in place is the only honest action.
 *
 *        Tactile chrome (the default card), not brutalist: onboarding is
 *        inside the product, after the account exists.
 *
 * WHERE: Rendered by Next.js for any throw under src/app/(onboarding).
 */

import { RouteError } from "@/components/global/route-error";

export default function OnboardingError({
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
          logger="ui.onboarding"
          titleAs="h1"
          title="Setup could not continue"
          description="This step could not be loaded. Trying again usually clears it — nothing you have entered is lost."
        />
      </div>
    </main>
  );
}
