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
 * SOURCE OF TRUTH KEYWORDS: UsageMeter, UsageMeterProps, RESOURCE_AGNOSTIC,
 *   useFeatureGate, formatBytes, UNLIMITED_HAS_NO_BAR, NEARLY_FULL_THRESHOLD
 *
 * WHAT:  "1.4 GB of 5 GB used" with a bar, for any registry resource that
 *        declares a `limit`.
 * WHY:   RESOURCE_AGNOSTIC — it takes a `ResourceKey` and reads everything else
 *        from the gate map: the name, the numbers and the upgrade sentence all
 *        come from the registry, so this component names no resource and works
 *        for projects, seats or API calls the day one of those screens wants a
 *        meter. Phase 02 needs it for storage; writing a storage-specific bar
 *        would guarantee a second, slightly different one later.
 *
 *        UNLIMITED_HAS_NO_BAR: an enterprise workspace gets the word
 *        "Unlimited" and no track. A bar implies a ceiling, and drawing one at
 *        0% for a plan with no cap is the kind of detail that makes an
 *        expensive plan feel broken.
 *
 *        `unit` decides the formatter rather than the resource key, so the
 *        meter stays resource-agnostic: a byte-denominated limit renders
 *        through the same formatBytes the pricing copy uses (so the two numbers
 *        on screen agree exactly), and everything else renders as a count.
 * WHERE: /dashboard/media renders it for `storage`. Available to the billing
 *        and dashboard screens for any limit.
 */

import { cn } from '@/lib/utils'
import { formatBytes, RESOURCES, type LimitResourceKey } from '@/lib/resources'
import { useFeatureGate } from '@/components/feature-gate'
import { Skeleton } from '@/components/ui/skeleton'

/** Where the bar turns to the warning colour — early enough to act on. */
const NEARLY_FULL_THRESHOLD = 0.85

export interface UsageMeterProps {
  /** Must be a resource declaring a `limit`; a flag has nothing to meter. */
  resource: LimitResourceKey
  /** Hides the resource's name, for a surface that already titles the section. */
  hideLabel?: boolean
  className?: string
}

export function UsageMeter({ resource, hideLabel = false, className }: UsageMeterProps) {
  const gate = useFeatureGate(resource)

  if (gate === null) return <Skeleton className={cn('h-10 w-full', className)} />

  /* Optional-chained: `LimitResourceKey` guarantees the entry HAS a limit at
   * runtime, but RESOURCES is read through the widened ResourceDefinition, so
   * the type still says it might not. Chaining is honest and costs a character;
   * an assertion here would be a bypass for nothing. */
  const isBytes = RESOURCES[resource].limit?.unit === 'bytes'
  const format = (value: number) => (isBytes ? formatBytes(value) : value.toLocaleString('en-US'))

  const ratio =
    gate.isUnlimited || gate.limit === null || gate.limit <= 0
      ? 0
      : Math.min(1, gate.usage / gate.limit)

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        {hideLabel ? <span /> : <p className="text-sm font-medium">{gate.featureName}</p>}
        <p className="text-xs text-muted-foreground">
          {gate.isUnlimited || gate.limit === null
            ? `${format(gate.usage)} used · Unlimited`
            : `${format(gate.usage)} of ${format(gate.limit)} used`}
        </p>
      </div>

      {/* UNLIMITED_HAS_NO_BAR — see the file header. */}
      {gate.isUnlimited || gate.limit === null ? null : (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${gate.featureName} used`}
        >
          <div
            className={cn(
              'h-full transition-[width]',
              /* At the cap the bar is destructive; approaching it, the warning
                 colour. Both are theme tokens — never a hex. */
              gate.atLimit
                ? 'bg-destructive'
                : ratio >= NEARLY_FULL_THRESHOLD
                  ? 'bg-primary/70'
                  : 'bg-primary'
            )}
            style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 2 : 0)}%` }}
          />
        </div>
      )}

      {gate.atLimit ? (
        <p className="text-xs text-destructive">{gate.upgradeMessage}</p>
      ) : null}
    </div>
  )
}
