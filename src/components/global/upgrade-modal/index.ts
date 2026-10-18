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
 * SOURCE OF TRUTH KEYWORDS: UpgradeModalProvider, useUpgradeModal, UpgradeModal,
 *   UpgradeContent, FeatureComparisonTable, PricingCard, useUpgradeNudge,
 *   getYearlySavings, GLOBAL_UPGRADE_SURFACE
 *
 * WHAT:  Barrel for the app-wide upgrade surface.
 * WHY:   Consumers need exactly one of three things — the provider (mounted once
 *        at the root), the hook (to open it), or the standalone pricing pieces
 *        (for a page that shows plans without a modal), or the nudge hook that
 *        answers "what should we offer this org right now". One import path
 *        keeps the internal file split free to change.
 * WHERE: src/app/layout.tsx mounts the provider; <FeatureGate /> and the billing
 *        settings tab use the hook.
 */

export { UpgradeModalProvider, useUpgradeModal } from './upgrade-modal-provider'
export type { UpgradeModalRequest } from './upgrade-modal-provider'
export { UpgradeModal } from './upgrade-modal'
export type { UpgradeModalProps } from './upgrade-modal'
export { UpgradeContent } from './upgrade-content'
export type { UpgradeContentProps } from './upgrade-content'
export { FeatureComparisonTable } from './feature-comparison-table'
export { PricingCard } from './pricing-card'
export { useUpgradeNudge } from './use-upgrade-nudge'
export type { UpgradeNudge, UpgradeNudgeReason } from './use-upgrade-nudge'
export { calculateSavings, getYearlySavings } from './pricing-math'
export type { YearlySavings } from './pricing-math'
