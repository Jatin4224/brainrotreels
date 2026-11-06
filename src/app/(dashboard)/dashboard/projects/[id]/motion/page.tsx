/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectMotionPage, ROUTE_AUTHORIZATION,
 *   SERVER_PAGE_CLIENT_GALLERY, GALLERY_IS_THE_REVIEW_SURFACE,
 *   TWO_REVIEW_SURFACES_ONE_ROUTE
 *
 * WHAT:  /dashboard/projects/[id]/motion — THIS project's designed beats, and
 *        beneath them the primitive gallery: every primitive in every layout,
 *        in every palette, at both aspects.
 *
 * WHY:   TWO_REVIEW_SURFACES_ONE_ROUTE, and the order is the point. The beat
 *        strip answers "is my video any good", which is what somebody arrives
 *        asking; the gallery answers "is the LIBRARY any good", which is the
 *        question behind a bad answer to the first one. Putting them on one
 *        screen means a reviewer who finds a cluttered beat can tell in the
 *        same scroll whether the primitive is at fault or the design is.
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
import { ProjectSteps } from "@/components/global/project-steps";
import { BeatStrip } from "./_components/beat-strip";
import { MotionGallery } from "./_components/motion-gallery";

export const metadata: Metadata = {
  title: "Motion",
};

export default async function ProjectMotionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ContentLayout title="Motion" width="lg">
      <ProjectSteps projectId={id} />
      <div className="flex flex-col gap-8">
        <BeatStrip projectId={id} />
        <MotionGallery />
      </div>
    </ContentLayout>
  );
}
