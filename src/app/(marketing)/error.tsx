"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: MarketingError, TWO_DESIGN_FAMILIES,
 *   SOFT_BRUTALISM, brutal-border, brutal-shadow-lg, RouteError, card=false
 *
 * WHAT:  The boundary for the public marketing pages.
 *
 * WHY:   TWO_DESIGN_FAMILIES, and this file is where that separation has to be
 *        honoured rather than assumed. The marketing and auth surfaces are
 *        drawn in the SOFT_BRUTALISM family (`brutal-border`,
 *        `brutal-shadow-*`) while the product is drawn in the tactile family,
 *        and the two skin independently on purpose. StatePanel's default card
 *        is a tactile `Card`, so dropping it on a brutalist page would put the
 *        one surface with the wrong depth language on the page a visitor sees
 *        first. `card={false}` takes the panel's padding and centring and
 *        leaves the chrome to the brutalist wrapper here — which is exactly
 *        what the opt-out exists for.
 *
 * WHERE: Rendered by Next.js for any throw under src/app/(marketing). Renders
 *        inside the marketing layout, so the header and footer survive.
 */

import { RouteError } from "@/components/global/route-error";

export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-24">
      {/* The brutalist panel pattern, matching hero-prompt-card. */}
      <div className="brutal-border brutal-shadow-lg w-full max-w-md rounded-2xl bg-card px-6">
        <RouteError
          error={error}
          reset={reset}
          logger="ui.marketing"
          titleAs="h1"
          card={false}
          description="This page could not be loaded. Trying again usually clears it."
          action={{ href: "/", label: "Go to the homepage" }}
        />
      </div>
    </main>
  );
}
