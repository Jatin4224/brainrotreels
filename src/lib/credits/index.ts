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
 * SOURCE OF TRUTH KEYWORDS: credits barrel, estimate, estimateRenderCost,
 *   CREDIT_RATES, ESTIMATE_IS_PURE
 *
 * WHAT:  Public surface of the credit-pricing module.
 * WHY:   Everything here is PURE — no Prisma, no storage, no `server-only`.
 *        That is the property to preserve when adding to this folder: it is
 *        what lets the cost on a BUTTON and the amount held on the SERVER come
 *        from the same function, which is the only way the two can be
 *        guaranteed equal. Anything that needs the database belongs in
 *        src/services/credits.service.ts instead, which is server-only and
 *        imports this.
 * WHERE: Imported by src/trpc/routers/, src/inngest/functions/ and the credits
 *        UI.
 */

export { CREDIT_RATES, estimate, estimateRenderCost } from './estimate'
export type { EstimateInput } from './estimate'
