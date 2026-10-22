/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PortalVideosPage, VIDEO_OPERATIONS
 *
 * WHAT:  /portal/videos — the video-operations console: volume, reliability,
 *        render speed, economics, provider health and queue depth.
 * WHY:   Added to the EXISTING platform-admin console rather than built as a
 *        second admin app, which is the phase's explicit instruction. It
 *        inherits the (portal) layout's platform-admin gate, so there is no
 *        authorization code here.
 * WHERE: Linked from PORTAL_NAV in src/components/global/portal/portal-sidebar.tsx.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { VideoOpsConsole } from "./_components/video-ops-console";

export const metadata: Metadata = {
  title: "Video operations",
};

export default function PortalVideosPage() {
  return (
    <ContentLayout title="Video operations">
      <VideoOpsConsole />
    </ContentLayout>
  );
}
