/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: useMediaUpload, UploadItem, UploadItemStatus,
 *   XHR_FOR_PROGRESS, CLIENT_SERVER_MIRROR, SEQUENTIAL_UPLOADS,
 *   validateFileForUpload, PUT_EXACTLY_WHAT_WAS_SIGNED
 *
 * WHAT:  The upload state machine: validate, presign, PUT with progress,
 *        confirm, repeat. Owns the per-file list the drop zone renders.
 * WHY:   XHR_FOR_PROGRESS. `fetch` cannot report upload progress — there is no
 *        request-body progress event and no stream-upload support that works
 *        across browsers — so the PUT goes through XMLHttpRequest. That is not
 *        legacy code; it is the only API that can answer "how far through is
 *        this 400 MB file", and without that a video upload is a spinner for
 *        four minutes.
 *
 *        CLIENT_SERVER_MIRROR: the type and size checks here are the SAME
 *        objects the server validates with (CONTENT_TYPE_ALLOWLIST,
 *        maxUploadBytesForPlan from src/lib/types/asset.ts). The point of
 *        checking twice is the message, not the security: rejecting a 2 GB file
 *        before it is uploaded saves the customer the upload, and rejecting it
 *        again server-side is what makes it a rule.
 *
 *        PUT_EXACTLY_WHAT_WAS_SIGNED: the Content-Type header sent is the one
 *        the server echoed back, not `file.type` read a second time. R2 signs
 *        both the type and the length into the URL, so a header that differs by
 *        a character gets a SignatureDoesNotMatch that looks nothing like its
 *        cause.
 *
 *        SEQUENTIAL_UPLOADS: files go one at a time. Parallel uploads look
 *        faster and are not — they share the customer's uplink, so six at once
 *        is six slow bars instead of one fast one — and the ingest workflow is
 *        serialised per workspace anyway, so arriving together buys nothing.
 * WHERE: Consumed by ./media-upload.tsx. Any surface needing uploads should use
 *        that component rather than this hook directly.
 */

import * as React from 'react'

import { trpc } from '@/trpc/react-provider'
import { formatBytes } from '@/lib/resources'
import {
  isUploadContentType,
  type UploadableAssetKind,
  type UploadContentType,
} from '@/lib/types'

export type UploadItemStatus = 'queued' | 'uploading' | 'processing' | 'done' | 'error'

/**
 * SOURCE OF TRUTH KEYWORDS: UploadItem
 *
 * WHAT:  One file's progress through the upload.
 * WHY:   `processing` is a distinct status from `done` and that distinction is
 *        the honest one: the bytes are in the bucket but the asset is not
 *        usable until the ingest workflow has produced its variants. Collapsing
 *        them would show a green tick on a file that cannot yet be put in a
 *        video.
 * WHERE: Rendered as a row by <MediaUpload>.
 */
export interface UploadItem {
  /** Stable across re-renders — a File object is not a usable React key. */
  id: string
  filename: string
  bytes: number
  status: UploadItemStatus
  /** 0–100, meaningful while `uploading`. */
  progress: number
  error: string | null
  /** Set once the asset row exists. */
  assetId: string | null
}

export interface UseMediaUploadOptions {
  organizationId: string
  /** The intent hint; the server re-derives the real kind from the file. */
  kind?: UploadableAssetKind
  /** Largest single file this workspace's plan allows. */
  maxBytes: number
  /** Called after each successful confirmation, for cache invalidation. */
  onUploaded?: (assetId: string) => void
}

/**
 * SOURCE OF TRUTH KEYWORDS: validateFileForUpload, CLIENT_SERVER_MIRROR
 *
 * WHAT:  The client-side half of the upload rules — returns the refusal
 *        sentence, or null when the file is acceptable.
 * WHY:   Exported and pure so the drop zone can also use it to style a dragged
 *        file before it is dropped, and so it can be tested without a browser.
 *        The messages name the actual numbers: "too large" sends a customer to
 *        support, "that file is 2.1 GB and your plan allows 500 MB" does not.
 *        An empty file is checked explicitly because a 0-byte PUT succeeds and
 *        produces an asset that fails ingest for a reason the customer cannot
 *        act on.
 * WHERE: useMediaUpload's enqueue path and <MediaUpload>'s drag feedback.
 */
export function validateFileForUpload(
  file: { name: string; size: number; type: string },
  maxBytes: number
): string | null {
  if (!isUploadContentType(file.type)) {
    return file.type.length === 0
      ? `We could not tell what kind of file "${file.name}" is. Try an MP4, MOV, WebM, JPEG, PNG, WebP, MP3 or WAV.`
      : `${file.type} files are not supported. Try an MP4, MOV, WebM, JPEG, PNG, WebP, MP3 or WAV.`
  }

  if (file.size === 0) {
    return 'That file is empty.'
  }

  if (file.size > maxBytes) {
    return `That file is ${formatBytes(file.size)}. The largest single file on your plan is ${formatBytes(maxBytes)}.`
  }

  return null
}

export interface UseMediaUploadResult {
  items: UploadItem[]
  isUploading: boolean
  /** Adds files and starts uploading. Safe to call while a batch is running. */
  addFiles: (files: readonly File[]) => void
  /** Clears finished rows; leaves anything still in flight. */
  clearFinished: () => void
}

