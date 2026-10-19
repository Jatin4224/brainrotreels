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
 * SOURCE OF TRUTH KEYWORDS: assetKindSchema, AssetKind, assetSourceSchema,
 *   AssetSource, assetStatusSchema, AssetStatus, moderationStatusSchema,
 *   variantNameSchema, VariantName, VARIANT_NAMES, UPLOAD_CONTENT_TYPES,
 *   uploadContentTypeSchema, UploadContentType, MediaFamily, mediaFamilyOf,
 *   kindForContentType, extensionForContentType, UPLOAD_BYTES_PER_PLAN,
 *   maxUploadBytesForPlan, createUploadUrlSchema, completeUploadSchema,
 *   listAssetsSchema, getAssetSchema, renameAssetSchema, deleteAssetSchema,
 *   assetFilterSchema, normalizeAssetFilters, ASSET_TABS, ASSET_PAGE_SIZE,
 *   CONTENT_TYPE_ALLOWLIST, STRING_NOT_ENUM, CLIENT_SERVER_MIRROR
 *
 * WHAT:  The validated vocabulary of an Asset — its kind, source, status, the
 *        content types the product accepts and the per-plan size cap — plus the
 *        zod input schema for every `assets.*` procedure and the media screens
 *        that call them.
 * WHY:   STRING_NOT_ENUM, the same reason as ./project: `Asset.kind`, `.source`,
 *        `.status` and `.moderationStatus` are Prisma `String` columns, so these
 *        unions are the only thing between a typo and a row no renderer can
 *        open.
 *
 *        CLIENT_SERVER_MIRROR is the point of putting the allowlist and the
 *        size caps HERE rather than in the router. Phase 02 has to reject a bad
 *        file twice — in the drop zone, where the customer can be told before
 *        they wait for an upload, and at `createUploadUrl`, because a client
 *        check is a courtesy and not a boundary. Two lists would drift, and the
 *        drift is invisible: the client accepts a file the server then refuses,
 *        or worse, the client refuses one the server would have taken. One
 *        object, imported by both, cannot do that.
 *
 *        CONTENT_TYPE_ALLOWLIST is keyed by MIME type, and it is an allowlist
 *        rather than a deny-list on purpose. The browser's reported type is
 *        attacker-controlled, so this is not a security claim about the bytes —
 *        ffprobe in the ingest workflow is what actually proves what a file is
 *        (see src/lib/media/ingest-plan.ts). This list decides what we are
 *        WILLING to sign a write URL for.
 * WHERE: Imported by src/trpc/routers/assets.ts, src/services/assets.service.ts,
 *        src/inngest/functions/asset-ingest.ts, the media screens under
 *        src/app/(dashboard)/dashboard/media/ and
 *        src/components/global/media-upload/. Re-exported from src/lib/types.
 */

import { z } from 'zod'

import { PLAN_KEYS, type PlanKey } from '@/lib/config/plans'

/**
 * SOURCE OF TRUTH KEYWORDS: ASSET_KINDS, assetKindSchema, AssetKind
 *
 * WHAT:  What a piece of media IS, as far as the product is concerned.
 * WHY:   The kind drives three decisions downstream — which ingest variants are
 *        worth building, which picker a file shows up in, and which timeline
 *        lane it may be dropped on. It is NOT the file's type: an `mp4` can be
 *        a `background`, an `upload` or a `render_output`, and those three are
 *        treated completely differently.
 *        `upload` is the only kind a customer may name themselves; everything
 *        else is set by the pipeline that produced the row, which is why
 *        createUploadUrlSchema narrows to UPLOADABLE_ASSET_KINDS below.
 * WHERE: Asset.kind; the media tabs; the asset pickers from Phase 11 onward.
 */
export const ASSET_KINDS = [
  'background',
  'upload',
  'ai_footage',
  'image',
  'audio_tts',
  'audio_music',
  'sfx',
  'render_output',
  'avatar',
] as const

export const assetKindSchema = z.enum(ASSET_KINDS)

