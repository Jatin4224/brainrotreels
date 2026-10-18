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
 * SOURCE OF TRUTH KEYWORDS: AppSidebar, AppSidebarProps, SidebarUpgradeNudge
 *
 * WHAT:  Barrel for the dashboard sidebar components.
 * WHY:   One import surface for the dashboard layout.
 * WHERE: Imported by src/app/(dashboard)/layout.tsx.
 */

export { AppSidebar } from './app-sidebar'
export type { AppSidebarProps } from './app-sidebar'
export { SidebarUpgradeNudge } from './upgrade-nudge'

