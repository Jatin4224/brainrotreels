/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: PlanOverageBanner, getPlanOverages, OVER_PLAN_STATE,
 *   UsageLimitList, ChangePlanDialog, DOWNGRADE_REQUIRES_CLEANUP
 *
 * WHAT:  A persistent notice, on every dashboard page, when the organization is
 *        using more than its current plan includes — with a dialog listing
 *        exactly what has to come down.
 * WHY:   OVER_PLAN_STATE. The guard on the plan-change dialog only covers the
 *        one surface we render. A plan can also change from a Stripe-side edit,
 *        a provider's own hosted billing portal, a support action, or an admin
 *        editing a plan's features — none of which our UI can intercept. This
 *        catches the RESULT rather than the cause, so it covers routes we have
 *        not thought of, including future ones.
 *        It is a notice, not a gate: creates past the cap are already refused by
 *        protectedProcedure. The gap it closes is that the tenant was never told
 *        why, and had no list of what to fix.
 *        Shown to EVERY member, not only whoever can manage billing — the state
 *        blocks their work too, and the people who can remove the excess are
 *        usually not the ones holding the card.
 *        Prefetched and hydrated in the dashboard layout, so the normal case
 *        (no overage) renders nothing on first paint instead of flashing a red
 *        bar in and out.
 *        APP_BANNER_OFFSET: it sits ABOVE the whole shell, full-bleed, and
 *        pushes the sidebar down with it — inside the content column it read as
 *        one more page section and was easy to scroll past. Because the desktop
 *        sidebar is `fixed` to the viewport it cannot be pushed by flow alone,
 *        so it offsets from --app-banner-height, raised purely in CSS by the
 *        `:has([data-app-banner])` rule in globals.css. That is deliberately
 *        NOT a measurement: publishing a measured height from an effect left
 *        the first paint at 0, so the sidebar rendered flush to the top and
 *        visibly dropped a frame later. CSS resolves it from the server markup
 *        before anything is painted.
 * WHERE: Rendered once above <SidebarProvider /> in
 *        src/app/(dashboard)/layout.tsx.
 */

import * as React from "react";
import { TriangleAlertIcon } from "lucide-react";

import { trpc } from "@/trpc/react-provider";
import { useActiveOrganization } from "@/hooks/use-active-organization";
import { UsageLimitList } from "@/components/global/usage-limit-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PlanOverageBanner() {
  const { activeOrganization } = useActiveOrganization();
  const organizationId = activeOrganization?.id ?? "";
  const [open, setOpen] = React.useState(false);

  const { data: overages } = trpc.usage.getPlanOverages.useQuery(
    { organizationId },
    { enabled: organizationId !== "", staleTime: 30_000 },
  );

  /* The overwhelmingly common case — render nothing at all rather than reserve
   * space for a bar that is almost never there. */
  if (!overages || overages.length === 0) return null;

  return (
    <>
      {/* data-app-banner is what the shell offset keys off — see the `:has()`
          rule in globals.css. The md height is PINNED so that offset is a
          constant the first paint already knows, which is why the sidebar no
          longer drops into place after hydration. Two wrapped lines of text-sm
          still fit inside h-16, so a narrow desktop cannot clip it. */}
      <div
        data-app-banner
        className="flex w-full flex-col gap-3 border-b border-alert-banner-border bg-alert-banner px-4 py-3 text-alert-banner-foreground md:h-16 md:flex-row md:items-center md:gap-4 md:px-6 md:py-0"
      >
        <TriangleAlertIcon className="size-5 shrink-0" />
        <p className="min-w-0 flex-1 text-sm font-bold">
          Your organization is using more than your current plan includes.
          Please bring your usage back within your plan before your next billing
          date so your team keeps uninterrupted access.
        </p>
        <Button
          size="sm"
          className="w-full shrink-0 bg-alert-banner-foreground font-semibold text-alert-banner hover:bg-alert-banner-foreground/90 md:w-auto"
          onClick={() => setOpen(true)}
        >
          Review usage
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bring your usage within your plan</DialogTitle>
            <DialogDescription>
              Your organization is over what your current plan includes. Remove
              the excess below before your next billing date, or move to a plan
              that covers it.
            </DialogDescription>
          </DialogHeader>

          {/* Overages are limit rows only, so the feature-loss disclosure this
              list can render simply has nothing to show here. */}
          <UsageLimitList blockers={overages} />

          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
