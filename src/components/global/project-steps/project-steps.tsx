/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectSteps, PROJECT_FLOW_STEPS, StepLink,
 *   EVERY_SCREEN_KNOWS_THE_WAY_OUT, LOCKED_NOT_HIDDEN,
 *   CURRENT_COMES_FROM_THE_URL, TYPED_ROUTE_GUARANTEE
 *
 * WHAT:  The step nav every per-project screen renders under its title: a back
 *        link to the projects list, then one tab per step in the walkthrough
 *        with the current one marked.
 *
 * WHY:   EVERY_SCREEN_KNOWS_THE_WAY_OUT. Before this there was NO link between
 *        the project screens at all — no `projects/[id]` index page, a plain
 *        text title cell, an inert table row, and not one `Link` across the
 *        script, voices, captions or motion screens. Getting from Script to
 *        Voices meant going back to the sidebar, finding the row again and
 *        reopening the `⋯` menu, once per step, for every step. The pipeline
 *        was navigable only through a dropdown, which is why the walkthrough
 *        read as six round trips.
 *
 *        CURRENT_COMES_FROM_THE_URL rather than a prop. Seven pages render this
 *        and a `current="script"` prop is seven chances to pass the wrong one —
 *        the pathname already knows, and a page that moves keeps working. The
 *        match is on the trailing segment, so it cannot be fooled by a project
 *        id that happens to contain a step's name.
 *
 *        LOCKED_NOT_HIDDEN for a gated step: `edit` stays in the nav on a plan
 *        without the timeline editor and opens the upgrade modal when selected,
 *        exactly as the same item does in the row menu. Removing it would hide
 *        that the feature exists, and the route refuses server-side regardless
 *        (GATE_IS_THE_WHOLE_ROUTER).
 *
 *        Rendered inside each page's ContentLayout rather than added as a slot
 *        on it: the chrome is shared by every dashboard page including the ones
 *        with no steps, and a nav prop there would be `undefined` on most of
 *        them.
 * WHERE: Rendered at the top of each src/app/(dashboard)/dashboard/projects/
 *        [id]/*//*page.tsx. Steps come from ./steps.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { FeatureGate } from "@/components/feature-gate";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  PROJECT_FLOW_STEPS,
  type ProjectStepDefinition,
} from "./steps";

export function ProjectSteps({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  /* The LAST segment is the step. Taken from the end rather than matched
   * anywhere in the path, so a project id containing "edit" cannot light up
   * the wrong tab. */
  const currentSegment = pathname.split("/").filter(Boolean).pop() ?? "";

  return (
    <nav
      aria-label="Project steps"
      className="flex flex-wrap items-center gap-1"
    >
      <Link
        href="/dashboard/projects"
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Projects
      </Link>

      <Separator orientation="vertical" className="mx-1 h-5" />

      {PROJECT_FLOW_STEPS.map((step) => (
        <StepLink
          key={step.key}
          step={step}
          projectId={projectId}
          current={step.segment === currentSegment}
        />
      ))}
    </nav>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: StepLink, LOCKED_NOT_HIDDEN
 *
 * One tab. Split out because the gated case has to wrap the SAME element —
 * FeatureGate clones its single child and intercepts its onClick, so the link
 * cannot be conditionally shaped around it without rendering two variants of
 * the markup and letting them drift.
 */
function StepLink({
  step,
  projectId,
  current,
}: {
  step: ProjectStepDefinition;
  projectId: string;
  current: boolean;
}) {
  const Icon = step.icon;

  const link = (
    <Link
      href={`/dashboard/projects/${projectId}/${step.segment}`}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        current
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {step.label}
    </Link>
  );

  if (step.gate === undefined) return link;

  return <FeatureGate resource={step.gate}>{link}</FeatureGate>;
}
