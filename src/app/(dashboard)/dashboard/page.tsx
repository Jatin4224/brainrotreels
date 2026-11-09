/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: DashboardHomePage, HOME_IS_A_FORMAT_PICKER,
 *   DashboardHomeScreen, PlanSetupCard, ContentLayout
 *
 * WHAT:  Dashboard landing page — the format picker a creator arrives at
 *        after signing in.
 * WHY:   HOME_IS_A_FORMAT_PICKER. This page used to be the template's
 *        placeholder: a card telling the OPERATOR to declare features in the
 *        registry, shown to the CUSTOMER. The question somebody actually
 *        opens this app with is "what am I making today", so the screen is
 *        now the answer to that, driven by the `FORMATS` registry.
 *        Stays a thin server shell — the picker owns the filter state and the
 *        create sheet, so everything interactive is in one client component
 *        and the page itself ships no JavaScript of its own.
 *        `width="full"`: the picker's grid is the content, and the 945px cap
 *        that suits settings forms would strand a three-column card grid in
 *        the middle of a wide monitor.
 * WHERE: Route /dashboard under the (dashboard) layout.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { PlanSetupCard } from "@/components/global/plan-setup-card";

import { DashboardHomeScreen } from "./_components";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DashboardHomePage() {
  return (
    <ContentLayout title="Home" width="full">
      {/* POST_SIGNUP_PLAN_STEP — the plan choice that used to be step two of
          onboarding. Renders nothing once dismissed or on a paid plan. */}
      <PlanSetupCard />
      <DashboardHomeScreen />
    </ContentLayout>
  );
}
