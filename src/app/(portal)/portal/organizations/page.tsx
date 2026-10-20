/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PortalOrganizationsPage
 *
 * WHAT:  /portal/organizations — every tenant organization.
 * WHERE: Gated by the (portal) layout.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { PortalOrganizations } from "./_components/portal-organizations";

export const metadata: Metadata = {
  title: "Organizations",
};

export default function PortalOrganizationsPage() {
  return (
    <ContentLayout title="Organizations">
      <PortalOrganizations />
    </ContentLayout>
  );
}
