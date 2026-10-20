/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SettingsIndexPage
 *
 * WHAT:  /dashboard/settings — redirects to the first settings sub-page.
 * WHY:   Settings has no landing of its own; billing is the default tab.
 * WHERE: Sub-pages: organization, billing, audit-logs.
 */

import { redirect } from "next/navigation";

export default function SettingsIndexPage() {
  redirect("/dashboard/settings/billing");
}
