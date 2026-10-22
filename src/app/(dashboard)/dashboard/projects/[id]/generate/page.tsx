/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectGeneratePage, ROUTE_AUTHORIZATION,
 *   SERVER_PAGE_CLIENT_PANEL
 *
 * WHAT:  /dashboard/projects/[id]/generate — start a generation and watch it
 *        happen.
 * WHY:   SERVER_PAGE_CLIENT_PANEL, the same split as the voices, script,
 *        captions and preview pages: the page costs no JavaScript of its own,
 *        and the panel is a client child because it holds a live subscription
 *        and a ticking elapsed clock.
 *
 *        Gated with no code here — ROUTE_AUTHORIZATION in the dashboard layout
 *        matches the pathname against the registry's nav entries, longest href
 *        first, so this inherits `projects` and its `read` permission. STARTING
 *        and CANCELLING a run are gated separately, by `projects:generate` and
 *        `projects:cancel`.
 * WHERE: Linked from the projects list row menu.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { GeneratePanel } from "./_components/generate-panel";

export const metadata: Metadata = {
  title: "Generate",
};

export default async function ProjectGeneratePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ContentLayout title="Generate">
      <GeneratePanel projectId={id} />
    </ContentLayout>
  );
}
