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
 * SOURCE OF TRUTH KEYWORDS: RENDER_PROVIDER, renderSelector,
 *   assertRenderProviderActive, DEFAULT_RENDER_PROVIDER
 *
 * WHAT:  Resolves which render implementation is selected, once.
 * WHY:   Server-only and selected exactly like the jobs, storage and media
 *        seams — see src/lib/adapters/select-provider.ts for why these cannot
 *        share the auth machinery. No client half exists: a browser never
 *        starts a cloud render, it calls `renders.create` and watches a row.
 * WHERE: Used by ./index.ts and asserted at module scope by ./lambda.
 */

import { createProviderSelector } from '../select-provider'
import { RENDER_PROVIDER_IDS, type RenderProviderId } from './types'

export const DEFAULT_RENDER_PROVIDER: RenderProviderId = 'lambda'

export const renderSelector = createProviderSelector<RenderProviderId>({
  label: 'render',
  envVar: 'RENDER_PROVIDER',
  rawValue: process.env['RENDER_PROVIDER'],
  ids: RENDER_PROVIDER_IDS,
  fallback: DEFAULT_RENDER_PROVIDER,
})

export const RENDER_PROVIDER: RenderProviderId = renderSelector.provider

export function assertRenderProviderActive(id: RenderProviderId): void {
  renderSelector.assertActive(id)
}
