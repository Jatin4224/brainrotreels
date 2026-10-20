/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: BillingSettingsPage
 *
 * WHAT:  /dashboard/settings/billing — plan, payment methods, cancel/upgrade.
 * WHERE: RESOURCES.billing.nav.href. Server shell + provider-aware client.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { BillingScreen } from "@/components/global/providers/server";

export const metadata: Metadata = {
  title: "Billing",
};

export default function BillingSettingsPage() {
  return (
    <ContentLayout title="Billing">
      <BillingScreen />
    </ContentLayout>
  );
}
