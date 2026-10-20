/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: CreditsSettingsPage, ROUTE_AUTHORIZATION
 *
 * WHAT:  /dashboard/settings/credits — the balance, the top-up packs, and the
 *        ledger that explains every movement.
 * WHY:   A server component with client children, as every other settings
 *        screen is: the page itself costs no JavaScript, and the pieces that
 *        need the active organization resolve it client-side the way they do
 *        everywhere else.
 *
 *        Gated without any code here — ROUTE_AUTHORIZATION in the dashboard
 *        layout matches the pathname against the registry's nav entries, so
 *        this route inherits `credits:read` from RESOURCES.credits.nav. A
 *        per-page check would be a second source of truth for one rule.
 * WHERE: RESOURCES.credits.nav.href.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { CreditsScreen } from "./_components/credits-screen";

export const metadata: Metadata = {
  title: "Credits",
};

export default function CreditsSettingsPage() {
  return (
    <ContentLayout title="Credits">
      <CreditsScreen />
    </ContentLayout>
  );
}
