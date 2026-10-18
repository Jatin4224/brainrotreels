/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: setActiveOrganization,
 *   PROVIDER_NEUTRAL_CLIENT_ACTIONS, PROVIDER_ALIAS
 *
 * WHAT:  The one client-side auth action the app itself has to trigger —
 *        switching the active organization — resolved to the selected provider.
 * WHY:   PROVIDER_NEUTRAL_CLIENT_ACTIONS — everything else the client needs
 *        (profile, memberships, gates) already arrives through tRPC, which is
 *        provider-neutral because it runs on the server adapter. These two are
 *        the exception: they mutate BROWSER auth state, so they must run in the
 *        provider's client SDK. Routing them through here means flows like
 *        onboarding and invitation-accept never import a provider directly.
 *        PROVIDER_ALIAS: the implementation is resolved by the
 *        `@providers-active-actions` build-time alias (next.config.ts), NOT by a
 *        runtime branch. A branch here still pulled EVERY provider's client SDK
 *        into the bundle — measured at ~46KB of dead code for a provider the
 *        build did not select — because Next's module graph is static. The alias
 *        means the other provider's module never enters the graph.
 * WHERE: Called by the onboarding flow and the accept-invitation screen.
 */

import { activeSetOrganization } from '@providers-active-actions'

/**
 * SOURCE OF TRUTH KEYWORDS: setActiveOrganization
 *
 * WHAT:  Makes an organization the caller's active tenant.
 * WHY:   Both providers reissue the session on switch, so the caller must do a
 *        full navigation afterwards for server components to re-resolve — this
 *        function deliberately does NOT navigate, leaving that to the caller
 *        which knows where the user should land.
 * WHERE: Onboarding completion and invitation acceptance.
 */
export async function setActiveOrganization(params: {
  organizationId: string
  organizationSlug?: string
}): Promise<void> {
  await activeSetOrganization(params)
}

