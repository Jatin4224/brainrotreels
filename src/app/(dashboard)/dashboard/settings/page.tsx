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
 * SOURCE OF TRUTH KEYWORDS: SettingsIndexPage
 *
 * WHAT:  /dashboard/settings — redirects to the first settings sub-page.
 * WHY:   Settings has no landing of its own; billing is the default tab.
 * WHERE: Sub-pages: organization, billing, audit-logs.
 */

import { redirect } from 'next/navigation'

export default function SettingsIndexPage() {
  redirect('/dashboard/settings/billing')
}
