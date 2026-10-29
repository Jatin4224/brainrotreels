/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: RenderPanel barrel
 *
 * WHAT:  The export surface's public entry point.
 * WHY:   Global rather than route-local since Phase 15: the preview screen and
 *        the timeline editor both end in "export this", and the panel already
 *        owns everything that act needs — the per-plan resolution set, the cost
 *        on the button, the watermark notice and the poll. A second copy beside
 *        the editor would have been the same 450 lines with its own drift.
 * WHERE: /dashboard/projects/[id]/preview and /dashboard/projects/[id]/edit.
 */

export { RenderPanel } from "./render-panel";
