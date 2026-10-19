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
 * SOURCE OF TRUTH KEYWORDS: getR2Client, R2_BUCKET, isR2Configured, R2 endpoint,
 *   LAZY_CLIENT, PROVIDER_ISOLATION
 *
 * WHAT:  The S3 client pointed at Cloudflare R2, plus the bucket name.
 * WHY:   LAZY_CLIENT, matching config/stripe.ts: the client is built on first
 *        use and throws there, not at import. Constructing it at module scope
 *        would crash the setup checklist — the one screen whose job is to tell
 *        the operator which variables are missing. Media is optional until a
 *        phase needs it, so a repo with no R2 credentials must still boot.
 *        `region: 'auto'` and the account-scoped endpoint are R2's S3
 *        compatibility requirements; `forcePathStyle` keeps bucket names with
 *        dots working.
 * WHERE: Used only by ./index.ts. eslint forbids the S3 SDK elsewhere.
 */

import { S3Client } from '@aws-sdk/client-s3'

import { assertStorageProviderActive } from '../provider'

assertStorageProviderActive('r2')

const accountId = process.env['R2_ACCOUNT_ID']?.trim()
const accessKeyId = process.env['R2_ACCESS_KEY_ID']?.trim()
const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY']?.trim()
const bucket = process.env['R2_BUCKET']?.trim()

/** The CDN origin for public library objects. Optional. */
export const R2_PUBLIC_URL = process.env['R2_PUBLIC_URL']?.trim() ?? ''

export function isR2Configured(): boolean {
  return Boolean(accountId && accessKeyId && secretAccessKey && bucket)
}

export function getR2Bucket(): string {
  if (!bucket) {
    throw new Error(
      '[storage/r2] R2_BUCKET is not set. Add the R2_* variables to .env — see .env.example.',
    )
  }
  return bucket
}

let client: S3Client | null = null

export function getR2Client(): S3Client {
  if (client) return client

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      '[storage/r2] R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, ' +
        'R2_SECRET_ACCESS_KEY and R2_BUCKET in .env — see .env.example.',
    )
  }

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })

  return client
}
