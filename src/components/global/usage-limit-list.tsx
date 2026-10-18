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
 * SOURCE OF TRUTH KEYWORDS: UsageLimitList, DowngradeBlocker, OVER_PLAN_STATE,
 *   DOWNGRADE_REQUIRES_CLEANUP, PlanOverageBanner, ChangePlanDialog
 *
 * WHAT:  Renders a DowngradeBlocker[] — the over-cap rows a tenant must reduce,
 *        plus the features a plan would no longer include.
 * WHY:   The same list is shown in two places for two reasons: before a
 *        downgrade ("you cannot land here yet") and after one ("you are here
 *        now"). Identical rows, identical wording, one implementation — a second
 *        copy would drift the moment either screen is touched.
 *        THE TWO SECTIONS COME FROM THE DATA, not from a prop. Overages contain
 *        only limit rows, so the feature-loss block simply does not render for
 *        the banner — no flag to pass, no way to get the combination wrong.
 *        Feature loss is deliberately styled as quiet disclosure rather than a
 *        warning: it cannot be resolved by deleting anything, so alarming
 *        treatment would read as a dark pattern on a downgrade screen.
 *        Names no resource — every string comes from the registry via the
 *        blocker rows.
 * WHERE: Used by <ChangePlanDialog /> (billing screen) and <PlanOverageBanner />
 *        (dashboard shell).
 */

import { XIcon } from 'lucide-react'

import type { DowngradeBlocker } from '@/lib/feature-gate'
import { Badge } from '@/components/ui/badge'

export function UsageLimitList({
  blockers,
  /* Only differs between the two callers: before a downgrade the loss is
   * additional to what must be reduced, after one there is nothing else. */
  featureLossLabel,
}: {
  blockers: DowngradeBlocker[]
  featureLossLabel?: string
}) {
  const mustResolve = blockers.filter((blocker) => !blocker.isFeatureLoss)
  const willLose = blockers.filter((blocker) => blocker.isFeatureLoss)

  return (
    <>
      {mustResolve.length > 0 ? (
        <ul className="space-y-3">
          {mustResolve.map((blocker) => (
            <li
              key={blocker.resource}
              className="flex items-start justify-between gap-4 rounded-md border border-border p-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">{blocker.name}</p>
                <p className="text-sm text-muted-foreground">
                  Using {blocker.current} — this plan allows {blocker.allowed}.
                </p>
              </div>
              <Badge variant="destructive" className="shrink-0">
                Remove {blocker.excess}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {willLose.length > 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm font-medium">
            {featureLossLabel ??
              (mustResolve.length > 0 ? "You'd also lose" : 'No longer included')}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {willLose.map((blocker) => (
              <li
                key={blocker.resource}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <XIcon className="size-3.5 shrink-0" />
                <span className="truncate">{blocker.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}
