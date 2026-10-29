/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectEditPage, ROUTE_AUTHORIZATION,
 *   SERVER_PAGE_CLIENT_EDITOR, FULL_WIDTH_IS_THE_LAYOUT, params promise
 *
 * WHAT:  /dashboard/projects/[id]/edit — the timeline editor.
 * WHY:   SERVER_PAGE_CLIENT_EDITOR, the same split the preview page makes: the
 *        page is a server component so it ships no JavaScript of its own, and
 *        the editor is a client child because it mounts a Remotion player and
 *        drives the document from pointer events.
 *
 *        FULL_WIDTH_IS_THE_LAYOUT — `<ContentLayout width="full">`, which the
 *        phase asks for by name. The tracks run the width of the screen and a
 *        centred column would waste the half of it the ruler needs.
 *
 *        ROUTE_AUTHORIZATION needs no code here: the dashboard layout matches
 *        the pathname against the registry's nav entries, longest href first,
 *        so this path inherits `projects` and its `read` permission. The
 *        EDITOR's own entitlement is enforced where it cannot be bypassed —
 *        every procedure the screen calls is refused for a plan without
 *        `timelineEditor` (GATE_IS_THE_WHOLE_ROUTER), so a free workspace that
 *        reaches this URL gets a screen that cannot load rather than a working
 *        editor.
 *
 *        `params` is awaited: it is a Promise in this version of Next, and the
 *        id is handed to the client component because the queries also need
 *        the ACTIVE ORGANIZATION, which resolves client-side as on every other
 *        screen.
 * WHERE: Linked from the projects list row menu and the preview screen.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { TimelineEditor } from "./_components/timeline-editor";

export const metadata: Metadata = {
  title: "Edit timeline",
};

export default async function ProjectEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ContentLayout title="Edit timeline" width="full">
      <TimelineEditor projectId={id} />
    </ContentLayout>
  );
}
