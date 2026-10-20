/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: media barrel, planVariants, assertSupportedMedia,
 *   withStagingDir, VERTICAL_MASTER, PROXY
 *
 * WHAT:  Public surface of the media-ingest module.
 * WHY:   Split in two halves on purpose, and the split is the reason this
 *        barrel is worth reading before importing from it: ./ingest-plan is
 *        PURE and unit-tested, ./staging is server-only and does I/O. A caller
 *        that only needs a decision (which variants, is this codec supported)
 *        must import the plan directly rather than through here, or it drags
 *        `server-only` and the storage adapter into its graph.
 * WHERE: Imported by src/inngest/functions/asset-ingest.ts, the one caller that
 *        genuinely needs both halves.
 */

export {
  PROXY,
  SUPPORTED_AUDIO_CODECS,
  SUPPORTED_VIDEO_CODECS,
  THUMB_WIDTH,
  UnsupportedMediaError,
  VERTICAL_MASTER,
  WAVEFORM_SIZE,
  assertSupportedMedia,
  fitForKind,
  planVariants,
  posterTimeFor,
} from "./ingest-plan";
export type { VariantPlan } from "./ingest-plan";
export {
  MEDIA_STAGING_PREFIX,
  downloadToFile,
  downloadUrlToFile,
  uploadFile,
  withStagingDir,
} from "./staging";
export type { StagingDir } from "./staging";
