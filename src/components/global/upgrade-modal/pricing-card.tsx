/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: PricingCard, PricingCardProps, PriceDisplay,
 *   PLAN_FEATURE_COPY, AvailablePlan, PlanFeatureRow, PRICING_NOISE_FILTER
 *
 * WHAT:  One plan's card — name, description, state badges, price, CTA, and the
 *        registry-derived feature checklist.
 * WHY:   Flat and square by design: the card is a CELL of the dashed pricing
 *        grid, so its own rounding would fight the frame. Selection is what
 *        rounds it — the active card paints a rounded card surface plus a
 *        bottom-up gradient over the dashes, which is how it lifts out of the
 *        grid without the layout moving.
 *        PLAN_FEATURE_COPY: every line in the checklist comes from
 *        getPlanFeatureRows, so a resource added to RESOURCES appears on every
 *        card automatically and no plan can advertise something the gates would
 *        refuse. Rows the plan does NOT include stay visible but dimmed — the
 *        gap between tiers is the reason someone is on this screen.
 *        Prices arrive pre-formatted (`priceDisplay`) because the trial /
 *        yearly-equivalent wording depends on state the parent owns; the card
 *        renders, it does not decide.
 * WHERE: Rendered per plan by <UpgradeContent /> inside <PricingGridFrame />.
 */

import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { BillingInterval } from "@/lib/config";
import type { PlanFeatureRow } from "@/lib/resources";
import type { AvailablePlan } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * SOURCE OF TRUTH KEYWORDS: PriceDisplay
 *
 * The two lines of the price block, already worded for the current interval and
 * trial state — e.g. `{ main: 'Free', sub: 'for 14 days, then $49/mo' }`.
 */
export interface PriceDisplay {
  main: string;
  sub: string;
}

export interface PricingCardProps {
  plan: AvailablePlan;
  /** Registry-derived rows for THIS plan — see getPlanFeatureRows. */
  features: PlanFeatureRow[];
  /** Name of the tier below, for the "All X features plus..." line. */
  previousPlanName: string | null;
  isSelected: boolean;
  isCurrentPlan: boolean;
  isCurrentlyOnTrial: boolean;
  /** DOWNGRADE_REQUIRES_CLEANUP — the org is using more than this plan allows. */
  isBlocked: boolean;
  priceDisplay: PriceDisplay;
  billingInterval: BillingInterval;
  /** Percent saved by paying yearly; 0 hides the badge. */
  savings: number;
  /** Selects the card for comparison. */
  onSelect: () => void;
  /** Selects it AND moves to the payment step. */
  onProceed: () => void;
}

