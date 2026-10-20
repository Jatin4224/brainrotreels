/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: UpgradeContent, UpgradeContentProps, UpgradeStep,
 *   UserScenario, UPGRADE_COPY_FROM_REGISTRY, DOWNGRADE_REQUIRES_CLEANUP,
 *   PRICES_LIVE_IN_STRIPE, PricingCard, FeatureComparisonTable
 *
 * WHAT:  The whole upgrade experience as an embeddable component — pick a plan
 *        (pricing grid + comparison table), pay (interval + card), celebrate.
 * WHY:   Separated from the Dialog shell so the same three-step flow can be
 *        dropped into a page, a settings tab, or an onboarding step without a
 *        modal around it. Every number it renders is derived, never written
 *        here: caps and features from RESOURCES, plan identity and trial length
 *        from PLANS, amounts from the billing provider, entitlement state from
 *        usage.getFeatureGates. The file names no plan and no resource.
 *        UPGRADE_COPY_FROM_REGISTRY: when a gate is what opened this, the
 *        resource's own upgrade sentence is shown at the top and its row is
 *        highlighted in the comparison table — the user is told what THEY hit,
 *        not a generic "upgrade for more".
 *        DOWNGRADE_REQUIRES_CLEANUP: a plan the organization is currently too
 *        big for is marked on its card and refused at the payment step, with the
 *        exact rows to reduce. The server refuses it too — this is the
 *        affordance, not the boundary.
 *        Which mutation runs is a consequence of state, not of a second UI:
 *        no subscription yet → createSubscription (trial-aware), an existing one
 *        → upgradeOrganization (prorated). Both already enforce their own
 *        permissions server-side; the UI mirrors them so a member who cannot buy
 *        is told who can instead of being handed a button that will fail.
 * WHERE: Rendered by <UpgradeModal />, which the root-level
 *        <UpgradeModalProvider /> mounts once for the whole app.
 */

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import confetti from "canvas-confetti";
import {
  CheckIcon,
  ChevronLeftIcon,
  CreditCardIcon,
  HeartIcon,
  Loader2Icon,
  LockIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn, formatCurrency } from "@/lib/utils";
import {
  BRANDING,
  PLANS,
  PLAN_ORDER,
  isPaidPlan,
  type BillingInterval,
  type PlanKey,
} from "@/lib/config";
import { getPlanFeatureRows, type ResourceKey } from "@/lib/resources";
import {
  isPurchasablePlan,
  type AvailablePlan,
  type PurchasablePlanKey,
} from "@/lib/types";
import { permissions } from "@/lib/permissions";
import { trpc } from "@/trpc/react-provider";
import { useActiveOrganization } from "@/hooks/use-active-organization";
import {
  AddPaymentMethodDialog,
  PaymentMethodOption,
} from "@/components/global/billing";
import { UsageLimitList } from "@/components/global/usage-limit-list";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PricingCard,
  PricingNoiseFilter,
  type PriceDisplay,
} from "./pricing-card";
import { FeatureComparisonTable } from "./feature-comparison-table";
import {
  PricingGridFrame,
  DASHED_CELL_STYLE,
  RIGHT_FADE_MASK,
} from "./pricing-grid-frame";
import { calculateSavings } from "./pricing-math";
import {
  ComparisonTableSkeleton,
  PricingCardSkeleton,
} from "./pricing-skeletons";

export interface UpgradeContentProps {
  organizationId: string;
  /** The resource whose gate opened this, when a gate did. */
  resource?: ResourceKey | undefined;
  /** The registry's upgrade sentence for that resource, already interpolated. */
  upgradeMessage?: string | undefined;
  /** Plan to open on, when the caller's own copy already named one. */
  plan?: PlanKey | undefined;
  onClose?: (() => void) | undefined;
}

type UpgradeStep = "select-plan" | "payment" | "success";

/**
 * SOURCE OF TRUTH KEYWORDS: UserScenario, UPGRADE_SCENARIO_COPY
 *
 * Which situation the viewer is in. Drives every header string through
 * BRANDING.upgradeModal.scenarios — the keys here and there are the same set,
 * so adding a situation is one entry in each.
 */
