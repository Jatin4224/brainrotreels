/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: FootagePage, SERVER_PAGE_CLIENT_STUDIO,
 *   ROUTE_AUTHORIZATION
 *
 * WHAT:  /dashboard/footage — generate video clips from a prompt, and the
 *        library of the ones this workspace has made.
 * WHY:   SERVER_PAGE_CLIENT_STUDIO, the same split as every other studio
 *        screen: the page costs no JavaScript of its own, and the studio is a
 *        client child because it holds a form, a cost preview and a grid that
 *        polls while a clip is being made.
 *
 *        Gated with no code here — ROUTE_AUTHORIZATION in the dashboard layout
 *        matches the pathname against the registry's nav entries. The
 *        `aiFootage` entry is a LIMIT rather than a flag, so the screen is
 *        reachable on every plan and refuses at the point of spending: a free
 *        workspace sees what the feature is and is told its allowance is zero,
 *        which is the upgrade conversation rather than a missing menu item.
 * WHERE: RESOURCES.aiFootage.nav.href.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { FootageStudio } from "./_components/footage-studio";

export const metadata: Metadata = {
  title: "AI footage",
};

export default function FootagePage() {
  return (
    <ContentLayout title="AI footage" width="lg">
      <FootageStudio />
    </ContentLayout>
  );
}