export type AssetKind = z.infer<typeof assetKindSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: UPLOADABLE_ASSET_KINDS, uploadableAssetKindSchema
 *
 * WHAT:  The kinds a customer-initiated upload is allowed to declare.
 * WHY:   A client that could name its own kind could write a row claiming to be
 *        a `render_output` — which Phase 04 bills for and Phase 10 treats as
 *        already-moderated — or a `background`, which Phase 11 serves to other
 *        workspaces from the library. The upload path therefore accepts only
 *        the three kinds that mean "a file this workspace brought", and
 *        `completeUpload` re-derives the real one from the content type anyway
 *        (kindForContentType) so the two cannot disagree.
 * WHERE: createUploadUrlSchema; the `kind` prop on <MediaUpload>.
 */
export const UPLOADABLE_ASSET_KINDS = ['upload', 'image', 'audio_music'] as const

export const uploadableAssetKindSchema = z.enum(UPLOADABLE_ASSET_KINDS)

export type UploadableAssetKind = z.infer<typeof uploadableAssetKindSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: ASSET_SOURCES, assetSourceSchema, AssetSource
 *
 * WHAT:  Where a row came from.
 * WHY:   Separate from `kind` because provenance and purpose are different
 *        questions, and the licensing answer hangs off this one: a `library`
 *        row is covered by the operator's licence, an `upload` by the
 *        customer's own rights, and a `generated` clip by the model's
 *        commercial-use terms (an open owner decision for Phase 17).
 * WHERE: Asset.source; the library gating in Phase 11.
 */
export const ASSET_SOURCES = ['library', 'upload', 'generated', 'stock'] as const

export const assetSourceSchema = z.enum(ASSET_SOURCES)

export type AssetSource = z.infer<typeof assetSourceSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: ASSET_STATUSES, assetStatusSchema, AssetStatus
 *
 * WHAT:  The ingest lifecycle of an asset row.
 * WHY:   `processing` is the DEFAULT and that is load-bearing: the row is
 *        created the moment the bytes land, before anything has looked at them,
 *        so the honest initial state is "we do not yet know if this is usable".
 *        Only the ingest workflow moves a row to `ready` or `failed`, and
 *        nothing may render an asset that is not `ready` — a corrupt file must
 *        never reach a paid render.
 * WHERE: Asset.status; the status chip in the media table; the render
 *        pre-flight from Phase 04.
 */
export const ASSET_STATUSES = ['processing', 'ready', 'failed'] as const

export const assetStatusSchema = z.enum(ASSET_STATUSES)

export type AssetStatus = z.infer<typeof assetStatusSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: MODERATION_STATUSES, moderationStatusSchema
 *
 * WHAT:  Whether an asset has been cleared for use.
 * WHY:   A separate axis from `status` because the two fail independently: a
 *        file can transcode perfectly and still be something we will not
 *        publish. `skipped` exists so Phase 02 can be honest — moderation is
 *        STUBBED here and becomes real in Phase 10, and a stub that wrote
 *        `approved` would be a claim nobody checked.
 * WHERE: Asset.moderationStatus; the ingest workflow's moderate step.
 */
export const MODERATION_STATUSES = ['pending', 'approved', 'rejected', 'skipped'] as const

export const moderationStatusSchema = z.enum(MODERATION_STATUSES)

export type ModerationStatus = z.infer<typeof moderationStatusSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: VARIANT_NAMES, variantNameSchema, VariantName
 *
 * WHAT:  The derived renditions the ingest workflow produces.
 * WHY:   A closed union because every one of them has a consumer that names it
 *        literally: `vertical_1080` is what the renderer composites,
 *        `proxy_480` is what the browser editor previews with (that pairing is
 *        why preview and output match — see architecture.md), `thumb` is the
 *        media library's poster, and `waveform` is the editor's audio lane.
 *        Adding a name here means teaching the ingest plan to build it.
 * WHERE: AssetVariant.variant; getAssetVariants; src/lib/media/ingest-plan.ts.
 */