type UserScenario = keyof typeof BRANDING.upgradeModal.scenarios;

/* Seconds the success step waits before reloading. The new plan changes gates,
 * nav, and quotas across the whole shell, so a reload is the honest way to
 * re-derive all of it — the countdown exists so it never feels like a crash. */
const SUCCESS_RELOAD_SECONDS = 5;

/* Placeholder columns while the catalogue loads. Three, not the real count,
 * because the real count is not known yet — the fade mask on the right says
 * "there may be more" rather than committing to a number. */
const SKELETON_COLUMN_COUNT = 3;

export function UpgradeContent({
  organizationId,
  resource,
  upgradeMessage,
  plan,
  onClose,
}: UpgradeContentProps) {
  const [step, setStep] = React.useState<UpgradeStep>("select-plan");
  /* Both selections are stored as OVERRIDES and resolved against a derived
   * default below. Storing the resolved value instead would need an effect to
   * seed it once the data lands, which is a render-after-render round trip and
   * a stale value the moment the underlying data changes. */
  const [planOverride, setPlanOverride] = React.useState<PlanKey | null>(
    plan ?? null,
  );
  const [billingInterval, setBillingInterval] =
    React.useState<BillingInterval>("monthly");
  const [cardOverride, setCardOverride] = React.useState<string | null>(null);
  const [isAddingCard, setIsAddingCard] = React.useState(false);
  const [countdown, setCountdown] = React.useState(SUCCESS_RELOAD_SECONDS);

  const { hasPermission } = useActiveOrganization();
  const canReadBilling = hasPermission(permissions.BILLING_READ);

  const utils = trpc.useUtils();

  // ── Reads ────────────────────────────────────────────────────────────────
  /* Catalogue + amounts. Open to every member — see billing.getAvailablePlans. */
  const plansQuery = trpc.billing.getAvailablePlans.useQuery(undefined, {
    staleTime: 1000 * 60 * 10,
  });
  /* Whether this OPEN started with the catalogue already known. A lazy initial
   * state, not a derived value: it must answer for the first render forever
   * after, and it must not follow the query once it resolves. */
  const [hadPlansOnMount] = React.useState(() => plansQuery.data !== undefined);

  /* Entitlement state from the SAME read the gates use, so the modal and the
   * server can never disagree about which plan the org is on. */
  const gatesQuery = trpc.usage.getFeatureGates.useQuery({ organizationId });

  /* Interval + whether a subscription already exists — billing-permissioned,
   * because it is tenant billing data rather than a price list. */
  const subscriptionQuery = trpc.billing.getSubscription.useQuery(
    { organizationId },
    { enabled: canReadBilling },
  );

  const trialQuery = trpc.billing.getTrialEligibility.useQuery(undefined, {
    staleTime: 1000 * 60 * 10,
  });

  const paymentMethodsQuery = trpc.billing.getPaymentMethods.useQuery(
    { organizationId },
    { enabled: canReadBilling && step === "payment" },
  );

  /* WHOLE_LADDER_IN_ONE_READ — every plan's blockers up front, so a card can be
   * marked before it is clicked. */
  const blockerQuery = trpc.usage.getDowngradeBlockerMap.useQuery({
    organizationId,
  });

  // ── Derived state ────────────────────────────────────────────────────────
  const currentTier: PlanKey = gatesQuery.data?.tier ?? "free";
  const isCurrentlyOnTrial = gatesQuery.data?.isOnTrial ?? false;
  const hasSubscription = subscriptionQuery.data?.subscription != null;
  const currentInterval = subscriptionQuery.data?.billingInterval ?? null;
  /* User-level trial history. The card-level check still runs server-side at
   * purchase; this is the half that is knowable before a card is picked. */
  const hasUsedTrial = trialQuery.data?.hasUsedTrial ?? false;

  /* Buying is two different permissions depending on which mutation this will
   * become — mirrored from the router so the UI never offers a doomed click. */
  const canPurchase =
    canReadBilling &&
    hasPermission(
      hasSubscription ? permissions.BILLING_UPDATE : permissions.BILLING_CREATE,
    );

  const plans = React.useMemo<AvailablePlan[]>(() => {
    const available = plansQuery.data ?? [];
    return (
      available
        .filter((plan) => plan.showPlan)
        /* A trial already consumed must not be advertised: the server refuses to
         * grant a second one, so showing the badge would promise a free start and
         * then charge for it. */
        .map((plan) =>
          hasUsedTrial && plan.trialDays > 0 ? { ...plan, trialDays: 0 } : plan,
        )
    );
  }, [plansQuery.data, hasUsedTrial]);

  /* Open on the obvious next step up; an explicit pick always wins.
   * DERIVED FROM CONFIG, NOT FROM THE PRICE QUERY: which plan comes after the
   * current one is knowable from PLAN_ORDER the instant the component mounts,
   * so the selection — and everything keyed off it, including the header copy —
   * is final on the first render instead of arriving with the amounts. */
  const defaultPlan = React.useMemo<PlanKey | null>(() => {
    const sellable = PLAN_ORDER.filter(
      (key) => PLANS[key].showPlan && isPaidPlan(key),
    );
    /* Mid-trial the destination is the plan being TRIALLED — converting is the
     * decision in front of the user, and pre-selecting the tier above it sells
     * past what they came to buy. */
    if (isCurrentlyOnTrial && sellable.includes(currentTier))
      return currentTier;
    const currentIndex = PLAN_ORDER.indexOf(currentTier);
    const next = sellable.find((key) => PLAN_ORDER.indexOf(key) > currentIndex);
    return next ?? sellable[sellable.length - 1] ?? null;
  }, [currentTier, isCurrentlyOnTrial]);
  const selectedPlan = planOverride ?? defaultPlan;

  /* Charge the card the customer already pays with unless they pick another. */
  const paymentMethodId =
    cardOverride ??
    paymentMethodsQuery.data?.find((method) => method.isDefault)?.id ??
    "";

  React.useEffect(() => {
    if (step !== "success") return;
    const timer = window.setInterval(() => {
      setCountdown((previous) => {
        if (previous <= 1) {
          window.location.reload();
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const currentPlan = plans.find((plan) => plan.key === selectedPlan) ?? null;
  const blockers = selectedPlan
    ? (blockerQuery.data?.[selectedPlan] ?? [])
    : [];
  /* Over-cap usage must come down first; losing a flag feature cannot be "fixed"
   * by deleting anything, so it is disclosed and the switch proceeds. Same line
   * the server draws in ensureDowngradeIsSafe. */
  const mustResolve = blockers.filter((blocker) => !blocker.isFeatureLoss);
  /* FAILS CLOSED while the map loads: an unverified downgrade is unrecoverable,
   * a delayed one is not. */
  const isPlanReachable =
    blockerQuery.data !== undefined && mustResolve.length === 0;

  /* NO_PROVISIONAL_HEADER. The scenario is what the header, the CTA and the
   * success copy all read, and it flips on two facts: the plan the org is on,
   * and whether this user can still be given a trial. Rendering it before both
   * have landed put "Upgrade your plan" on screen and then visibly swapped it
   * for "Start your free trial" — the modal correcting itself in front of the
   * user. Both are prefetched by the dashboard layout, so in practice this is
   * already true on the first render; the guard is what makes it true when it
   * is not (a cold cache, a slow network, the modal opened outside a
   * prefetching route). Trial LENGTH comes from PLANS rather than the price
   * query for the same reason — it is local config, not a provider fact. */
  const isHeaderResolved =
    gatesQuery.data !== undefined && trialQuery.data !== undefined;
  const trialDays =
    selectedPlan && !hasUsedTrial ? PLANS[selectedPlan].trialDays : 0;
  const scenario = resolveScenario({
    currentTier,
    selectedPlan,
    isCurrentlyOnTrial,
    hasUsedTrial,
    trialDays,
  });
  const copy = BRANDING.upgradeModal.scenarios[scenario];

  const maxSavings = plans.reduce(
    (max, plan) => (plan.isFree ? max : Math.max(max, calculateSavings(plan))),
    0,
  );

  /* An interval the org is already on is not a change — offering it as an option
   * would let someone "switch" to what they already have and be charged for the
   * proration of nothing. */
  const availableIntervals =
    selectedPlan === currentTier && currentInterval && !isCurrentlyOnTrial
      ? {
          monthly: currentInterval === "yearly",
          yearly: currentInterval === "monthly",
        }
      : { monthly: true, yearly: true };

  // ── Writes ───────────────────────────────────────────────────────────────
  const createSubscription = trpc.billing.createSubscription.useMutation();
  const upgradeOrganization = trpc.billing.upgradeOrganization.useMutation();
  const setDefaultPaymentMethod =
    trpc.billing.setDefaultPaymentMethod.useMutation();
  const isSubmitting =
    createSubscription.isPending ||
    upgradeOrganization.isPending ||
    setDefaultPaymentMethod.isPending;

  async function handlePurchase() {
    if (!selectedPlan || !isPurchasablePlan(selectedPlan)) {
      toast.error("Choose a plan to continue");
      return;
    }
    if (!paymentMethodId) {
      toast.error("Choose a payment method to continue");
      return;
    }

    try {
      await submitPlanChange({
        plan: selectedPlan,
        interval: billingInterval,
        paymentMethodId,
        hasSubscription,
        expectTrial: (currentPlan?.trialDays ?? 0) > 0,
        isDefaultCard:
          paymentMethodsQuery.data?.find(
            (method) => method.id === paymentMethodId,
          )?.isDefault ?? false,
        create: createSubscription.mutateAsync,
        upgrade: upgradeOrganization.mutateAsync,
        setDefault: setDefaultPaymentMethod.mutateAsync,
        organizationId,
      });

      /* Everything downstream of a plan change is re-derived from these four
       * reads, so they are all invalidated together rather than one screen at a
       * time. */
      await Promise.all([
        utils.usage.getFeatureGates.invalidate({ organizationId }),
        utils.usage.getDowngradeBlockerMap.invalidate({ organizationId }),
        utils.usage.getPlanOverages.invalidate({ organizationId }),
        utils.billing.getSubscription.invalidate({ organizationId }),
      ]);

      setCountdown(SUCCESS_RELOAD_SECONDS);
      setStep("success");
      fireConfetti();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not change the plan",
      );
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const selectedPlanName = selectedPlan ? PLANS[selectedPlan].name : "";

  return (
    <>
      {/* Sibling, not a child: a dialog inside a dialog traps focus in the
          wrong one and closes both on Escape. */}
      <AddPaymentMethodDialog
        open={isAddingCard}
        onOpenChange={(open) => {
          setIsAddingCard(open);
          if (!open)
            void utils.billing.getPaymentMethods.invalidate({ organizationId });
        }}
        organizationId={organizationId}
      />

      <div className="flex h-full w-full flex-col overflow-hidden bg-background">
        {onClose && step !== "success" ? (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 z-20 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}

        {step === "select-plan" ? (
          <div className="flex flex-1 flex-col overflow-y-auto">
            {/* Wide enough for four capped cards side by side (4 × 320 plus the
                page padding), which is the ONLY thing that uses the extra room:
                the header, the comparison table and the action bar each keep
                their own narrower reading width below. Cards never stretch into
                it either — the grid frame caps itself — so a two-plan account
                still gets card-shaped cards on a large screen. */}
            <div className="mx-auto flex w-full max-w-[88rem] flex-1 flex-col items-center px-4 py-8 sm:px-6 sm:py-12 lg:px-8 lg:py-16">
              {/* UPGRADE_COPY_FROM_REGISTRY — the sentence the resource wrote
                  about itself, shown before anything about plans.
                  A PILL, not a panel: this is a caption explaining why the
                  screen opened, and giving it a full-width box made it read as
                  an error banner sitting above unrelated content. Sized to its
                  own text so a short message stays a short chip, and it carries
                  the lock that names the thing that stopped them. */}
              {upgradeMessage ? (
                <div className="mb-5 flex max-w-full items-center gap-2.5 rounded-full border border-border/70 bg-card/80 py-1.5 pr-5 pl-1.5 shadow-sm">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <LockIcon className="size-3.5 text-primary" />
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">
                    {upgradeMessage}
                  </span>
                </div>
              ) : null}

              {/* Reserves the header's exact height while unresolved, so the
                  copy appearing never moves the grid below it. */}
              <div className="mb-6 max-w-5xl text-center sm:mb-8">
                {isHeaderResolved ? (
                  <>
                    <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                      {copy.title}
                    </h2>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground sm:text-base">
                      {copy.description}
                    </p>
                  </>
                ) : (
                  <>
                    <Skeleton className="mx-auto h-8 w-64 sm:h-9" />
                    <Skeleton className="mx-auto mt-3 h-4 w-80 max-w-full" />
                  </>
                )}
              </div>

              <div className="mb-8 inline-flex items-center rounded-full border border-border/50 bg-muted/50 p-1 sm:mb-10">
                {(["monthly", "yearly"] as const).map((interval) => (
                  <button
                    key={interval}
                    type="button"
                    onClick={() => setBillingInterval(interval)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium capitalize transition-all",
                      billingInterval === interval
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {interval}
                    {interval === "yearly" && maxSavings > 0 ? (
                      <span className="text-xs font-semibold text-success">
                        -{maxSavings}%
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {plansQuery.isPending ? (
                  <motion.div
                    key="pricing-skeleton"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="w-full space-y-10"
                  >
                    {/* Same width rule as the real grid, so the cards do not
                        resize under the user when the prices land. */}
                    <div style={RIGHT_FADE_MASK}>
                      <PricingGridFrame columns={SKELETON_COLUMN_COUNT}>
                        <div className="grid w-full grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-3">
                          {Array.from(
                            { length: SKELETON_COLUMN_COUNT },
                            (_, index) => (
                              <div key={index} style={DASHED_CELL_STYLE}>
                                <PricingCardSkeleton />
                              </div>
                            ),
                          )}
                        </div>
                      </PricingGridFrame>
                    </div>
                    <ComparisonTableSkeleton style={RIGHT_FADE_MASK} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="pricing-loaded"
                    /* The fade is a TRANSITION OUT OF LOADING, not an entrance.
                       When the catalogue was already in the cache (the normal
                       case — the dashboard layout prefetches it) there was no
                       loading state to leave, so animating from transparent
                       would show an empty grid under a finished header for
                       400ms. `false` skips straight to the resting state. */
                    initial={hadPlansOnMount ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4 }}
                    className="w-full"
                  >
                    <PricingNoiseFilter />

                    <PricingGridFrame columns={plans.length}>
                      <div
                        className={cn(
                          "grid w-full grid-cols-1 gap-0 sm:grid-cols-2",
                          /* Wrapping to a second row is the correct answer on a
                             narrow screen — the frame closes around whatever
                             shape the rows make. */
                          plans.length >= 4
                            ? "lg:grid-cols-3 xl:grid-cols-4"
                            : plans.length === 3
                              ? "lg:grid-cols-3"
                              : "sm:grid-cols-2",
                        )}
                      >
                        {plans.map((plan) => (
                          <div key={plan.key} style={DASHED_CELL_STYLE}>
                            <PricingCard
                              plan={plan}
                              features={getPlanFeatureRows(plan.key)}
                              previousPlanName={getPreviousPlanName(plan.key)}
                              isSelected={selectedPlan === plan.key}
                              isCurrentPlan={plan.key === currentTier}
                              isCurrentlyOnTrial={isCurrentlyOnTrial}
                              isBlocked={(
                                blockerQuery.data?.[plan.key] ?? []
                              ).some((blocker) => !blocker.isFeatureLoss)}
                              priceDisplay={getPriceDisplay(
                                plan,
                                billingInterval,
                              )}
                              billingInterval={billingInterval}
                              savings={calculateSavings(plan)}
                              onSelect={() => setPlanOverride(plan.key)}
                              onProceed={() => {
                                setPlanOverride(plan.key);
                                setStep("payment");
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </PricingGridFrame>

                    {plans.length > 0 ? (
                      /* Reading width, not grid width. Only the CARDS earn the
                         wide container — a comparison table stretched to the
                         same span puts the plan columns so far from their row
                         labels that the eye loses the row. */
                      <div className="mx-auto mt-10 w-full max-w-5xl sm:mt-14">
                        <FeatureComparisonTable
                          planKeys={plans.map((plan) => plan.key)}
                          highlightResource={resource}
                        />
                      </div>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-8 flex items-center gap-3 sm:mt-10">
                {onClose ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                    className="text-muted-foreground"
                  >
                    {BRANDING.upgradeModal.secondaryCtaLabel}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  onClick={() => {
                    /* Carry the only legal interval over rather than landing on
                       the payment step with a disabled choice pre-selected. */
                    if (
                      availableIntervals.monthly &&
                      !availableIntervals.yearly
                    ) {
                      setBillingInterval("monthly");
                    } else if (
                      availableIntervals.yearly &&
                      !availableIntervals.monthly
                    ) {
                      setBillingInterval("yearly");
                    }
                    setStep("payment");
                  }}
                  disabled={!selectedPlan || (currentPlan?.isFree ?? true)}
                >
                  Continue
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {step === "payment" && currentPlan ? (
          <div className="flex flex-1 flex-col overflow-y-auto">
            <div className="flex flex-1 flex-col items-center px-4 py-8 sm:px-6 sm:py-12">
              <div className="w-full max-w-lg">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep("select-plan")}
                  className="mb-4 -ml-2 w-fit text-muted-foreground"
                >
                  <ChevronLeftIcon className="mr-1 size-4" />
                  Back to plans
                </Button>

                <div className="mb-8">
                  <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                    {BRANDING.upgradeModal.paymentTitle}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {scenario === "paid_downgrade"
                      ? `Move this workspace to ${currentPlan.name}`
                      : `Complete your upgrade to ${currentPlan.name}`}
                  </p>
                </div>

                <div className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-base font-medium">
                      Billing interval
                    </Label>
                    <div role="radiogroup" className="grid grid-cols-2 gap-4">
                      {(["monthly", "yearly"] as const)
                        .filter((interval) => availableIntervals[interval])
                        .map((interval) => {
                          const price = getIntervalPrice(currentPlan, interval);
                          const selected = billingInterval === interval;
                          const savings = calculateSavings(currentPlan);
                          return (
                            <button
                              key={interval}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => setBillingInterval(interval)}
                              className={cn(
                                "relative flex flex-col items-center justify-between rounded-2xl border bg-card p-4 transition-all duration-200",
                                selected
                                  ? "border-primary/60 shadow-lg"
                                  : "border-border/50 hover:border-primary/30",
                              )}
                            >
                              {interval === "yearly" && savings > 0 ? (
                                <span className="absolute -top-2 -right-2 rounded-full bg-success px-2 py-0.5 text-xs font-bold text-success-foreground">
                                  Save {savings}%
                                </span>
                              ) : null}
                              <span className="text-sm font-semibold capitalize">
                                {interval}
                              </span>
                              <span className="mt-2 text-2xl font-bold">
                                {price.main}
                              </span>
                              <span className="mt-1 text-center text-xs text-muted-foreground">
                                {price.sub}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  {/* DOWNGRADE_REQUIRES_CLEANUP — the exact rows to reduce, from
                      the same list the over-plan banner renders. */}
                  {blockers.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {mustResolve.length > 0
                          ? `${currentPlan.name} does not cover everything this workspace is using. Remove the excess below, then switch.`
                          : "You can switch now. These are part of your current plan and would no longer be included."}
                      </p>
                      <UsageLimitList blockers={blockers} />
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    <Label className="text-base font-medium">
                      Payment method
                    </Label>

                    {!canReadBilling ? (
                      <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                        {BRANDING.upgradeModal.noBillingPermissionBody}
                      </div>
                    ) : paymentMethodsQuery.isPending ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : (paymentMethodsQuery.data ?? []).length > 0 ? (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Choose the card to charge for this change
                        </p>
                        <div role="radiogroup" className="space-y-2">
                          {(paymentMethodsQuery.data ?? []).map((method) => (
                            <PaymentMethodOption
                              key={method.id}
                              method={method}
                              selected={method.id === paymentMethodId}
                              onSelect={setCardOverride}
                            />
                          ))}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2"
                          onClick={() => setIsAddingCard(true)}
                        >
                          <PlusIcon className="size-4" />
                          Add new payment method
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 py-8 text-center">
                          <CreditCardIcon className="mb-3 size-10 text-muted-foreground" />
                          <p className="text-sm font-medium">
                            No payment methods on file
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Add a card to continue
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          className="w-full gap-2"
                          onClick={() => setIsAddingCard(true)}
                        >
                          <PlusIcon className="size-4" />
                          Add payment method
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-8 border-t border-border/50 pt-6">
                  <div className="flex justify-end gap-3">
                    <Button
                      variant="ghost"
                      onClick={() => setStep("select-plan")}
                    >
                      Back
                    </Button>
                    <Button
                      onClick={handlePurchase}
                      disabled={
                        !paymentMethodId ||
                        !canPurchase ||
                        !isPlanReachable ||
                        isSubmitting
                      }
                      className="gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2Icon className="size-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <CheckIcon className="size-4" />
                          {copy.ctaLabel}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {step === "success" ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
            <div className="w-full max-w-md text-center">
              <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-primary/10">
                <HeartIcon className="size-8 fill-primary text-primary" />
              </div>

              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                {BRANDING.upgradeModal.successTitle.replace(
                  "{planName}",
                  selectedPlanName,
                )}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {scenario === "trial_to_paid"
                  ? BRANDING.upgradeModal.successTrialBody
                  : scenario === "paid_downgrade"
                    ? BRANDING.upgradeModal.successDowngradeBody
                    : BRANDING.upgradeModal.successBody}
              </p>

              <div className="mt-6 rounded-xl border border-border/50 bg-muted/50 px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Refreshing your workspace in{" "}
                  <span className="font-bold text-primary">{countdown}</span>{" "}
                  second
                  {countdown === 1 ? "" : "s"}...
                </p>
              </div>

              <Button
                onClick={() => window.location.reload()}
                className="mt-6 w-full"
              >
                Get started
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveScenario, UserScenario
 *
 * WHAT:  Which of the six situations the viewer is in.
 * WHY:   Pure function of state the caller already has, so the copy, the CTA and
 *        the success wording all follow one decision instead of three
 *        independent ternaries drifting apart in the JSX.
 * WHERE: <UpgradeContent /> above.
 */
function resolveScenario(input: {
  currentTier: PlanKey;
  selectedPlan: PlanKey | null;
  isCurrentlyOnTrial: boolean;
  hasUsedTrial: boolean;
  trialDays: number;
}): UserScenario {
  if (input.isCurrentlyOnTrial) return "trial_to_paid";

  if (input.currentTier === "free") {
    /* A trial is only worth naming if this user can still be granted one — the
     * server refuses a second, so promising it would be a lie. */
    return !input.hasUsedTrial && input.trialDays > 0
      ? "free_to_trial"
      : "free_to_paid";
  }

  if (!input.selectedPlan || input.selectedPlan === input.currentTier)
    return "paid_same";

  const currentIndex = PLAN_ORDER.indexOf(input.currentTier);
  const selectedIndex = PLAN_ORDER.indexOf(input.selectedPlan);
  if (selectedIndex > currentIndex) return "paid_upgrade";
  if (selectedIndex < currentIndex) return "paid_downgrade";
  return "paid_same";
}

/* Name of the tier below, for the "All X features plus..." line on a card. */
function getPreviousPlanName(plan: PlanKey): string | null {
  const index = PLAN_ORDER.indexOf(plan);
  if (index <= 0) return null;
  const previous = PLAN_ORDER[index - 1];
  return previous ? PLANS[previous].name : null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: getPriceDisplay, PriceDisplay, PRICES_LIVE_IN_STRIPE
 *
 * WHAT:  The two lines of a card's price block for the chosen interval.
 * WHY:   Three facts collapse into one headline — the amount, whether a trial
 *        delays it, and that a yearly price is quoted per month. Deciding that
 *        once here is what keeps <PricingCard /> a renderer. A missing amount
 *        renders as an em dash rather than "$NaN": a plan whose price id isn't
 *        configured yet must still show what it INCLUDES.
 * WHERE: <UpgradeContent /> above.
 */
function getPriceDisplay(
  plan: AvailablePlan,
  interval: BillingInterval,
): PriceDisplay {
  if (plan.isFree) return { main: "$0", sub: "Free forever" };

  const price = interval === "monthly" ? plan.monthlyPrice : plan.yearlyPrice;
  if (!price) return { main: "—", sub: "Not available" };

  const hasTrial = plan.trialDays > 0;
  const perMonth =
    interval === "monthly" ? price.amount : Math.round(price.amount / 12);
  const perMonthLabel = formatCurrency(perMonth, price.currency);

  if (hasTrial) {
    return {
      main: "Free",
      sub: `for ${plan.trialDays} days, then ${perMonthLabel}/mo`,
    };
  }

  if (interval === "monthly") return { main: perMonthLabel, sub: "/month" };

  return {
    main: `${perMonthLabel}/mo`,
    sub: `Billed ${formatCurrency(price.amount, price.currency)} annually`,
  };
}

/* Same three facts as getPriceDisplay, worded for the interval cards on the
 * payment step, where the yearly total matters more than the headline. */
function getIntervalPrice(
  plan: AvailablePlan,
  interval: BillingInterval,
): PriceDisplay {
  const price = interval === "monthly" ? plan.monthlyPrice : plan.yearlyPrice;
  if (!price) return { main: "—", sub: "Not available" };

  const hasTrial = plan.trialDays > 0;
  const amountLabel = formatCurrency(price.amount, price.currency);

  if (interval === "monthly") {
    return {
      main: hasTrial ? "Free" : amountLabel,
      sub: hasTrial
        ? `for ${plan.trialDays} days, then ${amountLabel}/mo`
        : "per month",
    };
  }

  const perMonthLabel = formatCurrency(
    Math.round(price.amount / 12),
    price.currency,
  );
  return {
    main: hasTrial ? "Free" : `${perMonthLabel}/mo`,
    sub: hasTrial
      ? `for ${plan.trialDays} days, then ${amountLabel} annually`
      : `Billed ${amountLabel} annually`,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: submitPlanChange, createSubscription,
 *   upgradeOrganization, setDefaultPaymentMethod
 *
 * WHAT:  Runs the right billing mutation for the organization's current state.
 * WHY:   There is no "change plan" endpoint that covers both cases, and there
 *        shouldn't be: a first subscription needs a card attached and is
 *        trial-eligible, while a change to an existing one is a prorated price
 *        swap on a subscription that already has a card. Choosing between them
 *        HERE keeps that branch out of the JSX, and picking a non-default card
 *        promotes it first so the renewal charges what the user just chose.
 * WHERE: handlePurchase in <UpgradeContent />.
 */
async function submitPlanChange(input: {
  organizationId: string;
  plan: PurchasablePlanKey;
  interval: BillingInterval;
  paymentMethodId: string;
  hasSubscription: boolean;
  expectTrial: boolean;
  isDefaultCard: boolean;
  create: (values: {
    organizationId: string;
    planKey: PurchasablePlanKey;
    billingInterval: BillingInterval;
    paymentMethodId: string;
    expectTrial: boolean;
  }) => Promise<unknown>;
  upgrade: (values: {
    organizationId: string;
    planKey: PurchasablePlanKey;
    billingInterval: BillingInterval;
  }) => Promise<unknown>;
  setDefault: (values: {
    organizationId: string;
    paymentMethodId: string;
  }) => Promise<unknown>;
}): Promise<void> {
  if (!input.hasSubscription) {
    await input.create({
      organizationId: input.organizationId,
      planKey: input.plan,
      billingInterval: input.interval,
      paymentMethodId: input.paymentMethodId,
      expectTrial: input.expectTrial,
    });
    return;
  }

  if (!input.isDefaultCard) {
    await input.setDefault({
      organizationId: input.organizationId,
      paymentMethodId: input.paymentMethodId,
    });
  }

  await input.upgrade({
    organizationId: input.organizationId,
    planKey: input.plan,
    billingInterval: input.interval,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: fireConfetti
 *
 * A short two-corner burst on success. Fired once, from a user-initiated action,
 * and it never blocks the reload countdown behind it.
 */
function fireConfetti(): void {
  const end = Date.now() + 500;

  const frame = () => {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 1 },
      startVelocity: 100,
      scalar: 1.7,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 1 },
      startVelocity: 100,
      scalar: 1.7,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };

  frame();
}
