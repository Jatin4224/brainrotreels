"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectStepError, STEP_NAV_SURVIVES_THE_ERROR,
 *   ProjectSteps, useParams, RouteError, ui.project_editor
 *
 * WHAT:  The boundary for the seven project editor steps — script, voices,
 *        visuals, motion, captions, preview and generate.
 *
 * WHY:   STEP_NAV_SURVIVES_THE_ERROR, which is the whole reason this is a
 *        separate boundary and not left to the dashboard one. A customer in
 *        the editor is mid-task with six other steps' work already done. If
 *        the captions step throws and they get the dashboard's generic panel,
 *        the step nav disappears and the only visible route out is "back to
 *        dashboard" — which reads as "your project is gone". Keeping
 *        ProjectSteps rendered means a broken step is one broken step: they
 *        click Preview and carry on.
 *
 *        `useParams` rather than a prop, because Next does not pass route
 *        params to an error boundary. It is read defensively — the boundary
 *        must render even if the thing that failed WAS the route — and the
 *        step nav is simply omitted when there is no usable id, rather than
 *        risking a second throw inside the error page.
 *
 * WHERE: Rendered by Next.js for any throw under
 *        src/app/(dashboard)/dashboard/projects/[id].
 */

import { useParams } from "next/navigation";

import { ContentLayout } from "@/components/global/page-header";
import { ProjectSteps } from "@/components/global/project-steps";
import { RouteError } from "@/components/global/route-error";

export default function ProjectStepError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ id: string }>();
  /* A catch-all segment would hand back an array, and a failed route can hand
     back nothing at all — both are "no step nav", never a crash. */
  const projectId = typeof params.id === "string" ? params.id : null;

  return (
    <ContentLayout title="Something went wrong">
      {projectId !== null ? <ProjectSteps projectId={projectId} /> : null}
      <RouteError
        error={error}
        reset={reset}
        logger="ui.project_editor"
        title="This step could not be loaded"
        description="The rest of your project is unaffected — try again, or move to another step above."
        {...(projectId !== null
          ? {}
          : { action: { href: "/dashboard/projects", label: "Back to projects" } })}
      />
    </ContentLayout>
  );
}
