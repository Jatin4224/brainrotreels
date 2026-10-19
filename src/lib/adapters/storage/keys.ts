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
 * SOURCE OF TRUTH KEYWORDS: storageKeys, STORAGE_KEY_CONVENTION, libraryKey,
 *   uploadKey, projectKey, renderKey, tmpKey, assertKeySegment, KEY_TRAVERSAL_GUARD
 *
 * WHAT:  Builds every object key used in the bucket, and is the only place
 *        that knows the layout.
 * WHY:   STORAGE_KEY_CONVENTION. Keys encode tenancy — `orgs/{organizationId}/...`
 *        is what makes "this file belongs to that workspace" true at the
 *        storage layer rather than only in Postgres. If call sites build keys
 *        by hand, one template-literal typo puts a customer's render inside
 *        another customer's prefix, and no database constraint catches it.
 *        KEY_TRAVERSAL_GUARD: every segment is validated. An id containing
 *        `..`, a slash, or a leading dot could escape its prefix and read or
 *        overwrite another workspace's objects. Ids are cuids today so none of
 *        this can happen — but a filename reaching `uploadKey` is user input,
 *        and the guard is cheap insurance against the day one does.
 *        Keys never start with `/`: S3 treats a leading slash as an empty
 *        first segment, producing a second, invisible namespace.
 * WHERE: Used by the storage adapter and by every phase that stores media.
 *        Pure — no SDK, no env, safe to unit test and to import anywhere.
 */

/** Matches the lifecycle rule that deletes scratch objects after 24 hours. */
export const TMP_PREFIX = 'tmp'

export type LibraryKind = 'backgrounds' | 'music' | 'sfx' | 'avatars'

export type ProjectAssetKind = 'audio' | 'footage' | 'renders'

/**
 * SOURCE OF TRUTH KEYWORDS: assertKeySegment, KEY_TRAVERSAL_GUARD
 *
 * WHAT:  Rejects a path segment that could escape its prefix.
 * WHY:   Throws rather than sanitising. Silently rewriting a key would mean
 *        the object is stored somewhere the caller does not expect, and the
 *        mismatch surfaces later as a missing file — far from the cause.
 */
export function assertKeySegment(value: string, label: string): string {
  if (value.length === 0) {
    throw new Error(`[storage] ${label} must not be empty.`)
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`[storage] ${label} must not contain a path separator: "${value}".`)
  }
  if (value === '.' || value === '..' || value.startsWith('.')) {
    throw new Error(`[storage] ${label} must not start with a dot: "${value}".`)
  }
  /* Control characters and raw whitespace break signed-URL round-trips in
   * ways that are tedious to debug. */
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`[storage] ${label} contains a control character.`)
  }
  return value
}

function join(...segments: readonly string[]): string {
  return segments.join('/')
}

/**
 * Shared, non-tenant assets: curated backgrounds, music, sfx, avatar art.
 * Served through the CDN rather than signed — they are public by definition.
 */
export function libraryKey(kind: LibraryKind, ...rest: readonly string[]): string {
  rest.forEach((segment, i) => assertKeySegment(segment, `library segment ${i}`))
  return join('library', kind, ...rest)
}

/** A workspace's own upload and its derived variants. */
export function uploadKey(
  organizationId: string,
  assetId: string,
  filename: string,
): string {
  assertKeySegment(organizationId, 'organizationId')
  assertKeySegment(assetId, 'assetId')
  assertKeySegment(filename, 'filename')
  return join('orgs', organizationId, 'uploads', assetId, filename)
}

/** Anything produced for one project: narration audio, footage, renders. */
export function projectKey(
  organizationId: string,
  projectId: string,
  kind: ProjectAssetKind,
  ...rest: readonly string[]
): string {
  assertKeySegment(organizationId, 'organizationId')
  assertKeySegment(projectId, 'projectId')
  rest.forEach((segment, i) => assertKeySegment(segment, `project segment ${i}`))
  return join('orgs', organizationId, 'projects', projectId, kind, ...rest)
}

/** A render's outputs live together so one delete removes the whole set. */
export function renderKey(
  organizationId: string,
  projectId: string,
  renderId: string,
  filename: string,
): string {
  assertKeySegment(renderId, 'renderId')
  assertKeySegment(filename, 'filename')
  return projectKey(organizationId, projectId, 'renders', renderId, filename)
}

/**
 * Scratch space. Deleted by an R2 lifecycle rule after 24 hours, so NOTHING
 * that must survive a job may be written here.
 */
export function tmpKey(jobId: string, ...rest: readonly string[]): string {
  assertKeySegment(jobId, 'jobId')
  rest.forEach((segment, i) => assertKeySegment(segment, `tmp segment ${i}`))
  return join(TMP_PREFIX, jobId, ...rest)
}

/**
 * SOURCE OF TRUTH KEYWORDS: isOwnedByOrganization, TENANCY_KEY_CHECK
 *
 * WHAT:  True when a key sits under this workspace's prefix.
 * WHY:   A second line of defence for signing. The database says who owns an
 *        asset; this says the key agrees. Cheap, and it turns a corrupted row
 *        into a refusal rather than a cross-tenant read.
 */
export function isOwnedByOrganization(key: string, organizationId: string): boolean {
  return key.startsWith(`orgs/${organizationId}/`)
}

/** Library objects are readable by everyone; nothing else is, without a check. */
export function isLibraryKey(key: string): boolean {
  return key.startsWith('library/')
}
