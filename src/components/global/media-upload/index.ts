/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
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

export { MediaUpload, type MediaUploadProps } from './media-upload'
export {
  useMediaUpload,
  validateFileForUpload,
  type UploadItem,
  type UploadItemStatus,
  type UseMediaUploadOptions,
  type UseMediaUploadResult,
} from './use-media-upload'
