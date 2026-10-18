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
 * SOURCE OF TRUTH KEYWORDS: authClient
 *
 * WHAT:  Better Auth browser client wired with the same plugin set as the
 *        server (organization, twoFactor, admin, lastLoginMethod).
 * WHY:   Client plugins MUST mirror server plugins so type inference and
 *        runtime calls line up; baseURL uses window.location.origin so one
 *        bundle ships unchanged to localhost and any production domain.
 * WHERE: Imported by every client component performing auth/org actions;
 *        shares ac / roles with src/lib/better-auth/access-control.ts.
 */

import { createAuthClient } from 'better-auth/client'
import {
  organizationClient,
  twoFactorClient,
  adminClient,
  lastLoginMethodClient,
} from 'better-auth/client/plugins'

import { ac, roles } from '@/lib/better-auth/access-control'

/* baseURL uses the current origin so the same bundle works on localhost and
 * any production domain without rebuilding. Client plugins must mirror the
 * server side (auth.ts). */
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : '',
  plugins: [
    organizationClient({
      ac,
      roles,
      dynamicAccessControl: { enabled: true },
    }),
    twoFactorClient(),
    adminClient(),
    lastLoginMethodClient(),
  ],
})
