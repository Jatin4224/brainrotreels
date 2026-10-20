/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: media-upload barrel, MediaUpload, useMediaUpload,
 *   validateFileForUpload
 *
 * WHAT:  Public surface of the upload component.
 * WHY:   The hook is exported alongside the component for the surface that
 *        needs the state but not the drop zone — a wizard step with its own
 *        layout, in Phase 13. Prefer <MediaUpload>: it carries the plan gate,
 *        the accept list and the refusal copy, and a second drop zone written
 *        against the hook would have to re-derive all three.
 * WHERE: Imported as '@/components/global/media-upload'.
 */

export { MediaUpload, type MediaUploadProps } from "./media-upload";
export {
  useMediaUpload,
  validateFileForUpload,
  type UploadItem,
  type UploadItemStatus,
  type UseMediaUploadOptions,
  type UseMediaUploadResult,
} from "./use-media-upload";