export const VARIANT_NAMES = ['vertical_1080', 'proxy_480', 'thumb', 'waveform'] as const

export const variantNameSchema = z.enum(VARIANT_NAMES)

export type VariantName = z.infer<typeof variantNameSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: MediaFamily, mediaFamilySchema
 *
 * WHAT:  The three broad shapes of media, which decide what can be done to a
 *        file at all.
 * WHY:   Variant selection, the drop zone's `accept` attribute and the table's
 *        preview cell all branch on family rather than on the exact MIME type —
 *        a waveform is meaningful for every audio type and for none of the
 *        others, and enumerating MIME types at each of those sites is how a new
 *        accepted format gets half-supported.
 * WHERE: CONTENT_TYPE_ALLOWLIST below; planVariants in src/lib/media.
 */
export const MEDIA_FAMILIES = ['video', 'image', 'audio'] as const

export const mediaFamilySchema = z.enum(MEDIA_FAMILIES)

export type MediaFamily = z.infer<typeof mediaFamilySchema>

/**
 * SOURCE OF TRUTH KEYWORDS: CONTENT_TYPE_ALLOWLIST, UPLOAD_CONTENT_TYPES,
 *   uploadContentTypeSchema, UploadContentType, CLIENT_SERVER_MIRROR
 *
 * WHAT:  Every content type the product will sign a write URL for, and what
 *        each one means: its family, the extension its stored object gets, and
 *        the asset kind it implies.
 * WHY:   The `extension` is here rather than parsed off the customer's filename
 *        because the stored object's key is built from it (uploadKey →
 *        `<assetId>/original.<ext>`), and a key is not the place to trust a
 *        name the browser handed us — `payload.mp4.exe` is a filename, and
 *        `assertKeySegment` would take it. The DISPLAY name keeps whatever the
 *        customer called it; only the key is normalised.
 *
 *        `video/quicktime` is MOV. It is accepted because it is what an iPhone
 *        produces, which is most of this product's uploads — and it is also the
 *        format most likely to arrive carrying codecs the renderer cannot read,
 *        which is why ffprobe gets the final word in the workflow rather than
 *        this list.
 * WHERE: createUploadUrlSchema's refinement, the drop zone's client-side check,
 *        and the `accept` attribute it builds.
 */
export const CONTENT_TYPE_ALLOWLIST = {
  'video/mp4': { family: 'video', extension: 'mp4', kind: 'upload' },
  'video/quicktime': { family: 'video', extension: 'mov', kind: 'upload' },
  'video/webm': { family: 'video', extension: 'webm', kind: 'upload' },
  'image/jpeg': { family: 'image', extension: 'jpg', kind: 'image' },
  'image/png': { family: 'image', extension: 'png', kind: 'image' },
  'image/webp': { family: 'image', extension: 'webp', kind: 'image' },
  'audio/mpeg': { family: 'audio', extension: 'mp3', kind: 'audio_music' },
  'audio/wav': { family: 'audio', extension: 'wav', kind: 'audio_music' },
} as const satisfies Record<
  string,
  { family: MediaFamily; extension: string; kind: UploadableAssetKind }
>

export const UPLOAD_CONTENT_TYPES = Object.keys(
  CONTENT_TYPE_ALLOWLIST
) as readonly UploadContentType[]

export type UploadContentType = keyof typeof CONTENT_TYPE_ALLOWLIST

/* A union schema rather than z.string(), so a refused type fails validation
 * with the list attached instead of reaching a hand-written if. */
export const uploadContentTypeSchema = z.enum(
  Object.keys(CONTENT_TYPE_ALLOWLIST) as [UploadContentType, ...UploadContentType[]]
)

/**
 * SOURCE OF TRUTH KEYWORDS: isUploadContentType, mediaFamilyOf,
 *   kindForContentType, extensionForContentType
 *
 * WHAT:  The four lookups every caller needs against the allowlist.
 * WHY:   Functions rather than letting call sites index the object, because the
 *        callers hold a plain `string` (a File's `type`, a stored row's
 *        `contentType`) and indexing a literal-keyed object with one needs a
 *        cast at every site. The narrowing happens once, here.
 * WHERE: The drop zone, the router, the media table's icon, the ingest plan.
 */
