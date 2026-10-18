/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: getServerSession, PROVIDER_NEUTRAL_SESSION
 *
 * WHAT:  The provider-neutral "who is signed in" read for server components,
 *        layouts, and route handlers.
 * WHY:   PROVIDER_NEUTRAL_SESSION — layouts previously imported Better Auth's
 *        getCachedSession directly, which hard-wired every auth gate in the app
 *        to one provider. Routing them through the adapter means a layout's
 *        redirect logic is written once and survives a provider switch.
 *        Request-scoped `cache()` keeps this to one provider round-trip per
 *        request no matter how many layouts and components ask.
 * WHERE: Used by src/app/(dashboard)/layout.tsx, the onboarding page, and the
 *        portal layout. Implementations live in
 *        src/lib/adapters/<provider>/index.ts.
 */

import { cache } from 'react'

import { getAuthAdapter } from './index'
import type { AdapterSession } from './types'

/**
 * SOURCE OF TRUTH KEYWORDS: getServerSession
 *
 * WHAT:  The current request's session, or null when signed out.
 * WHERE: Server components, layouts, and route handlers.
 */
export const getServerSession = cache(async (): Promise<AdapterSession | null> => {
  const adapter = await getAuthAdapter()
  return adapter.identity.getSession()
})
