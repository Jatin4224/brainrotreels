/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectCaptionsPage, ROUTE_AUTHORIZATION,
 *   SERVER_PAGE_CLIENT_GALLERY
 *
 * WHAT:  /dashboard/projects/[id]/captions — pick a caption style and time
 *        the captions against the narration.
 * WHY:   SERVER_PAGE_CLIENT_GALLERY, the same split as the voices, script and
 *        preview pages: the page costs no JavaScript of its own, and the
 *        gallery is a client child because it holds filter state and animates
 *        a live preview.
 *
 *        Gated with no code here — ROUTE_AUTHORIZATION in the dashboard
 *        layout matches the pathname against the registry's nav entries,
 *        longest href first, so this inherits `projects` and its `read`
 *        permission. Applying a style and starting an alignment are gated
 *        separately, by `captionStyles:apply` and `captionStyles:align`.
 * WHERE: Linked from the projects list row menu.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { CaptionStudio } from "./_components/caption-studio";

export const metadata: Metadata = {
  title: "Captions",
};

export default async function ProjectCaptionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ContentLayout title="Captions">
      <CaptionStudio projectId={id} />
    </ContentLayout>
  );
}
