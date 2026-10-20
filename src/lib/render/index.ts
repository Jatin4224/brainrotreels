/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: render barrel, planComposition, planTimeline,
 *   planFrame, collectAssetHandles, PLAN_IS_PURE
 *
 * WHAT:  Public surface of the render-planning module.
 * WHY:   Everything here is PURE — no Remotion, no React, no database, no
 *        storage. That is the property to preserve when adding to this folder:
 *        it is what lets the frame maths be unit-tested without a browser, and
 *        what lets Phase 15's editor and Phase 04's pre-flight both import it.
 *        Signing, which needs the database and the bucket, deliberately lives
 *        in src/services/assets.service.ts instead.
 * WHERE: Imported by src/remotion/*, src/trpc/routers/projects.ts, and the
 *        tests beside the implementation.
 */

export { DUCK_LEVEL, DUCK_RAMP_SECONDS, duckingVolumeAt } from "./ducking";
export type { FrameWindow } from "./ducking";
export { RENDER_KEY_VERSION, renderCacheKey } from "./cache-key";
export type { RenderCacheInputs } from "./cache-key";
export { dropUnknownRenderKinds } from "./sanitise";
export type { SanitiseResult } from "./sanitise";
export {
  LAYER_ORDER,
  collectAssetHandles,
  planComposition,
  planFrame,
  planTimeline,
} from "./frame-plan";
export type { CompositionPlan, PlannedItem } from "./frame-plan";
