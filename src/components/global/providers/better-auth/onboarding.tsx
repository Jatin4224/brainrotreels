/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: BetterAuthOnboarding
 *
 * WHAT:  The app's own three-step onboarding wizard (details → plan → payment).
 * WHY:   Provider-side entry point behind the <Onboarding /> wrapper, so the
 *        onboarding page never branches on the provider itself.
 * WHERE: Selected by src/components/global/providers/index.tsx when
 *        NEXT_PUBLIC_AUTH_PROVIDER is "better-auth".
 */

import { OnboardingFlow } from "@/app/(onboarding)/onboarding/_components/onboarding-flow";

export function BetterAuthOnboarding() {
  return <OnboardingFlow />;
}
