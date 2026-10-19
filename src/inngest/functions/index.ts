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
 * SOURCE OF TRUTH KEYWORDS: INNGEST_FUNCTIONS, workflow registry, serve
 *
 * WHAT:  Every workflow this app serves, in one list.
 * WHY:   The serve route needs an explicit array — a function missing from it
 *        is silently never invoked, and the symptom is an event that vanishes
 *        rather than an error. One registry makes that omission visible in
 *        review. Add a workflow here in the same change that defines it.
 * WHERE: Consumed by src/app/api/inngest/route.ts.
 */

import { assetIngestFunction } from './asset-ingest'
import { helloFunction } from './hello'
import { usageResetFunction } from './usage-reset'

export const INNGEST_FUNCTIONS = [helloFunction, usageResetFunction, assetIngestFunction]
