/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectSteps, PROJECT_STEPS, PROJECT_FLOW_STEPS,
 *   ProjectStepDefinition, ProjectStepSegment, ONE_LIST_OF_STEPS
 *
 * WHAT:  Barrel for the per-project step nav and the step list behind it.
 * WHY:   Consumers import `@/components/global/project-steps` and get either
 *        the component or the data without knowing which file holds which —
 *        the pages want the component, the projects table wants the list.
 * WHERE: The seven project screens and the projects table's row menu.
 */

export { ProjectSteps } from "./project-steps";
export { PROJECT_STEPS, PROJECT_FLOW_STEPS } from "./steps";
export type {
  ProjectStepDefinition,
  ProjectStepKey,
  ProjectStepSegment,
} from "./steps";
