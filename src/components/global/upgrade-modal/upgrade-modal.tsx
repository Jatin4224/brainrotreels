/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: UpgradeModal, UpgradeModalProps, UpgradeContent,
 *   FullscreenPricing
 *
 * WHAT:  The fullscreen dialog shell around <UpgradeContent />.
 * WHY:   Thin on purpose — the shell owns the portal, the overlay, focus
 *        trapping and the accessible name; the content owns everything else, so
 *        the same flow can render without a dialog at all. Fullscreen because
 *        the decision it asks for is a comparison across every plan and every
 *        feature: in a 500px box that becomes a scroll-and-remember exercise.
 *        The default DialogContent geometry is overridden rather than a second
 *        dialog primitive being introduced, so the app keeps ONE dialog.
 * WHERE: Mounted once by <UpgradeModalProvider /> at the root of the app.
 */

import { cn } from "@/lib/utils";
import type { ResourceKey } from "@/lib/resources";
import type { PlanKey } from "@/lib/config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UpgradeContent } from "./upgrade-content";

export interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** The gated resource, when a gate opened this. */
  resource?: ResourceKey | undefined;
  /** The registry's upgrade sentence for that resource. */
  upgradeMessage?: string | undefined;
  /** Plan to open on; omitted, the content picks the next sensible step. */
  plan?: PlanKey | undefined;
}

export function UpgradeModal({
  open,
  onOpenChange,
  organizationId,
  resource,
  upgradeMessage,
  plan,
}: UpgradeModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          /* Fill the viewport: the shared DialogContent is centred and capped, so
             every one of those defaults has to be undone explicitly. */
          "top-0! left-0! h-dvh! max-h-none! w-screen! max-w-none! translate-x-0! translate-y-0!",
          "sm:max-w-none!",
          "gap-0! rounded-none! bg-background p-0! ring-0! outline-none",
        )}
      >
        {/* The visible header lives in the content and changes per step, so the
            dialog's accessible name is provided here instead. */}
        <DialogHeader className="sr-only">
          <DialogTitle>Change your plan</DialogTitle>
          <DialogDescription>
            Compare plans and upgrade this workspace.
          </DialogDescription>
        </DialogHeader>

        <UpgradeContent
          organizationId={organizationId}
          resource={resource}
          upgradeMessage={upgradeMessage}
          plan={plan}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