export function useMediaUpload(options: UseMediaUploadOptions): UseMediaUploadResult {
  const { organizationId, kind, maxBytes, onUploaded } = options

  const createUploadUrl = trpc.assets.createUploadUrl.useMutation()
  const completeUpload = trpc.assets.completeUpload.useMutation()

  const [items, setItems] = React.useState<UploadItem[]>([])

  /* The queue lives in a ref, not in state: it is a work list, not something
   * rendered, and keeping it in state would restart the drain effect on every
   * progress tick. */
  const queue = React.useRef<{ item: UploadItem; file: File }[]>([])
  const draining = React.useRef(false)

  const update = React.useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  }, [])

  /* The mutations and the callback are read through a ref inside the drain
   * loop, so a re-render mid-upload cannot swap the function underneath an
   * in-flight batch.
   *
   * Assigned in an EFFECT, not during render. Writing a ref during render is
   * what the react-hooks/refs rule forbids and the React Compiler can break:
   * a render that is thrown away would still have mutated the ref. An effect
   * runs after commit, and the only reader is a loop started by a click or a
   * drop — both of which happen long after the first commit. */
  const latest = React.useRef({ createUploadUrl, completeUpload, onUploaded, organizationId, kind })

  React.useEffect(() => {
    latest.current = { createUploadUrl, completeUpload, onUploaded, organizationId, kind }
  }, [createUploadUrl, completeUpload, onUploaded, organizationId, kind])

  const drain = React.useCallback(async () => {
    if (draining.current) return
    draining.current = true

    try {
      /* SEQUENTIAL_UPLOADS — one file at a time, in the order they were
       * dropped, so the progress bar means something. */
      for (;;) {
        const next = queue.current.shift()
        if (next === undefined) break

        const { item, file } = next
        const contentType = file.type

        if (!isUploadContentType(contentType)) {
          /* Unreachable — addFiles validated it. Kept because the narrowing is
           * what lets the presign call be typed without a cast. */
          update(item.id, { status: 'error', error: 'That file type is not supported.' })
          continue
        }

        try {
          update(item.id, { status: 'uploading', progress: 0 })

          const signed = await latest.current.createUploadUrl.mutateAsync({
            organizationId: latest.current.organizationId,
            filename: file.name,
            contentType: contentType satisfies UploadContentType,
            bytes: file.size,
            ...(latest.current.kind !== undefined ? { kind: latest.current.kind } : {}),
          })

          await putWithProgress({
            url: signed.url,
            file,
            /* PUT_EXACTLY_WHAT_WAS_SIGNED — the server's echo, not file.type. */
            contentType: signed.contentType,
            onProgress: (progress) => update(item.id, { progress }),
          })

          update(item.id, { status: 'processing', progress: 100 })

          const asset = await latest.current.completeUpload.mutateAsync({
            organizationId: latest.current.organizationId,
            storageKey: signed.storageKey,
            filename: file.name,
            contentType: signed.contentType,
            ...(latest.current.kind !== undefined ? { kind: latest.current.kind } : {}),
          })

          update(item.id, { status: 'processing', assetId: asset.id })
          latest.current.onUploaded?.(asset.id)
        } catch (error) {
          update(item.id, {
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'That upload failed. Please try again.',
          })
        }
      }
    } finally {
      draining.current = false
    }
  }, [update])

  const addFiles = React.useCallback(
    (files: readonly File[]) => {
      const accepted: { item: UploadItem; file: File }[] = []
      const rejected: UploadItem[] = []

      for (const file of files) {
        const id = `${file.name}-${file.size}-${crypto.randomUUID()}`
        const refusal = validateFileForUpload(file, maxBytes)
        const base: UploadItem = {
          id,
          filename: file.name,
          bytes: file.size,
          status: 'queued',
          progress: 0,
          error: null,
          assetId: null,
        }

        if (refusal !== null) {
          /* A refused file is still SHOWN, with its reason. Dropping it
           * silently is how someone drags eight files, sees six, and assumes
           * the page is broken. */
          rejected.push({ ...base, status: 'error', error: refusal })
        } else {
          accepted.push({ item: base, file })
        }
      }

      setItems((current) => [...current, ...rejected, ...accepted.map((entry) => entry.item)])
      queue.current.push(...accepted)
      void drain()
    },
    [drain, maxBytes]
  )

  const clearFinished = React.useCallback(() => {
    setItems((current) =>
      current.filter((item) => item.status === 'queued' || item.status === 'uploading')
    )
  }, [])

  const isUploading = items.some(
    (item) => item.status === 'queued' || item.status === 'uploading'
  )

  return { items, isUploading, addFiles, clearFinished }
}

/**
 * SOURCE OF TRUTH KEYWORDS: putWithProgress, XHR_FOR_PROGRESS
 *
 * WHAT:  PUTs a file to a presigned URL, reporting progress.
 * WHY:   See XHR_FOR_PROGRESS in the file header — this is the one thing fetch
 *        cannot do. The response body is not read: a presigned PUT returns an
 *        empty 200, and the status is the whole answer. A non-2xx is reported
 *        with its status because the two realistic failures look different and
 *        need different advice — 403 is an expired or mismatched signature
 *        (retry the presign), 400 is usually a length or type mismatch.
 * WHERE: useMediaUpload's drain loop.
 */
function putWithProgress(args: {
  url: string
  file: File
  contentType: string
  onProgress: (progress: number) => void
}): Promise<void> {
  const { url, file, contentType, onProgress } = args

  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url, true)
    request.setRequestHeader('Content-Type', contentType)

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      /* Capped at 99 while the request is open: the last percent is the
       * server's acknowledgement, and a bar that sits at 100% for three seconds
       * reads as a hang. */
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
    })

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve()
        return
      }
      reject(
        new Error(
          request.status === 403
            ? 'That upload link expired before the file finished. Please try again.'
            : `The upload was rejected (${request.status}). Please try again.`
        )
      )
    })

    request.addEventListener('error', () =>
      reject(new Error('The connection dropped during the upload. Please try again.'))
    )
    request.addEventListener('abort', () => reject(new Error('That upload was cancelled.')))

    request.send(file)
  })
}
