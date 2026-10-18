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
 * SOURCE OF TRUTH KEYWORDS: router, baseProcedure, authProcedure,
 *   protectedProcedure
 *
 * WHAT:  Barrel that re-exports the router builder and procedure factories
 *        from `./protected`.
 * WHY:   Lets src/trpc/init.ts (and anyone else) depend on `@/trpc/procedures`
 *        without reaching into the implementation file directly.
 * WHERE: Imported by src/trpc/init.ts; sourced from src/trpc/procedures/protected.ts.
 */

export {
  router,
  baseProcedure,
  authProcedure,
  protectedProcedure,
} from './protected'
