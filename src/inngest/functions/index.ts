/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: INNGEST_FUNCTIONS, workflow registry, serve
 *
 * WHAT:  Every workflow this app serves, in one list.
 * WHY:   The serve route needs an explicit array — a function missing from it
 *        is silently never invoked, and the symptom is an event that vanishes
 *        rather than an error. One registry makes that omission visible in
 *        review. Add a workflow here in the same change that defines it.
 * WHERE: Consumed by src/app/api/inngest/route.ts.
 */

import { assetIngestFunction } from "./asset-ingest";
import { costAlertFunction } from "./cost-alert";
import { creditsReconcileFunction } from "./credits-reconcile";
import { helloFunction } from "./hello";
import { lineResynthFunction } from "./line-resynth";
import { projectAlignFunction } from "./project-align";
import { projectGenerateFunction } from "./project-generate";
import { projectRenderFunction } from "./project-render";
import { projectTtsFunction } from "./project-tts";
import { scriptGenerateFunction } from "./script-generate";
import { usageResetFunction } from "./usage-reset";

export const INNGEST_FUNCTIONS = [
  helloFunction,
  usageResetFunction,
  assetIngestFunction,
  projectRenderFunction,
  creditsReconcileFunction,
  scriptGenerateFunction,
  projectTtsFunction,
  lineResynthFunction,
  projectAlignFunction,
  projectGenerateFunction,
  costAlertFunction,
];
