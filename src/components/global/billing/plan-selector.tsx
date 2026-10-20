/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: PlanSelector, BillingIntervalToggle, PLAN_ICONS,
 *   DowngradeBlockerMap, DOWNGRADE_REQUIRES_CLEANUP
 *
 * WHAT:  Plan picker (icon + name + trial/popular badges) and a monthly/yearly
 *        toggle, driven by PLANS / PLAN_ORDER. Optionally marks the plans an
 *        organization cannot move to yet.
 * WHY:   Reused by onboarding (with the free plan) and the billing upgrade UI
 *        (paid only). Concrete prices aren't hard-coded (they live in Stripe),
 *        so the template stays account-agnostic — the cards show identity +
 *        trial length, not amounts.
 *        `blockers` is OPTIONAL so onboarding — where a brand-new org can be over
 *        nothing — passes nothing and behaves exactly as before. Where it IS
 *        passed, a blocked plan is marked on its own CARD rather than only being
 *        refused after the click, so the state is visible before the user
 *        commits to it. The card stays selectable: picking it is how the caller
 *        gets to show WHAT has to come down.
 *        Reads the shared DowngradeBlockerMap rather than a bespoke prop shape,
 *        so nothing here has to know how a blocker is computed, and this file
 *        names no resource.
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

export function BillingIntervalToggle({
  interval,
  onIntervalChange,
}: {
  interval: BillingInterval;
  onIntervalChange: (interval: BillingInterval) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["monthly", "yearly"] as const).map((value) => {
        const selected = interval === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onIntervalChange(value)}
            className={cn(
              "rounded-lg border-2 border-muted p-3 text-sm font-semibold capitalize transition-all hover:bg-muted/50",
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
  const plans = PLAN_ORDER.filter(
    (plan) => PLANS[plan].showPlan && (includeFree || plan !== "free"),
  );

  return (
    <div className="flex flex-col gap-4">
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
            type="button"
            onClick={() => onPlanChange(plan)}
            className={cn(
              "relative flex items-center gap-4 rounded-lg border-2 border-muted p-4 text-left transition-all hover:bg-muted/50",
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
