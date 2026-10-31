/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectMotionPage, ROUTE_AUTHORIZATION,
 *   SERVER_PAGE_CLIENT_GALLERY, GALLERY_IS_THE_REVIEW_SURFACE
 *
 * WHAT:  /dashboard/projects/[id]/motion — the motion primitive gallery: every
 *        primitive in every layout, in every palette, at both aspects.
 * WHY:   SERVER_PAGE_CLIENT_GALLERY, the same split as the captions, voices,
 *        script and preview pages: the page costs no JavaScript of its own,
 *        and the gallery is a client child because it holds the palette and
 *        aspect choices and animates live previews.
 *
 *        Gated with no code here — ROUTE_AUTHORIZATION in the dashboard
 *        layout matches the pathname against the registry's nav entries,
 *        longest href first, so this inherits `projects` and its `read`
 *        permission. That is deliberately the SAME gate the captions gallery
 *        has: this screen is a review surface over hand-written fixtures and
 *        reads nothing about the project. Designing a motion video is a
 *        different thing and is gated by `motionStudio` when Phase 16d adds
 *        it.
 *
 *        GALLERY_IS_THE_REVIEW_SURFACE — the phase file requires a human to
 *        look at every primitive before any AI is connected, which is why this
 *        exists now rather than with the designer.
 * WHERE: Linked from the projects list row menu, beside Captions.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { MotionGallery } from "./_components/motion-gallery";

export const metadata: Metadata = {
  title: "Motion",
};

export default function ProjectMotionPage() {
  return (
    <ContentLayout title="Motion primitives" width="lg">
      <MotionGallery />
    </ContentLayout>
  );
}
