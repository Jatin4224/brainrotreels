/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectsPage, RESOURCES.projects.nav
 *
 * WHAT:  /dashboard/projects — the workspace's videos.
 * WHY:   `width="full"` because the table carries six columns and a row menu;
 *        the default column would force the status and date columns to wrap on
 *        a laptop. The opt-out is explicit per the ContentLayout contract.
 * WHERE: RESOURCES.projects.nav.href in src/lib/resources.ts puts this in the
 *        sidebar. The create button is passed as a header action.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { CreateProjectButton } from "./_components/create-project-button";
import { ProjectsTable } from "./_components/projects-table";

export const metadata: Metadata = {
  title: "Projects",
};

export default function ProjectsPage() {
  return (
    <ContentLayout
      title="Projects"
      width="full"
      actions={<CreateProjectButton />}
    >
      <ProjectsTable />
    </ContentLayout>
  );
}
