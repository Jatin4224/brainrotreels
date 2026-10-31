/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: scene barrel, layoutScene, checkScene, parseScene,
 *   toSceneSpec, fromSceneSpec, measureLineWidth, fitTextRun, layoutGraph,
 *   ISOMORPHIC_PURE_MODULE, SCENE_ENGINE_SURFACE
 *
 * WHAT:  The public surface of the motion scene engine — parse a scene, lay it
 *        out, check it, and convert it to and from the form a timeline
 *        document stores.
 *
 * WHY:   ISOMORPHIC_PURE_MODULE, the same property src/lib/timeline/ holds and
 *        for the same reason. Nothing under src/lib/scene/ imports Prisma,
 *        `server-only`, a Node built-in or the `remotion` package, so the SAME
 *        `checkScene` runs in the browser editor, in Vitest, on the Inngest
 *        worker and inside a Remotion component. That is what makes the
 *        overflow warning the editor shows and the refusal the server issues
 *        the same answer rather than two implementations that agree today.
 *        It is enforced by purity.test.ts, not by convention.
 *
 *        SCENE_ENGINE_SURFACE: importers use this barrel rather than the
 *        individual files, so the internal split — measure, runs, layouts,
 *        flow, check, document — stays free to change. `metrics-data.ts` is
 *        deliberately NOT exported: it is generated data with one legitimate
 *        reader (measure.ts), and a second reader is how an encoded string
 *        ends up being parsed twice in two ways.
 *
 *        The VOCABULARY is not re-exported either. Types live in
 *        `@/lib/types/scene` exclusively, per CLAUDE.md, and a barrel that
 *        re-exported them would give every type two import paths and make the
 *        rule unenforceable.
 *
 * WHERE: src/remotion/components/ (16b), the gallery route (16b), the style
 *        library (16c), and Phase 16d's designer, storyboard and repair loop.
 */

export { elementWindowSeconds, resolveSceneAnchors } from "./anchors";
export type { ElementWindow } from "./anchors";
export { checkScene } from "./check";
export { parseScene, toSceneSpec, fromSceneSpec } from "./document";
export type { ParsedScene } from "./document";
export { layoutGraph } from "./flow";
export { GALLERY_SCENES } from "./gallery";
export { layoutScene, safeRectFor, layoutSlotRule } from "./layouts";
export {
  fitTextRun,
  lineHeightPx,
  measureBlock,
  measureLineWidth,
  roleFontPx,
  wrapText,
} from "./measure";
export type { MeasuredBlock } from "./measure";
export {
  elementTextRuns,
  formatCounterValue,
  formatMeterPercent,
} from "./runs";
