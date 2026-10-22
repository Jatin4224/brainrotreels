/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PortalModerationPage, FLAGGED_QUEUE
 *
 * WHAT:  /portal/videos/moderation — the content-safety decision log and the
 *        review queue for items held back from use.
 * WHY:   The phase's flagged-moderation queue. It is a nested route under
 *        `videos` rather than a top-level one because it is the thing an
 *        operator opens FROM the operations console: the console's "awaiting
 *        review" figure is the count, and this is the list behind it.
 *
 *        Inherits the (portal) layout's platform-admin gate, so there is no
 *        authorization code here.
 * WHERE: Linked from PORTAL_NAV and from the console's queue panel.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { ModerationQueue } from "./_components/moderation-queue";

export const metadata: Metadata = {
  title: "Moderation",
};

export default function PortalModerationPage() {
  return (
    <ContentLayout title="Moderation">
      <ModerationQueue />
    </ContentLayout>
  );
}