export function PricingCard({
  plan,
  features,
  previousPlanName,
  isSelected,
  isCurrentPlan,
  isCurrentlyOnTrial,
  isBlocked,
  priceDisplay,
  billingInterval,
  savings,
  onSelect,
  onProceed,
}: PricingCardProps) {
  const hasTrial = plan.trialDays > 0;
  /* The free tier is never bought, and the plan you already pay for is not a
   * destination — but a TRIAL of it is, because converting is a real action. */
  const canProceed = !plan.isFree && !(isCurrentPlan && !isCurrentlyOnTrial);

  return (
    <div
      onClick={onSelect}
      className="relative flex h-full cursor-pointer flex-col"
    >
      {isSelected ? (
        <>
          {/* Solid rounded surface — covers the dashed cell edges so the
              selected card reads as one object lifted off the grid. */}
          <div className="absolute -inset-px z-0 rounded-2xl border border-border bg-card" />
          {/* Bottom-up glow + grain. Pointer-events off so the whole card stays
              clickable through it. */}
          <div className="pointer-events-none absolute -inset-px z-1 overflow-hidden rounded-2xl">
            <div className="absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-primary/20 via-primary/5 to-transparent" />
            <svg
              className="absolute inset-x-0 bottom-0 h-2/3 w-full mix-blend-soft-light"
              style={{ opacity: 0.12 }}
              aria-hidden="true"
            >
              <rect width="100%" height="100%" filter="url(#pricing-noise)" />
            </svg>
          </div>
        </>
      ) : null}

      <div className="relative z-10 flex flex-1 flex-col p-6 sm:p-7">
        <h3 className="text-lg font-semibold tracking-tight">{plan.name}</h3>
        {plan.description ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {plan.description}
          </p>
        ) : null}

        {/* Badge row keeps a fixed minimum height so cards with no badge line
            up with cards that have one. */}
        <div className="mt-2 flex min-h-[22px] flex-wrap items-center gap-2">
          {hasTrial && !plan.isFree ? (
            <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
              {plan.trialDays}-day trial
            </Badge>
          ) : null}
          {isCurrentPlan && isCurrentlyOnTrial ? (
            <Badge variant="outline" className="px-2 py-0.5 text-[10px]">
              Current trial
            </Badge>
          ) : null}
          {isCurrentPlan && !isCurrentlyOnTrial ? (
            <Badge
              variant="secondary"
              className="border border-success-border/40 bg-success/10 px-2 py-0.5 text-[10px] text-success"
            >
              Current plan
            </Badge>
          ) : null}
          {isBlocked ? (
            <Badge variant="destructive" className="px-2 py-0.5 text-[10px]">
              Reduce usage first
            </Badge>
          ) : null}
        </div>

        {/* Monospace price — the boxy, blueprint-like counterpart to the grid. */}
        <div className="mt-6 mb-6">
          <div className="font-mono text-4xl font-bold tracking-tight">
            {priceDisplay.main}
          </div>
          {priceDisplay.sub ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {priceDisplay.sub}
            </p>
          ) : null}

          {billingInterval === "yearly" && savings > 0 && !plan.isFree ? (
            <Badge
              variant="secondary"
              className="mt-2 border border-success-border/40 bg-success/10 text-[10px] text-success"
            >
              Save {savings}%
            </Badge>
          ) : null}
        </div>

        <Button
          onClick={(event) => {
            /* The card itself selects on click; the CTA must not double-fire. */
            event.stopPropagation();
            if (canProceed) onProceed();
          }}
          disabled={!canProceed}
          variant={isSelected && canProceed ? "default" : "outline"}
          className="mb-6 w-full rounded-full"
        >
          {isCurrentPlan && !isCurrentlyOnTrial
            ? "Current plan"
            : isCurrentPlan && isCurrentlyOnTrial
              ? "Keep this plan"
              : plan.isFree
                ? "Included"
                : "Get started →"}
        </Button>

        <div className="flex-1 space-y-3">
          {previousPlanName ? (
            <p className="text-sm text-muted-foreground">
              All {previousPlanName} features plus...
            </p>
          ) : null}

          {features.map((feature) => (
            <div
              key={feature.resource}
              className={cn(
                "flex items-center gap-2.5 text-sm",
                !feature.isIncluded && "opacity-40",
              )}
            >
              <CheckIcon
                className={cn(
                  "size-4 shrink-0",
                  feature.isIncluded ? "text-primary" : "text-muted-foreground",
                )}
              />
              {/* A limit reads as "10 seats", a flag as its own name — the noun
                  comes from the registry entry's `unit`, which is why a cap of
                  one renders "1 seat" rather than "1 Team Members". */}
              <span className="flex-1">
                {feature.kind === "limit" ? (
                  <>
                    {feature.isIncluded ? (
                      <span className="font-medium">{feature.amount} </span>
                    ) : null}
                    {feature.noun}
                  </>
                ) : (
                  feature.name
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: PRICING_NOISE_FILTER, pricing-noise
 *
 * WHAT:  The SVG turbulence filter the selected card's glow references by id.
 * WHY:   A filter has to exist in the document for `url(#pricing-noise)` to
 *        resolve, and defining it once — rather than inside each card — keeps
 *        one definition no matter how many plans render.
 * WHERE: Rendered once by <UpgradeContent />; referenced by PricingCard above.
 */
export function PricingNoiseFilter() {
  return (
    <svg className="absolute h-0 w-0 overflow-hidden" aria-hidden="true">
      <defs>
        <filter id="pricing-noise" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.65"
            numOctaves="3"
            stitchTiles="stitch"
          />
        </filter>
      </defs>
    </svg>
  );
}
