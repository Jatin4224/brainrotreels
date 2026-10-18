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
 * SOURCE OF TRUTH KEYWORDS: REGISTRATION_OPEN
 *
 * WHAT:  Boolean indicating whether self-serve sign-up is allowed.
 * WHY:   Set NEXT_PUBLIC_REGISTRATION_OPEN=false to put the app in
 *        invitation-only mode; the auth.ts databaseHooks.user.create.before
 *        hook enforces this server-side as a last line of defense.
 * WHERE: Read by auth.ts (server gate) and the sign-up UI (hide form).
 */
export const REGISTRATION_OPEN =
  process.env['NEXT_PUBLIC_REGISTRATION_OPEN'] !== 'false'