export function isUploadContentType(value: string): value is UploadContentType {
  return Object.prototype.hasOwnProperty.call(CONTENT_TYPE_ALLOWLIST, value)
}

export function mediaFamilyOf(contentType: string): MediaFamily | null {
  return isUploadContentType(contentType) ? CONTENT_TYPE_ALLOWLIST[contentType].family : null
}

export function kindForContentType(contentType: string): UploadableAssetKind | null {
  return isUploadContentType(contentType) ? CONTENT_TYPE_ALLOWLIST[contentType].kind : null
}

export function extensionForContentType(contentType: string): string | null {
  return isUploadContentType(contentType) ? CONTENT_TYPE_ALLOWLIST[contentType].extension : null
}

/**
 * SOURCE OF TRUTH KEYWORDS: UPLOAD_BYTES_PER_PLAN, maxUploadBytesForPlan,
 *   PER_FILE_CAP_NOT_A_QUOTA
 *
 * WHAT:  The largest SINGLE file each plan may upload.
 * WHY:   PER_FILE_CAP_NOT_A_QUOTA — this is not the storage quota and must not
 *        be confused with it. The quota is `RESOURCES.storage.limit` and it
 *        caps the TOTAL; this caps one file, and the two answer different
 *        questions: a free workspace with 100 MB of room must still be stopped
 *        from trying to push a 4 GB file through a serverless presign, and a
 *        Pro workspace with 25 GB spare should not be allowed to park a single
 *        unbounded object either, because every byte of it has to go through
 *        ffmpeg in one workflow step.
 *
 *        Why it lives here and not in RESOURCES: the registry's `limit` shape
 *        is a counter with a usage row behind it, and a per-file cap has no
 *        counter — nothing accumulates. Declaring it there would create a
 *        `storage`-shaped quota the factory would try to gate and bump.
 *
 *        Free is deliberately BELOW the plan's own 100 MB total, so a free
 *        customer cannot fill their entire workspace with one file and be left
 *        with a library they can neither use nor extend.
 * WHERE: createUploadUrlSchema's cap check in the router, and the drop zone's
 *        client-side mirror.
 */
export const UPLOAD_BYTES_PER_PLAN: Readonly<Record<PlanKey, number>> = {
  free: 50 * 1024 * 1024,
  starter: 500 * 1024 * 1024,
  pro: 2 * 1024 * 1024 * 1024,
  enterprise: 5 * 1024 * 1024 * 1024,
  portal: 5 * 1024 * 1024 * 1024,
}

/* Exhaustive over PLAN_KEYS by construction — a new plan without an entry is a
 * compile error on the Record above, which is why the map is not partial. */
export function maxUploadBytesForPlan(plan: PlanKey): number {
  return UPLOAD_BYTES_PER_PLAN[plan]
}

/* The most permissive cap any plan grants. The drop zone uses it as a sanity
 * bound before the plan is known, so a 40 GB drag is rejected instantly rather
 * than after a round trip. */
export const UPLOAD_BYTES_CEILING = Math.max(
  ...PLAN_KEYS.map((plan) => UPLOAD_BYTES_PER_PLAN[plan])
)

/**
 * SOURCE OF TRUTH KEYWORDS: assetFilenameSchema
 *
 * WHAT:  A display filename.
 * WHY:   One definition for upload and rename, as projectTitleSchema is for
 *        projects. Path separators are stripped at the schema rather than
 *        rejected: a browser can legitimately report `folder/clip.mp4` from a
 *        directory drop, and failing that upload would be a worse answer than
 *        storing the leaf name. The STORED KEY never uses this value at all
 *        (see CONTENT_TYPE_ALLOWLIST), so this is a label, not a path.
 * WHERE: createUploadUrlSchema, renameAssetSchema, the rename dialog.
 */
