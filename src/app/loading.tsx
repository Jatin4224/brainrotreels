/**
 * SOURCE OF TRUTH KEYWORDS: RootLoading, LOADING_COVERS_THE_GROUP_LAYOUTS,
 *   LOADING_IS_A_LIVE_REGION, role=status, DashboardLayout
 *
 * WHAT:  The one loading boundary in the app — a centred status indicator
 *        shown while a navigation's layout is still resolving on the server.
 *
 * WHY:   LOADING_COVERS_THE_GROUP_LAYOUTS, and it is at the ROOT for a precise
 *        reason. A `loading.tsx` creates a Suspense boundary around its
 *        segment's CHILDREN, which means a segment's own layout resolves
 *        OUTSIDE it — so `(dashboard)/loading.tsx` would not cover
 *        `(dashboard)/layout.tsx`, and that layout is the only genuinely slow
 *        server work in the app (session, org resolution, permission gating
 *        and five prefetches). Placing the boundary one level up, at the root,
 *        is what puts the group layouts inside it.
 *
 *        There is deliberately NO per-page loading.tsx anywhere else. Every
 *        page in this app is either synchronous or awaits only `params` /
 *        `searchParams`; the data is fetched by client components through tRPC,
 *        which have their own loading states already (DataTable's skeleton
 *        rows, the script editor's "Writing your script…", the usage meter).
 *        A loading.tsx over those would add a flash of placeholder in front of
 *        content that was about to render anyway, and then a SECOND
 *        placeholder underneath it from the component itself.
 *
 *        LOADING_IS_A_LIVE_REGION: `role="status"` with a real label, not a
 *        bare spinner. A spinning glyph announces nothing, so a screen reader
 *        gets silence during exactly the pause a sighted reader is being told
 *        about. `motion-reduce` stops the rotation for anyone who asked for
 *        less movement, matching the Progress indicator's transition.
 *
 * WHERE: Rendered by Next.js during navigation.
 */

import { Loader2Icon } from "lucide-react";

export default function RootLoading() {
  return (
    <div
      role="status"
      className="flex flex-1 items-center justify-center gap-3 px-4 py-24 text-sm text-muted-foreground"
    >
      <Loader2Icon
        aria-hidden="true"
        className="size-4 animate-spin motion-reduce:animate-none"
      />
      Loading…
    </div>
  );
}
