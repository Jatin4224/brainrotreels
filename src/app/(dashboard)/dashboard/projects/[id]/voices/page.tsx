/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectVoicesPage, ROUTE_AUTHORIZATION,
 *   SERVER_PAGE_CLIENT_PICKER
 *
 * WHAT:  /dashboard/projects/[id]/voices — cast the speakers and narrate.
 * WHY:   SERVER_PAGE_CLIENT_PICKER, the same split as the preview and script
 *        pages: the page costs no JavaScript of its own, and the picker is a
 *        client child because it holds filter state and plays audio.
 *
 *        Gated with no code here — ROUTE_AUTHORIZATION in the dashboard layout
 *        matches the pathname against the registry's nav entries, longest href
 *        first, so this inherits `projects` and its `read` permission. The
 *        assignment mutation is gated separately by `voices:assign`.
 * WHERE: Linked from the projects list row menu.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { VoiceCasting } from "./_components/voice-casting";

export const metadata: Metadata = {
  title: "Voices",
};

export default async function ProjectVoicesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ContentLayout title="Voices">
      <VoiceCasting projectId={id} />
    </ContentLayout>
  );
}
