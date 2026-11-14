/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectIndexPage, SCRIPT_IS_THE_FIRST_STEP,
 *   PROJECT_FLOW_STEPS, EVERY_SCREEN_KNOWS_THE_WAY_OUT
 *
 * WHAT:  /dashboard/projects/[id] — redirects to the first step of the
 *        walkthrough.
 *
 * WHY:   SCRIPT_IS_THE_FIRST_STEP, and every other entry point into a project
 *        already agrees on it: the table's title cell links to `/script`, the
 *        create sheet pushes to `/script` after a project is made, and `script`
 *        is the first entry in PROJECT_FLOW_STEPS. The bare id was the one
 *        address that did not resolve — it 404'd — so a truncated URL, a hand-
 *        typed one, or a link from anywhere that drops the step segment landed
 *        on a not-found page for a project that exists.
 *
 *        A REDIRECT rather than a hub screen. A landing page here would be a
 *        fourth answer to "where does a project open", competing with the three
 *        that already send people to the same place, and the step nav
 *        (EVERY_SCREEN_KNOWS_THE_WAY_OUT) is already rendered on every step —
 *        so there is nothing a hub would show that the first step does not.
 *        Mirrors /dashboard/settings, which redirects to its default tab for
 *        the same reason.
 *
 *        Deliberately does NOT verify the project exists first. The step page
 *        resolves it and renders the real not-found / forbidden state; querying
 *        here as well would double the work on the happy path to improve the
 *        error message on a path the step page already handles.
 * WHERE: Sub-pages are the segments in PROJECT_FLOW_STEPS
 *        (src/components/global/project-steps/steps.ts).
 */

import { redirect } from "next/navigation";

export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/projects/${id}/script`);
}