export const assetFilenameSchema = z
  .string()
  .trim()
  .min(1, 'Give this file a name.')
  .max(255, 'That name is too long.')
  .transform((value) => value.split(/[/\\]/).pop() ?? value)
  .refine((value) => value.length > 0, 'Give this file a name.')

/**
 * SOURCE OF TRUTH KEYWORDS: createUploadUrlSchema, CreateUploadUrlValues,
 *   EXACT_CONTENT_LENGTH
 *
 * WHAT:  Input for assets.createUploadUrl — what the client is about to upload.
 * WHY:   EXACT_CONTENT_LENGTH. `bytes` is the file's REAL size, not a requested
 *        ceiling, and that is a hard requirement of the storage seam rather
 *        than a preference: `signedPutUrl` signs `ContentLength` INTO the URL
 *        (src/lib/adapters/storage/r2/index.ts), so R2 rejects any PUT whose
 *        body length differs from the number signed. Sending the plan cap here
 *        would produce a URL that only accepts a file of exactly that size —
 *        i.e. one that rejects every real upload. The client therefore sends
 *        `file.size` and the server signs that, after checking it against the
 *        plan's per-file cap and the workspace's remaining storage.
 *
 *        `kind` is accepted but narrowed (see UPLOADABLE_ASSET_KINDS) and the
 *        server still re-derives the kind from the content type, so the field
 *        is a hint about intent — an image dropped on a backgrounds picker —
 *        never an authority.
 * WHERE: The drop zone's first call per file; the router signs from it.
 */
export const createUploadUrlSchema = z.object({
  organizationId: z.string().min(1),
  filename: assetFilenameSchema,
  contentType: uploadContentTypeSchema,
  bytes: z
    .number()
    .int('A file size must be a whole number of bytes.')
    .positive('That file is empty.')
    .max(UPLOAD_BYTES_CEILING, 'That file is larger than any plan allows.'),
  kind: uploadableAssetKindSchema.optional(),
})

export type CreateUploadUrlValues = z.infer<typeof createUploadUrlSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: completeUploadSchema, CompleteUploadValues
 *
 * WHAT:  Input for assets.completeUpload — "the bytes are in the bucket".
 * WHY:   Carries the `storageKey` the presign step issued rather than letting
 *        the client propose one, and the server re-checks that the key belongs
 *        to the calling workspace before it believes it (isOwnedByOrganization).
 *        A client that could name an arbitrary key could attach another
 *        workspace's object to its own row and read it through a signed URL
 *        legitimately issued against its own asset.
 *
 *        The byte count is NOT taken from the client at this step: the router
 *        HEADs the object and charges the quota the size the bucket reports.
 *        Trusting a client number here is how a workspace stores 2 GB and is
 *        billed for 2 KB.
 * WHERE: Called by the drop zone once the PUT resolves.
 */
export const completeUploadSchema = z.object({
  organizationId: z.string().min(1),
  storageKey: z.string().min(1).max(1024),
  filename: assetFilenameSchema,
  contentType: uploadContentTypeSchema,
  kind: uploadableAssetKindSchema.optional(),
})

export type CompleteUploadValues = z.infer<typeof completeUploadSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: listAssetsSchema, ASSET_PAGE_SIZE
 *
 * WHAT:  Input for assets.list — page, search, and the two facets.
 * WHY:   `page` / `pageSize` carry no `.default()` or `.max()` for the same
 *        reason as listProjectsSchema: the procedure factory reads them from
 *        rawInput and owns the clamping.
 * WHERE: The media screen and the router.
 */
export const ASSET_PAGE_SIZE = 24

export const listAssetsSchema = z.object({
  organizationId: z.string().min(1),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
  search: z.string().trim().max(200).optional(),
  /* A tab selects SEVERAL kinds (Audio is three of them), so the wire carries
   * the set rather than the tab's name — the server never has to know what the
   * UI called the grouping. */
  kinds: z.array(assetKindSchema).min(1).optional(),
  status: assetStatusSchema.optional(),
})

