/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PROJECT_STEPS, ProjectStepDefinition,
 *   ProjectStepKey, projectStepHref, ONE_LIST_OF_STEPS, THE_FLOW_IS_AN_ORDER
 *
 * WHAT:  Every per-project screen, in the order a customer works through them,
 *        with the label, icon, URL segment and feature gate each one carries.
 *
 * WHY:   ONE_LIST_OF_STEPS. Two surfaces need these facts — the step nav on
 *        each project screen and the `⋯` menu on the projects table — and
 *        before this they were only in the menu, written out item by item. A
 *        nav with its own copy is how the two come to disagree about a renamed
 *        route or a missing gate, and the symptom is a dead link rather than a
 *        build error.
 *
 *        THE_FLOW_IS_AN_ORDER, and it is this one: a script is written, its
 *        speakers are cast from it, the captions are timed against the
 *        recorded narration, the run assembles all of it, and the result is
 *        previewed and then adjusted. Each step depends on the one before, so
 *        the array order is the dependency order and the nav simply renders it.
 *
 *        The row menu deliberately uses a DIFFERENT order (preview first,
 *        because watching is not editing; generate last, because it is the one
 *        button that does everything) and keeps it by naming its own sequence
 *        of keys. That is an ordering, not a second definition — the labels,
 *        routes, icons and gates still live here only.
 *
 *        `inFlow: false` marks a screen that is reachable but is not a step
 *        anybody walks through. `motion` is the only one: it is a primitive
 *        gallery plus a beat strip for a format that has no script writer yet
 *        (A_FORMAT_NEEDS_A_WRITER in src/lib/types/project.ts), so putting it
 *        in the walkthrough would advertise a path that cannot complete.
 *
 *        Plain data with no "use client": the nav is a client component and the
 *        row menu is too, but nothing here is, so a server component could
 *        render a link from it without pulling either in.
 * WHERE: src/components/global/project-steps/project-steps.tsx renders the
 *        nav from it; the projects table's row menu builds its items from it.
 */

import {
  CaptionsIcon,
  FileTextIcon,
  MicIcon,
  PlayIcon,
  ScissorsIcon,
  ShapesIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

import type { ResourceKey } from "@/lib/resources";

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectStepSegment, TYPED_ROUTE_GUARANTEE
 *
 * The path segments, as a literal union rather than `string`. That is what
 * keeps TYPED_ROUTE_GUARANTEE working at the call sites: `next.config.ts` has
 * `typedRoutes: true`, so an href is checked against the real route tree, and
 * a `segment: string` would widen the template to something unverifiable and
 * have to be cast. With the union, renaming a page directory fails the build
 * here instead of shipping a dead tab.
 */
export type ProjectStepSegment =
  | "script"
  | "voices"
  | "captions"
  | "generate"
  | "preview"
  | "edit"
  | "motion";

export interface ProjectStepDefinition {
  key: string;
  /** Shown in the nav and the row menu — the same word in both. */
  label: string;
  /** The path segment under `/dashboard/projects/[id]/`. */
  segment: ProjectStepSegment;
  icon: LucideIcon;
  /**
   * The registry resource whose gate gates this screen, when one does.
   * LOCKED_NOT_HIDDEN — a gated step is still rendered, and selecting it opens
   * the upgrade modal rather than vanishing from the nav.
   */
  gate?: ResourceKey;
  /** Part of the ordered walkthrough. See the file header. */
  inFlow: boolean;
}

export const PROJECT_STEPS: readonly ProjectStepDefinition[] = [
  {
    key: "script",
    label: "Script",
    segment: "script",
    icon: FileTextIcon,
    inFlow: true,
  },
  {
    key: "voices",
    label: "Voices",
    segment: "voices",
    icon: MicIcon,
    inFlow: true,
  },
  {
    key: "captions",
    label: "Captions",
    segment: "captions",
    icon: CaptionsIcon,
    inFlow: true,
  },
  {
    key: "generate",
    label: "Generate",
    segment: "generate",
    icon: SparklesIcon,
    inFlow: true,
  },
  {
    key: "preview",
    label: "Preview",
    segment: "preview",
    icon: PlayIcon,
    inFlow: true,
  },
  {
    key: "edit",
    label: "Edit timeline",
    segment: "edit",
    icon: ScissorsIcon,
    gate: "timelineEditor",
    inFlow: true,
  },
  {
    key: "motion",
    label: "Motion primitives",
    segment: "motion",
    icon: ShapesIcon,
    inFlow: false,
  },
];

export type ProjectStepKey = (typeof PROJECT_STEPS)[number]["key"];

/* No `projectStepHref` helper on purpose. A function returning `string` widens
 * the href past what `typedRoutes` can check, so every consumer would need a
 * cast — the opposite of the guarantee. Each call site writes the template
 * inline with `step.segment`, exactly as every other link to a project route
 * in this app already does, and the literal union above is what makes that
 * verifiable. */

/** The walkthrough, in dependency order. See THE_FLOW_IS_AN_ORDER. */
export const PROJECT_FLOW_STEPS: readonly ProjectStepDefinition[] =
  PROJECT_STEPS.filter((step) => step.inFlow);
