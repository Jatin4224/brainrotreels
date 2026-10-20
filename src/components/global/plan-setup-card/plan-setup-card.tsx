/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: PlanSetupCard, POST_SIGNUP_PLAN_STEP,
 *   PERSONAL_WORKSPACE, useUpgradeNudge, useUpgradeModal, dismissal
 *
 * WHAT:  The plan step a new user used to meet during onboarding, moved to
 *        the dashboard and made dismissible.
 * WHY:   POST_SIGNUP_PLAN_STEP. Auto-creating a workspace (PERSONAL_WORKSPACE)
 *        removed the three-step wizard, and step two of that wizard was the
 *        ONLY place in the product where a new user could start a paid
 *        subscription. Deleting it outright would have been a silent revenue
 *        regression, so the choice moves here: visible on arrival, skippable
 *        in one click, and reachable afterwards from billing.
 *
 *        Built entirely on existing pieces — useUpgradeNudge decides whether
 *        there is anything to sell and to whom, and useUpgradeModal runs the
 *        real Stripe Elements flow. No second checkout path: a parallel
 *        payment surface is how two of them drift.
 *
 *        Dismissal is per-browser localStorage, deliberately. It is a nudge,
 *        not state the server needs, and a dismissal row would mean a schema
 *        change and a write on a path that should stay read-only. Worst case
 *        on a new device is seeing it once more — far cheaper than the
 *        alternative. The read is wrapped because localStorage throws in
 *        private windows and returns nothing with site data blocked.
 * WHERE: Rendered on /dashboard above the page content.
 */

import * as React from "react";

import { useUpgradeModal } from "@/components/global/upgrade-modal/upgrade-modal-provider";
import { useUpgradeNudge } from "@/components/global/upgrade-modal/use-upgrade-nudge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const DISMISS_KEY = "plan-setup-card:dismissed";

/**
 * SOURCE OF TRUTH KEYWORDS: dismissedStore, useSyncExternalStore, HYDRATION_SAFE
 *
 * WHAT:  A tiny external store over one localStorage flag.
 * WHY:   HYDRATION_SAFE. The flag is browser-only, so the server must render
 *        "hidden" and the client must correct it without a mismatch.
 *        useSyncExternalStore is the sanctioned way to express that: the
 *        server snapshot is `true`, the client snapshot reads storage. The
 *        obvious alternative — setState inside an effect — is what the React
 *        Compiler lint rejects, because it schedules a second render pass on
 *        every mount.
 *        The snapshot is cached because useSyncExternalStore compares by
 *        reference and calls it on every render; recomputing would be a
 *        needless storage read each time.
 */
let dismissedCache: boolean | null = null;
const listeners = new Set<() => void>();

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    /* Private window or blocked site data — show the card rather than hide it
     * on an error. A nudge shown twice beats a funnel that silently vanishes. */
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): boolean {
  dismissedCache ??= readDismissed();
  return dismissedCache;
}

/* Server renders hidden: showing the card then removing it on hydration is
 * worse than revealing it a frame later. */
function getServerSnapshot(): boolean {
  return true;
}

function dismiss(): void {
  dismissedCache = true;
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* Dismissal does not persist here; the card returns next visit. */
  }
  for (const listener of listeners) listener();
}

export function PlanSetupCard() {
  const nudge = useUpgradeNudge();
  const { open } = useUpgradeModal();

  const dismissed = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  if (dismissed || nudge === null || nudge.variant !== "card") return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">{nudge.message}</p>
          <p className="text-sm text-muted-foreground">{nudge.body}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Not now
          </Button>
          <Button size="sm" onClick={() => open({ plan: nudge.targetPlan })}>
            {nudge.ctaLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