export type ListAssetsValues = z.infer<typeof listAssetsSchema>

export const getAssetSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
})

export const renameAssetSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
  filename: assetFilenameSchema,
})

export type RenameAssetValues = z.infer<typeof renameAssetSchema>

export const deleteAssetSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
})

/**
 * SOURCE OF TRUTH KEYWORDS: ASSET_TABS, AssetTabKey, assetTabSchema,
 *   TAB_IS_A_KIND_SET
 *
 * WHAT:  The media library's tabs, and which asset kinds each one shows.
 * WHY:   TAB_IS_A_KIND_SET — a tab is a VIEW over kinds, not a column. "Audio"
 *        covers music, narration and sfx, and "All" covers everything, so a
 *        single `kind` string on the query could not express either. Declared
 *        as data rather than as JSX so the normalizer can turn a tab into
 *        router input without the component knowing the mapping, and so a new
 *        kind is added to a tab in one line.
 *        `kinds: null` means "no filter" and is what keeps All honest as new
 *        kinds appear — a tab listing every kind explicitly would silently drop
 *        render outputs the day Phase 04 starts writing them.
 * WHERE: The media filters component and normalizeAssetFilters.
 */
export const ASSET_TABS = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'uploads', label: 'Uploads', kinds: ['upload', 'image'] },
  { key: 'backgrounds', label: 'Backgrounds', kinds: ['background', 'ai_footage'] },
  { key: 'audio', label: 'Audio', kinds: ['audio_music', 'audio_tts', 'sfx'] },
] as const satisfies readonly {
  key: string
  label: string
  kinds: readonly AssetKind[] | null
}[]

export type AssetTabKey = (typeof ASSET_TABS)[number]['key']

export const assetTabSchema = z.enum(
  ASSET_TABS.map((tab) => tab.key) as [AssetTabKey, ...AssetTabKey[]]
)

/**
 * SOURCE OF TRUTH KEYWORDS: ASSET_FILTER_ALL, assetFilterSchema,
 *   AssetFilterValues, ASSET_FILTER_DEFAULTS, normalizeAssetFilters
 *
 * WHAT:  The contract for the media toolbar — search, the tab, and the status
 *        facet — and the normalizer that turns it into router input.
 * WHY:   ASSET_FILTER_ALL mirrors PROJECT_FILTER_ALL and AUDIT_FILTER_ALL for
 *        the same reason: Base UI's Select treats `''` as "nothing selected", so
 *        "no filter" needs a real sentinel, and it is stripped in exactly ONE
 *        place so it can never reach a `where` clause.
 *        The tab resolves to a KIND SET here rather than in the component, so
 *        the table passes `applied` straight through.
 * WHERE: The media toolbar and table under
 *        src/app/(dashboard)/dashboard/media/_components.
 */
export const ASSET_FILTER_ALL = 'all'

export const ASSET_SEARCH_MAX = 200

export const assetFilterSchema = z.object({
  search: z.string().trim().max(ASSET_SEARCH_MAX),
  tab: z.string(),
  status: z.string(),
})

export type AssetFilterValues = z.infer<typeof assetFilterSchema>

export const ASSET_FILTER_DEFAULTS: AssetFilterValues = {
  search: '',
  tab: 'all',
  status: ASSET_FILTER_ALL,
}

export function normalizeAssetFilters(values: AssetFilterValues): {
  search?: string
  kinds?: AssetKind[]
  status?: AssetStatus
} {
  const parsed = assetFilterSchema.parse(values)
  const search = parsed.search.trim()
  const status = assetStatusSchema.safeParse(parsed.status)
  const tab = ASSET_TABS.find((candidate) => candidate.key === parsed.tab)

  /* Keys are omitted rather than set to undefined — `exactOptionalPropertyTypes`
   * is on and the router's input schema uses `.optional()`. */
  return {
    ...(search ? { search } : {}),
    ...(tab?.kinds ? { kinds: [...tab.kinds] } : {}),
    ...(status.success ? { status: status.data } : {}),
  }
}
