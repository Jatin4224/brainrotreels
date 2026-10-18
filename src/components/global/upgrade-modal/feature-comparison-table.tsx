/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: FeatureComparisonTable, getFeatureCategories,
 *   getPlanFeatureRows, PLAN_FEATURE_COPY, highlightResource, UpgradeContent
 *
 * WHAT:  The plan × feature matrix under the pricing cards, grouped by category,
 *        with the resource that triggered the upgrade highlighted.
 * WHY:   Cards show the headline; this answers "what exactly do I get". Both
 *        read the SAME registry pass (getPlanFeatureRows per column), so the
 *        table can never contradict a card, and a resource added to RESOURCES
 *        appears in both with no edit here — this file names no resource and no
 *        plan.
 *        `highlightResource` is the enhancement that makes the table answer the
 *        question the user actually arrived with: they hit a wall on ONE
 *        feature, and that row is marked so the comparison starts where their
 *        problem is instead of making them hunt for it.
 *        Standalone and exported on its own because a public pricing page is the
 *        obvious next consumer, and it needs no modal to render.
 * WHERE: <UpgradeContent />; safe to drop onto any pricing surface.
 */

import { CheckIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PLANS, type PlanKey } from '@/lib/config'
import { BRANDING } from '@/lib/config'
import {
  getFeatureCategories,
  getPlanFeatureRows,
  type PlanFeatureRow,
  type ResourceKey,
} from '@/lib/resources'

export interface FeatureComparisonTableProps {
  /** Plan columns, in order. */
  planKeys: readonly PlanKey[]
  /** The resource whose gate opened the modal, if any — its row is marked. */
  highlightResource?: ResourceKey | undefined
}

export function FeatureComparisonTable({
  planKeys,
  highlightResource,
}: FeatureComparisonTableProps) {
  const categories = getFeatureCategories()
  /* ONE registry read per column, indexed by resource so each of the many cells
   * below is a map lookup rather than a re-scan of the plan's rows. */
  const rowsByPlan = new Map<PlanKey, Map<ResourceKey, PlanFeatureRow>>(
    planKeys.map((plan) => [
      plan,
      new Map(getPlanFeatureRows(plan).map((row) => [row.resource, row])),
    ])
  )
  /* Row labels are plan-independent, so they come from whichever column is
   * first — the name lives on the registry entry, not on the plan. */
  const labels = rowsByPlan.get(planKeys[0] ?? 'free')

  const gridStyle = {
    gridTemplateColumns: `minmax(180px, 1.5fr) repeat(${planKeys.length}, 1fr)`,
  }

  return (
    <div className="w-full">
      <h3 className="mb-10 text-center text-2xl font-bold tracking-tight sm:text-3xl">
        {BRANDING.upgradeModal.comparisonTitle}
      </h3>

      {/* Horizontal scroll below the min width instead of squeezing columns —
          a comparison you cannot read is worse than one you have to scroll. */}
      <div className="overflow-x-auto">
        <div className="min-w-[600px] space-y-10">
          {categories.map((category) => (
            <div key={category.name}>
              <div className="grid items-end" style={gridStyle}>
                <span className="pb-2 text-sm font-semibold text-foreground">
                  {category.name}
                </span>
                {planKeys.map((plan) => (
                  <div key={plan} className="text-center">
                    <span className="text-sm font-semibold">{PLANS[plan].name}</span>
                    <div className="mt-2 h-0.5 bg-border" />
                  </div>
                ))}
              </div>

              {category.resources.map((resource) => {
                const isHighlighted = resource === highlightResource
                return (
                  <div
                    key={resource}
                    className={cn(
                      'grid items-center border-b border-border/30',
                      isHighlighted && 'bg-primary/5'
                    )}
                    style={gridStyle}
                  >
                    <span
                      className={cn(
                        'py-3.5 text-sm text-foreground/80',
                        isHighlighted && 'pl-2 font-medium text-foreground'
                      )}
                    >
                      {labels?.get(resource)?.name ?? resource}
                    </span>

                    {planKeys.map((plan) => {
                      const row = rowsByPlan.get(plan)?.get(resource)
                      if (!row) {
                        return (
                          <div key={plan} className="py-3.5 text-center text-sm text-muted-foreground">
                            -
                          </div>
                        )
                      }
                      return (
                        <div key={plan} className="py-3.5 text-center text-sm">
                          {row.kind === 'flag' ? (
                            row.isIncluded ? (
                              <CheckIcon className="mx-auto size-4 text-foreground" />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )
                          ) : row.isIncluded ? (
                            <span
                              className={cn(
                                'font-medium',
                                row.isUnlimited ? 'text-success' : 'text-foreground'
                              )}
                            >
                              {row.amount}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
