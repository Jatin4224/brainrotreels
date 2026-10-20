/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PortalHomePage
 *
 * WHAT:  /portal home — platform overview stats.
 * WHERE: Gated by the (portal) layout.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { PortalOverview } from "./_components/portal-overview";

export const metadata: Metadata = {
  title: "Platform",
};

export default function PortalHomePage() {
  return (
    <ContentLayout title="Platform overview">
      <PortalOverview />
    </ContentLayout>
  );
}
