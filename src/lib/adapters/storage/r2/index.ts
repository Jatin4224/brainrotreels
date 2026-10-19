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
 * SOURCE OF TRUTH KEYWORDS: r2StorageAdapter, StorageAdapter, signedPutUrl,
 *   signedGetUrl, ContentLength signing, DELETE_BATCH_LIMIT
 *
 * WHAT:  The Cloudflare R2 implementation of StorageAdapter.
 * WHY:   `signedPutUrl` signs ContentType and ContentLength INTO the URL, so
 *        the bucket rejects an upload that lies about either. Validating only
 *        in the app would leave a signed URL usable for an arbitrary file
 *        until it expired — the difference between a size limit and a
 *        suggestion.
 *        `head` maps R2's NotFound to `null` so a caller can tell "absent"
 *        from "the call failed"; every other error propagates.
 *        DELETE_BATCH_LIMIT: S3's DeleteObjects caps at 1000 keys per call,
 *        so deletes are chunked rather than assumed small.
 * WHERE: Loaded by ../index.ts through a dynamic import.
 */

import 'server-only'

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { getR2Bucket, getR2Client } from './client'
import {
  DEFAULT_SIGNED_GET_TTL_SECONDS,
  DEFAULT_SIGNED_PUT_TTL_SECONDS,
  type StorageAdapter,
  type StorageObjectInfo,
} from '../types'

const DELETE_BATCH_LIMIT = 1000

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = 'name' in error ? error.name : undefined
  if (name === 'NotFound' || name === 'NoSuchKey') return true
  const metadata = '$metadata' in error ? error.$metadata : undefined
  if (typeof metadata === 'object' && metadata !== null && 'httpStatusCode' in metadata) {
    return metadata.httpStatusCode === 404
  }
  return false
}

export const r2StorageAdapter: StorageAdapter = {
  id: 'r2',

  async putObject({ key, body, contentType }) {
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    )
  },

  async signedGetUrl(key, ttlSeconds = DEFAULT_SIGNED_GET_TTL_SECONDS) {
    return getSignedUrl(
      getR2Client(),
      new GetObjectCommand({ Bucket: getR2Bucket(), Key: key }),
      { expiresIn: ttlSeconds },
    )
  },

  async signedPutUrl(key, { contentType, maxBytes, ttlSeconds }) {
    /* ContentLength is signed in, so the bucket enforces the cap itself. The
     * client MUST send a matching Content-Length header or R2 refuses. */
    return getSignedUrl(
      getR2Client(),
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: key,
        ContentType: contentType,
        ContentLength: maxBytes,
      }),
      { expiresIn: ttlSeconds ?? DEFAULT_SIGNED_PUT_TTL_SECONDS },
    )
  },

  async deleteObject(key) {
    await getR2Client().send(
      new DeleteObjectCommand({ Bucket: getR2Bucket(), Key: key }),
    )
  },

  async deleteObjects(keys) {
    if (keys.length === 0) return
    const bucket = getR2Bucket()
    const client = getR2Client()

    for (let i = 0; i < keys.length; i += DELETE_BATCH_LIMIT) {
      const batch = keys.slice(i, i + DELETE_BATCH_LIMIT)
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      )
    }
  },

  async head(key): Promise<StorageObjectInfo | null> {
    try {
      const result = await getR2Client().send(
        new HeadObjectCommand({ Bucket: getR2Bucket(), Key: key }),
      )
      return {
        key,
        bytes: result.ContentLength ?? 0,
        contentType: result.ContentType,
        lastModified: result.LastModified,
      }
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  },
}
