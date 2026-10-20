/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectScriptPage, ROUTE_AUTHORIZATION,
 *   SERVER_PAGE_CLIENT_EDITOR
 *
 * WHAT:  /dashboard/projects/[id]/script — write and edit a project's script.
 * WHY:   SERVER_PAGE_CLIENT_EDITOR, the same split as the preview page: the
 *        page is a server component so it costs no JavaScript of its own, and
 *        the editor is a client child because it holds per-block draft state
 *        and drag ordering.
 *
 *        Gated with no code here — ROUTE_AUTHORIZATION in the dashboard layout
 *        matches the pathname against the registry's nav entries, longest href
 *        first, so `/dashboard/projects/...` inherits `projects` and its
 *        default `read` permission. The editor's own mutations are gated
 *        individually by `scripts:*` permissions.
 * WHERE: Linked from the projects list row menu.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { ScriptEditor } from "./_components/script-editor";

export const metadata: Metadata = {
  title: "Script",
};

export default async function ProjectScriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ContentLayout title="Script">
      <ScriptEditor projectId={id} />
    </ContentLayout>
  );
}
