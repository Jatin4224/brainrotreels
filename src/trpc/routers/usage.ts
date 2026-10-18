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
 * SOURCE OF TRUTH KEYWORDS: usageRouter, AUTO_DERIVED_FROM_RESOURCES
 *
 * WHAT:  Exposes the feature-gate map for the active organization so the UI can
 *        show "you're at limit" affordances, plus the downgrade blockers that
 *        stop a plan change from stranding a tenant over its cap.
 * WHY:   Gate ENFORCEMENT lives in protectedProcedure and is
 *        AUTO_DERIVED_FROM_RESOURCES — every `<resource>.create` whose
 *        registry entry declares a `limit` is auto-checked, and every verb
 *        on a flag-resource is auto-checked. This router exists only to let
 *        the client read the same gate state for rendering — never to
 *        gate-check before another call.
 * WHERE: Consumed by src/components/feature-gate.tsx; mounted by
 *        src/trpc/routers/_app.ts; delegates to src/lib/feature-gate.ts.
 */

import { z } from 'zod'
import { createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import {
  getFeatureGates,
  getDowngradeBlockers,
  getDowngradeBlockerMap,
  getPlanOverages,
} from '@/lib/feature-gate'
import { PLAN_KEYS } from '@/lib/config/plans'

export const usageRouter = createTRPCRouter({
  getFeatureGates: protectedProcedure()
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ input }) => getFeatureGates(input.organizationId)),

  /* DOWNGRADE_REQUIRES_CLEANUP: what the organization would be over if it moved
   * to `targetPlan`. Read-only — the billing screen uses it to explain the
   * refusal and list exactly what has to go first, while
   * billing.upgradeOrganization does the refusing. Returns [] for an upgrade or
   * a sideways move, so the caller never has to know the plan order. */
  getDowngradeBlockers: protectedProcedure()
    .input(
      z.object({
        organizationId: z.string(),
        targetPlan: z.enum(PLAN_KEYS),
      })
    )
    .query(async ({ input }) =>
      getDowngradeBlockers(input.organizationId, input.targetPlan)
    ),

  /* WHOLE_LADDER_IN_ONE_READ: every plan in one round trip, so the plan picker
   * can mark a blocked plan on its own card instead of opening a loading gap per
   * selection — see the note in feature-gate.ts. */
  getDowngradeBlockerMap: protectedProcedure()
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ input }) => getDowngradeBlockerMap(input.organizationId)),

  /* OVER_PLAN_STATE: what the org is over on the plan it is ALREADY on. Read by
   * every dashboard page through the banner, so it stays on the base procedure —
   * being over the cap affects everyone in the org, not only whoever can see
   * billing. Returns [] in the normal case. */
  getPlanOverages: protectedProcedure()
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ input }) => getPlanOverages(input.organizationId)),
})
