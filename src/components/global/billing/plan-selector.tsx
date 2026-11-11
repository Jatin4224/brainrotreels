/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: PlanSelector, BillingIntervalToggle, PLAN_ICONS,
 * DowngradeBlockerMap, DOWNGRADE_REQUIRES_CLEANUP
 *
 * WHAT: Plan picker (icon + name + trial/popular badges) and a monthly/yearly
 * toggle, driven by PLANS / PLAN_ORDER. Optionally marks the plans an
 * organization cannot move to yet.
 * WHY: Reused by onboarding (with the free plan) and the billing upgrade UI
 * (paid only). Concrete prices aren't hard-coded (they live in Stripe),
 * so the template stays account-agnostic — the cards show identity +
 * trial length, not amounts.
 * `blockers` is OPTIONAL so onboarding — where a brand-new org can be over
 * nothing — passes nothing and behaves exactly as before. Where it IS
 * passed, a blocked plan is marked on its own CARD rather than only being
 * refused after the click, so the state is visible before the user
 * commits to it. The card stays selectable: picking it is how the caller
 * gets to show WHAT has to come down.
 * Reads the shared DowngradeBlockerMap rather than a bespoke prop shape,
 * so nothing here has to know how a blocker is computed, and this file
 * names no resource.
 * WHERE: Onboarding plan step + <ChangePlanDialog />.
 */

import * as React from "react";
import {
  CheckIcon,
  PackageIcon,
  RocketIcon,
  ZapIcon,
  Building2Icon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";

import {
  PLANS,
  PLAN_ORDER,
  type PlanKey,
  type BillingInterval,
} from "@/lib/config";
import { useRovingRadioGroup } from "@/hooks/use-roving-radiogroup";
import type { DowngradeBlockerMap } from "@/lib/feature-gate";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/* Maps PLANS[plan].icon strings to lucide components. */
const PLAN_ICONS: Record<string, LucideIcon> = {
  Package: PackageIcon,
  Rocket: RocketIcon,
  Zap: ZapIcon,
  Building: Building2Icon,
  ShieldCheck: ShieldCheckIcon,
};

const BILLING_INTERVALS = ["monthly", "yearly"] as const;

export function BillingIntervalToggle({
  interval,
  onIntervalChange,
}: {
  interval: BillingInterval;
  onIntervalChange: (interval: BillingInterval) => void;
}) {
  /* RADIOGROUP_NOT_A_LIST_OF_BUTTONS. These were plain buttons, so the
   * choice was conveyed by border colour alone — nothing announced a selected
   * state, and the `.tactile-control` on them was dead, because that utility
   * only styles an element that declares one. Giving them the real semantics
   * is what makes both the screen reader and the raised look work. */
  const roving = useRovingRadioGroup({
    ids: BILLING_INTERVALS,
    selectedId: interval,
  });

  return (
    <div
      role="radiogroup"
      aria-label="Billing interval"
      onKeyDown={roving.handleKeyDown}
      className="grid grid-cols-2 gap-3"
    >
      {BILLING_INTERVALS.map((value) => {
        const selected = interval === value;
        return (
          <button
            key={value}
            ref={roving.registerRef(value)}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={roving.activeId === value ? 0 : -1}
            onClick={() => onIntervalChange(value)}
            className={cn(
              "tactile-control rounded-lg border-2 border-muted p-3 text-sm font-semibold capitalize transition-all hover:bg-muted/50 outline-none focus-ring",
              selected && "border-primary",
            )}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}

export function PlanSelector({
  selectedPlan,
  onPlanChange,
  includeFree = false,
  blockers,
}: {
  selectedPlan: PlanKey;
  onPlanChange: (plan: PlanKey) => void;
  includeFree?: boolean;
  /** Omit where nothing can be blocked (onboarding). */
  blockers?: DowngradeBlockerMap;
}) {
  const plans = React.useMemo(
    () =>
      PLAN_ORDER.filter(
        (plan) => PLANS[plan].showPlan && (includeFree || plan !== "free"),
      ),
    [includeFree],
  );

  /* Same reasoning as the interval toggle above. */
  const roving = useRovingRadioGroup({ ids: plans, selectedId: selectedPlan });

  return (
    <div
      role="radiogroup"
      aria-label="Plan"
      onKeyDown={roving.handleKeyDown}
      className="flex flex-col gap-4"
    >
      {plans.map((plan) => {
        const def = PLANS[plan];
        const isSelected = plan === selectedPlan;
        const Icon = PLAN_ICONS[def.icon] ?? PackageIcon;
        /* Only over-cap usage blocks; losing a flag feature is a disclosure the
         * caller renders, not a reason this plan is unreachable. */
        const blocked = (blockers?.[plan] ?? []).some(
          (blocker) => !blocker.isFeatureLoss,
        );
        return (
          <button
            key={plan}
            ref={roving.registerRef(plan)}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={roving.activeId === plan ? 0 : -1}
            onClick={() => onPlanChange(plan)}
            className={cn(
              "tactile-control relative flex items-center gap-4 rounded-lg border-2 border-muted p-4 text-left transition-all hover:bg-muted/50 outline-none focus-ring",
              isSelected && "border-border bg-muted",
            )}
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Icon className="size-5 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{def.name}</span>
                {blocked ? (
                  <Badge variant="destructive" className="text-xs">
                    Reduce usage first
                  </Badge>
                ) : def.trialDays > 0 ? (
                  <Badge variant="secondary" className="text-xs">
                    {def.trialDays}-day trial
                  </Badge>
                ) : plan === "free" ? (
                  <Badge variant="secondary" className="text-xs">
                    No card required
                  </Badge>
                ) : null}
              </div>
            </div>
            {isSelected ? (
              <CheckIcon className="size-5 shrink-0 text-primary" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
