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
 * SOURCE OF TRUTH KEYWORDS: BetterAuthOrganizationAdvanced, PROVIDER_ONLY_SECTION
 *
 * WHAT:  Nothing. Better Auth has no organization features beyond what the app's
 *        own settings screen already covers.
 * WHY:   PROVIDER_ONLY_SECTION — the surface exists on both sides of the alias so
 *        the settings page can render it unconditionally instead of branching on
 *        the provider. Returning null is the honest answer here, and it keeps the
 *        page free of a capability check that would only ever have one consumer.
 * WHERE: Resolved through @providers-active by
 *        src/components/global/providers/server.tsx.
 */

export function BetterAuthOrganizationAdvanced() {
  return null
}
