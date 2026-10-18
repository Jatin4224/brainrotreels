/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: ROUTES, AppRouteKey
 *
 * WHAT:  Top-level app destinations that aren't auth pages and aren't a
 *        product feature's `nav.href` — the dashboard home and the onboarding
 *        wizard. The ONE place these path literals live.
 * WHY:   Parallel to AUTH_ROUTES (src/lib/config/auth-routes.ts): routes are
 *        architecture, not branding. The dashboard layout redirects to
 *        ROUTES.onboarding when the user has no org; onboarding redirects to
 *        ROUTES.dashboard when they do; the post-auth landing flow targets
 *        ROUTES.dashboard. Feature pages keep their own path on the RESOURCES
 *        entry's `nav.href`, not here.
 * WHERE: Imported by src/app/(dashboard)/layout.tsx, the onboarding flow, the
 *        root page, and the ONBOARDING_INCOMPLETE handler in
 *        src/trpc/react-provider.tsx.
 */

export const ROUTES = {
  dashboard: '/dashboard',
  onboarding: '/onboarding',
} as const

export type AppRouteKey = keyof typeof ROUTES
