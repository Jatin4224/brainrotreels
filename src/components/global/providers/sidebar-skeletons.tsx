/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SidebarEntrySkeleton, SIDEBAR_ENTRY_HEIGHT,
 *   NO_LAYOUT_SHIFT
 *
 * WHAT:  The fixed-height placeholder used by every sidebar-slot surface (org
 *        switcher, user menu) while its data resolves.
 * WHY:   NO_LAYOUT_SHIFT — both slots sit in the sidebar's header and footer, so
 *        rendering `null` while loading collapses the row and the whole sidebar
 *        jumps when it fills in. The placeholder reserves the EXACT height of the
 *        large sidebar menu button (`size="lg"` ⇒ h-12), so the swap is a
 *        cross-fade rather than a reflow.
 *        Shared by every provider on purpose: the reserved height is a property
 *        of the sidebar layout, not of whoever fills the slot, and duplicating
 *        it per provider is how the copies drift apart.
 * WHERE: Used by the org-switcher and user-menu implementations in
 *        ./<provider>/* — ./better-auth/* today.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";

/* Matches SidebarMenuButton size="lg" (h-12) so nothing reflows on swap. */
export const SIDEBAR_ENTRY_HEIGHT = "h-12";

export function SidebarEntrySkeleton() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className={`flex ${SIDEBAR_ENTRY_HEIGHT} items-center gap-2 px-2`}>
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
