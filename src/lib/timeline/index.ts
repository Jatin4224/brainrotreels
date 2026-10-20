/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: timeline barrel, validate, migrate, apply,
 *   resolveWordAnchors, hashDoc, TimelineDoc, Op, ValidationError,
 *   ISOMORPHIC_PURE_MODULE
 *
 * WHAT:  The public surface of the timeline module — the six functions in the
 *        contract, the document types, and the op vocabulary.
 * WHY:   ISOMORPHIC_PURE_MODULE. Nothing under src/lib/timeline/ imports Prisma,
 *        `server-only`, or a Node built-in, which is what lets the SAME apply()
 *        run in the browser editor and on the server. A single import here of
 *        anything server-side would break that silently — it is enforced by
 *        purity.test.ts, not by convention.
 *        Importers use this barrel rather than the individual files so the
 *        internal split (time.ts, errors.ts) stays free to change.
 * WHERE: Imported as '@/lib/timeline' by the projects router, the generators
 *        (Phase 06), the Remotion compositions (Phase 03) and the editor
 *        (Phase 15).
 */

export { TIMELINE_DOC_VERSION, RENDER_KINDS, TRACK_TYPES } from "./schema";
export type {
  TimelineDoc,
  Track,
  TrackType,
  TrackItem,
  VideoItem,
  SceneItem,
  AudioItem,
  CaptionItem,
  OverlayItem,
  VideoTrack,
  SceneTrack,
  AudioTrack,
  CaptionTrack,
  OverlayTrack,
  WordToken,
  WordAnchor,
  TimeValue,
  TimingMode,
  CanvasSpec,
  StyleSpec,
  SceneSpec,
  SceneElement,
  NormalizedBox,
  RenderKind,
  Speaker,
  AssetRef,
} from "./schema";
export {
  timelineDocSchema,
  wordTokenSchema,
  wordAnchorSchema,
  trackSchema,
  assetRefSchema,
  speakerSchema,
  canvasSpecSchema,
  styleSpecSchema,
} from "./schema";

export { validate } from "./validate";
export {
  migrate,
  tryMigrate,
  TimelineMigrationError,
  MIGRATIONS,
} from "./migrate";
export type { MigrationStep } from "./migrate";
export { apply, opSchema, itemPatchSchema } from "./ops";
export type { Op, ItemPatch } from "./ops";
export {
  resolveWordAnchors,
  hasUnresolvedAnchors,
  snapToFrame,
} from "./anchors";
export {
  hashDoc,
  canonicalize,
  stableStringify,
  CACHE_IRRELEVANT_FIELDS,
} from "./hash";

export { TIMELINE_ERROR_CODES, timelineError } from "./errors";
export type {
  ValidationError,
  ValidationResult,
  TimelineErrorCode,
} from "./errors";

export {
  TIME_EPSILON,
  SPINE_TRACKS,
  documentLength,
  itemSpan,
  captionRangeSeconds,
  resolveTimeValue,
  isSeconds,
  isWordAnchor,
  iterateItems,
  roundSeconds,
  secondsToFrames,
  framesToSeconds,
  cloneDoc,
} from "./time";
export type { TimelineItemRef } from "./time";
