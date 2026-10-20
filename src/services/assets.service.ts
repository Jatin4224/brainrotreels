/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: listAssets, findAssetForOrganization,
 *   findAssetWithVariants, createProcessingAsset, markAssetReady,
 *   markAssetFailed, upsertAssetVariant, getAssetVariants, signAssetUrl,
 *   signVariantUrl, deleteAssetRow, sumAssetBytes, ASSET_LIST_SELECT,
 *   AssetListItem, MINE_OR_LIBRARY, TENANT_SCOPED_QUERY, SIGNING_BOUNDARY,
 *   DELETE_REMOVES_EVERY_OBJECT, DbClient
 *
 * WHAT:  The Prisma reads and writes of the `asset` and `asset_variant` tables,
 *        plus the one function allowed to turn an asset id into a URL.
 * WHY:   MINE_OR_LIBRARY is the rule this whole file exists to hold in one
 *        place. `Asset.organizationId` is nullable so library rows can be
 *        shared by every workspace, which means the ownership predicate is
 *        "mine OR library" — `{ OR: [{ organizationId }, { organizationId: null }] }`
 *        — and NEVER "not null", never `organizationId !== null`, and never a
 *        plain id lookup. Written once, here; every caller goes through it.
 *
 *        TENANT_SCOPED_QUERY, as in projects.service.ts: every function takes
 *        `organizationId` and puts it in the WHERE clause even when it also has
 *        a primary key. The procedure factory proves the CALLER belongs to the
 *        org they named; it says nothing about the row.
 *
 *        SIGNING_BOUNDARY: signAssetUrl is a security boundary, which is why it
 *        is the one function in this file that reaches outside Prisma. It must
 *        never be possible to get a URL for another workspace's object, so it
 *        checks twice — the database says who owns the asset, and
 *        isOwnedByOrganization says the KEY agrees. A corrupted row therefore
 *        produces a refusal rather than a cross-tenant read.
 * WHERE: Called by src/trpc/routers/assets.ts and by
 *        src/inngest/functions/asset-ingest.ts. Business rules (what a plan
 *        allows, what an upload is called, what gets enqueued) live there, not
 *        here.
 */

import "server-only";

import {
  getStorageAdapter,
  isLibraryKey,
  isOwnedByOrganization,
} from "@/lib/adapters/storage";
import { prisma, type DbClient } from "@/lib/config/prisma";
import {
  TTL_BY_QUALITY,
  VARIANT_BY_QUALITY,
  type AssetUrlMap,
  type RenderQuality,
  type ResolvedAsset,
} from "@/lib/types/render";
import type { Prisma } from "@/generated/prisma";
import {
  variantNameSchema,
  type AssetKind,
  type AssetSource,
  type AssetStatus,
  type ModerationStatus,
  type VariantName,
} from "@/lib/types/asset";

/**
 * SOURCE OF TRUTH KEYWORDS: ASSET_LIST_SELECT, AssetListItem
 *
 * WHAT:  The columns the media library renders, and the row type they infer to.
 * WHY:   Explicit rather than a bare `findMany`, for the same reason
 *        PROJECT_LIST_SELECT is: `promptText` can be a paragraph and
 *        `modelVersion` is operator detail, and a grid of twenty-four tiles has
 *        no use for either. The thumb variant IS joined, because every tile
 *        needs it and fetching it per row is the n+1 that makes a media grid
 *        feel broken — but the join is NARROWED to the one variant, not
 *        `variants: true`, which would pull four rows per asset to use one.
 * WHERE: listAssets below; the columns in media-table.tsx.
 */
export const ASSET_LIST_SELECT = {
  id: true,
  organizationId: true,
  kind: true,
  source: true,
  filename: true,
  contentType: true,
  bytes: true,
  durationSec: true,
  width: true,
  height: true,
  status: true,
  moderationStatus: true,
  error: true,
  createdAt: true,
  variants: {
    where: { variant: "thumb" },
    select: { variant: true, storageKey: true, width: true, height: true },
  },
} as const satisfies Prisma.AssetSelect;

export type AssetListItem = Prisma.AssetGetPayload<{
  select: typeof ASSET_LIST_SELECT;
}>;

export type AssetWithVariants = Prisma.AssetGetPayload<{
  include: { variants: true };
}>;

/**
 * SOURCE OF TRUTH KEYWORDS: assetScopeWhere, MINE_OR_LIBRARY
 *
 * WHAT:  The ownership predicate every asset query starts from.
 * WHY:   See MINE_OR_LIBRARY in the file header. A single exported fragment so
 *        the rule is auditable — grep this symbol and you have found every
 *        query that can read an asset.
 * WHERE: Every read in this file.
 */
export function assetScopeWhere(
  organizationId: string,
): Prisma.AssetWhereInput {
  return { OR: [{ organizationId }, { organizationId: null }] };
}

/**
 * SOURCE OF TRUTH KEYWORDS: listAssets, AssetListFilters
 *
 * WHAT:  One page of the media a workspace can use, newest first, with the
 *        total for the pager.
 * WHY:   Ordered by `createdAt` rather than `updatedAt` — unlike a project, an
 *        asset is not edited, and its `updatedAt` moves when the INGEST
 *        finishes, which would reshuffle the grid under the customer's cursor
 *        while they watch an upload process.
 *        `search` is a case-insensitive filename match; there is nothing else
 *        on an asset a person would search by.
 * WHERE: assets.list.
 */
export async function listAssets(
  db: DbClient,
  filters: {
    organizationId: string;
    search?: string | undefined;
    kinds?: readonly AssetKind[] | undefined;
    status?: AssetStatus | undefined;
  },
  pagination: { skip: number; take: number },
): Promise<{ items: AssetListItem[]; total: number }> {
  const where: Prisma.AssetWhereInput = {
    ...assetScopeWhere(filters.organizationId),
    ...(filters.kinds !== undefined && filters.kinds.length > 0
      ? { kind: { in: [...filters.kinds] } }
      : {}),
    ...(filters.status !== undefined ? { status: filters.status } : {}),
    ...(filters.search !== undefined && filters.search.length > 0
      ? { filename: { contains: filters.search, mode: "insensitive" } }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.asset.findMany({
      where,
      select: ASSET_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
    }),
    db.asset.count({ where }),
  ]);

  return { items, total };
}

/**
 * SOURCE OF TRUTH KEYWORDS: findAssetForOrganization, MINE_OR_LIBRARY
 *
 * WHAT:  One asset by id, only if this workspace may use it.
 * WHY:   `findFirst` with the scope predicate rather than `findUnique` by id.
 *        Returns null rather than throwing so the caller chooses between
 *        NOT_FOUND and something softer — and NOT_FOUND is the right answer for
 *        another workspace's asset, because FORBIDDEN would confirm the id
 *        exists.
 * WHERE: assets.get, .rename, .delete; the ingest workflow's first step.
 */
export async function findAssetForOrganization(
  db: DbClient,
  organizationId: string,
  id: string,
): Promise<Prisma.AssetGetPayload<Record<string, never>> | null> {
  return db.asset.findFirst({
    where: { id, ...assetScopeWhere(organizationId) },
  });
}

export async function findAssetWithVariants(
  db: DbClient,
  organizationId: string,
  id: string,
): Promise<AssetWithVariants | null> {
  return db.asset.findFirst({
    where: { id, ...assetScopeWhere(organizationId) },
    include: { variants: true },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: findAssetById, JOB_RECHECKS_OWNERSHIP
 *
 * WHAT:  One asset by id with no tenancy predicate, for the ingest workflow.
 * WHY:   JOB_RECHECKS_OWNERSHIP, the inverse of it. A workflow runs outside
 *        protectedProcedure and is triggered by an event the app itself sent
 *        carrying an id it just created, so there is no caller to scope to —
 *        asking for an `organizationId` here would mean the workflow passing
 *        one it read off the same row, which proves nothing.
 *        It is a SEPARATE function rather than a parameter on the one above
 *        precisely so that an unscoped read cannot happen by passing the wrong
 *        argument: a caller has to name this function, and naming it in a
 *        router is immediately wrong in review.
 * WHERE: src/inngest/functions/asset-ingest.ts only.
 */
export async function findAssetById(
  db: DbClient,
  id: string,
): Promise<AssetWithVariants | null> {
  return db.asset.findUnique({ where: { id }, include: { variants: true } });
}

/**
 * SOURCE OF TRUTH KEYWORDS: createProcessingAsset
 *
 * WHAT:  Writes the asset row for an upload that has just landed.
 * WHY:   Takes the byte count as an argument rather than deriving it, because
 *        the router HEADs the object and passes what the BUCKET reported — see
 *        completeUploadSchema's note on why a client's number is not usable
 *        here. Status and moderation both default from the schema, so this
 *        function cannot accidentally create a row that claims to be ready.
 * WHERE: assets.completeUpload.
 */
export async function createProcessingAsset(
  db: DbClient,
  data: {
    organizationId: string;
    kind: AssetKind;
    source: AssetSource;
    filename: string;
    storageKey: string;
    contentType: string;
    bytes: number;
  },
): Promise<Prisma.AssetGetPayload<Record<string, never>>> {
  return db.asset.create({ data });
}

/**
 * SOURCE OF TRUTH KEYWORDS: markAssetReady, markAssetFailed, setModerationStatus
 *
 * WHAT:  The three terminal writes of the ingest workflow.
 * WHY:   Separate functions rather than one `updateAsset(data)`, because these
 *        are the only transitions that exist and a general update would let a
 *        caller set `status: 'ready'` while leaving an `error` on the row, or
 *        move a failed asset back to processing. `markAssetReady` clears
 *        `error` for that reason — a successful retry of a previously failed
 *        ingest must not leave the old message behind, which would show a
 *        working file with a red warning on it forever.
 * WHERE: src/inngest/functions/asset-ingest.ts.
 */
export async function markAssetReady(
  db: DbClient,
  id: string,
  facts: {
    durationSec?: number | null;
    width?: number | null;
    height?: number | null;
  },
): Promise<void> {
  await db.asset.update({
    where: { id },
    data: {
      status: "ready",
      error: null,
      ...(facts.durationSec !== undefined
        ? { durationSec: facts.durationSec }
        : {}),
      ...(facts.width !== undefined ? { width: facts.width } : {}),
      ...(facts.height !== undefined ? { height: facts.height } : {}),
    },
  });
}

export async function markAssetFailed(
  db: DbClient,
  id: string,
  error: string,
): Promise<void> {
  await db.asset.update({
    where: { id },
    /* Truncated: the column is unbounded text but the UI renders this inline,
     * and an ffmpeg dump pasted into a table cell is not a readable error. */
    data: { status: "failed", error: error.slice(0, 500) },
  });
}

export async function setModerationStatus(
  db: DbClient,
  id: string,
  moderationStatus: ModerationStatus,
): Promise<void> {
  await db.asset.update({ where: { id }, data: { moderationStatus } });
}

export async function renameAsset(
  db: DbClient,
  id: string,
  filename: string,
): Promise<Prisma.AssetGetPayload<Record<string, never>>> {
  return db.asset.update({ where: { id }, data: { filename } });
}

/**
 * SOURCE OF TRUTH KEYWORDS: upsertAssetVariant, RESUMABLE_INGEST
 *
 * WHAT:  Records one derived rendition, replacing any previous row for it.
 * WHY:   RESUMABLE_INGEST. An upsert on `(assetId, variant)` rather than a
 *        create, because a retried workflow step may produce the same variant
 *        twice — and the second attempt's object is the one that exists in the
 *        bucket, so its key and size are the ones that must be on the row. A
 *        create would throw on the unique constraint and turn a successful
 *        retry into a failed ingest.
 * WHERE: Each media step of the ingest workflow, one call per variant.
 */
export async function upsertAssetVariant(
  db: DbClient,
  data: {
    assetId: string;
    variant: VariantName;
    storageKey: string;
    bytes: number;
    width?: number | null;
    height?: number | null;
  },
): Promise<void> {
  const { assetId, variant, storageKey, bytes, width, height } = data;
  const writable = {
    storageKey,
    bytes,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };

  await db.assetVariant.upsert({
    where: { assetId_variant: { assetId, variant } },
    update: writable,
    create: { assetId, variant, ...writable },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: getAssetVariants, VariantMap
 *
 * WHAT:  An asset's renditions as a map keyed by variant name, with `null` for
 *        the ones that do not exist.
 * WHY:   A full map rather than the array Prisma returns, because every
 *        consumer wants one variant by name and `variants.find(v => ...)` at
 *        each site is both noise and a silent `undefined` when the name is
 *        misspelled. The explicit `null` is the contract Phase 02 declares:
 *        "not built" is an answer, and an audio asset legitimately has no
 *        thumbnail.
 * WHERE: assets.get; the render pre-flight in Phase 04; the editor in Phase 15.
 */
export type AssetVariantRow = Prisma.AssetVariantGetPayload<
  Record<string, never>
>;

export type VariantMap = Record<VariantName, AssetVariantRow | null>;

/**
 * SOURCE OF TRUTH KEYWORDS: emptyVariantMap, toVariantMap, VARIANT_MAP_IS_SEEDED
 *
 * WHAT:  Turns the array Prisma returns into the full, named map — and the
 *        seeded empty map every caller starts from.
 * WHY:   VARIANT_MAP_IS_SEEDED. Separated from getAssetVariants because the two
 *        callers arrive with the rows in different ways: the service reads them,
 *        and `assets.get` already has them from its own `include`. Before this
 *        existed the router rebuilt the map itself with a `.find()` per name —
 *        which is precisely the noise this map exists to remove, and it meant
 *        the two could disagree about an unknown variant name.
 *
 *        Seeding from VARIANT_NAMES rather than accumulating keys is what makes
 *        the result a genuine `Record<VariantName, …>`: building it with
 *        `Object.fromEntries` produces `{ [k: string]: … }`, so every consumer
 *        downstream loses the key union and `map.proxy_48` stops being a
 *        compile error.
 * WHERE: getAssetVariants below, and assets.get in src/trpc/routers/assets.ts.
 */
/* Written out rather than built from VARIANT_NAMES, because an object literal
 * assertion is banned by eslint and a loop would need one. The upside is
 * better than the workaround it replaces: the return type makes a missing key a
 * compile error here, so adding a variant name cannot ship without this map
 * learning about it. */
export function emptyVariantMap<T>(): Record<VariantName, T | null> {
  return {
    vertical_1080: null,
    proxy_480: null,
    thumb: null,
    waveform: null,
  };
}

export function toVariantMap(rows: readonly AssetVariantRow[]): VariantMap {
  const map = emptyVariantMap<AssetVariantRow>();

  for (const row of rows) {
    /* Parsed, not cast. The column is a String (STRING_NOT_ENUM), so a row
     * left behind by a future rename is possible — and a stale variant must be
     * ignored rather than take a screen down or be asserted into the map. */
    const name = variantNameSchema.safeParse(row.variant);
    if (name.success) map[name.data] = row;
  }

  return map;
}

export async function getAssetVariants(assetId: string): Promise<VariantMap> {
  return toVariantMap(
    await prisma.assetVariant.findMany({ where: { assetId } }),
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: signAssetUrl, SIGNING_BOUNDARY, DOUBLE_CHECKED_KEY
 *
 * WHAT:  A short-lived URL for an asset's primary object, or for one of its
 *        variants.
 * WHY:   SIGNING_BOUNDARY — the security boundary of this phase. Two
 *        independent checks, because they fail independently:
 *
 *          1. The ROW must be readable by this workspace (mine or library).
 *             That is the authorization decision.
 *          2. The KEY must agree — it must sit under this workspace's prefix,
 *             or under `library/`. That is DOUBLE_CHECKED_KEY: it catches a row
 *             whose `storageKey` was written wrong by a bug or a bad import,
 *             which authorization alone cannot see.
 *
 *        Returns null rather than throwing, so the caller answers NOT_FOUND.
 *        Distinguishing "no such asset" from "not yours" with different status
 *        codes tells an attacker which ids are real.
 *
 *        TTL defaults to the adapter's own short window. A caller wanting a
 *        long-lived URL should ask why — a render reads objects server-side and
 *        does not need one.
 * WHERE: assets.get, and the thumbnail URLs on the media list.
 */
export async function signAssetUrl(
  assetId: string,
  organizationId: string,
  ttlSeconds?: number,
): Promise<string | null> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ...assetScopeWhere(organizationId) },
    select: { storageKey: true, organizationId: true },
  });
  if (asset === null) return null;

  return signScopedKey(asset.storageKey, organizationId, ttlSeconds);
}

/**
 * SOURCE OF TRUTH KEYWORDS: signVariantUrl, SIGNING_BOUNDARY
 *
 * WHAT:  A short-lived URL for one named variant of an asset.
 * WHY:   The media grid needs thumbnails and the editor needs proxies, and
 *        neither is the asset's own object — signing `storageKey` for them
 *        would hand the browser the full-size master, which on a page of
 *        twenty-four tiles is hundreds of megabytes. Scoped by the same two
 *        checks as signAssetUrl, via the same helper.
 * WHERE: assets.list's thumbnail URLs; assets.get.
 */
export async function signVariantUrl(
  assetId: string,
  variant: VariantName,
  organizationId: string,
  ttlSeconds?: number,
): Promise<string | null> {
  const row = await prisma.assetVariant.findFirst({
    where: {
      variant,
      assetId,
      asset: assetScopeWhere(organizationId),
    },
    select: { storageKey: true },
  });
  if (row === null) return null;

  return signScopedKey(row.storageKey, organizationId, ttlSeconds);
}

/**
 * SOURCE OF TRUTH KEYWORDS: signScopedKey, DOUBLE_CHECKED_KEY
 *
 * WHAT:  Signs a key only if the key itself belongs to this workspace or to the
 *        shared library.
 * WHY:   The second half of SIGNING_BOUNDARY, factored out so both signing
 *        functions provably apply the identical rule. Exported because the
 *        router signs already-authorized list rows in bulk through it rather
 *        than re-reading each one — the rows came out of a scoped query, and
 *        this still re-checks the key.
 * WHERE: signAssetUrl, signVariantUrl, and the list path in the assets router.
 */
export async function signScopedKey(
  storageKey: string,
  organizationId: string,
  ttlSeconds?: number,
): Promise<string | null> {
  if (
    !isOwnedByOrganization(storageKey, organizationId) &&
    !isLibraryKey(storageKey)
  ) {
    /* Not an exception: a mismatched key is a data problem, and an asset list
     * must still render with one broken tile rather than erroring entirely. */
    console.error(
      `[assets.service] Refusing to sign "${storageKey}" for organization ${organizationId} — the key is outside its prefix.`,
    );
    return null;
  }

  const storage = await getStorageAdapter();
  return storage.signedGetUrl(storageKey, ttlSeconds);
}

/**
 * SOURCE OF TRUTH KEYWORDS: collectAssetObjectKeys, DELETE_REMOVES_EVERY_OBJECT
 *
 * WHAT:  Every storage key an asset owns: its own object plus each variant's.
 * WHY:   DELETE_REMOVES_EVERY_OBJECT. Deleting the row cascades the variant
 *        ROWS and leaves their OBJECTS in the bucket forever, where they go on
 *        costing money and are no longer reachable from any record — so the
 *        keys have to be collected BEFORE the delete, while the rows still
 *        exist. Doing it after is the bug this function's existence prevents.
 * WHERE: assets.delete.
 */
export function collectAssetObjectKeys(asset: AssetWithVariants): string[] {
  return [
    asset.storageKey,
    ...asset.variants.map((variant) => variant.storageKey),
  ];
}

export async function deleteAssetRow(db: DbClient, id: string): Promise<void> {
  /* Variants go with it through the schema's onDelete: Cascade. */
  await db.asset.delete({ where: { id } });
}

/**
 * SOURCE OF TRUTH KEYWORDS: sumAssetBytes, STORAGE_COUNTER_RECONCILIATION
 *
 * WHAT:  The total bytes of a workspace's OWN assets.
 * WHY:   The `storage` counter is maintained incrementally by the handlers
 *        (BYTES_METERED_ON_STORAGE), which means it can drift — a failed delete
 *        after a successful object removal, a row written by a future import
 *        path. This is the number it should equal, available for the
 *        reconciliation cron architecture.md schedules and for an operator
 *        answering "why does this workspace say it is full".
 *        Library rows are excluded: they are the operator's bytes, not the
 *        tenant's, and charging a shared background to every workspace that can
 *        see it would make the quota meaningless.
 * WHERE: Available to the portal console and the cleanup cron; not on the
 *        request path.
 */
export async function sumAssetBytes(
  db: DbClient,
  organizationId: string,
): Promise<number> {
  const result = await db.asset.aggregate({
    where: { organizationId },
    _sum: { bytes: true },
  });
  return result._sum.bytes ?? 0;
}

/**
 * SOURCE OF TRUTH KEYWORDS: signDocumentAssets, AUDIO_HAS_NO_VIDEO_VARIANT,
 *   VARIANT_WITH_FALLBACK, ONE_QUERY_PER_DOCUMENT, SIGNING_BOUNDARY
 *
 * WHAT:  Resolves every asset handle in a timeline document to a signed URL at
 *        the requested quality, as the map the Remotion composition is handed.
 * WHY:   ONE_QUERY_PER_DOCUMENT. The handles arrive together, so the rows are
 *        read in ONE `findMany` rather than a query per handle — a document
 *        with twenty clips would otherwise open twenty round-trips on every
 *        preview load, which is the n+1 that makes a player feel broken.
 *        Signing itself is local HMAC and costs nothing per asset.
 *
 *        VARIANT_WITH_FALLBACK: the quality picks a variant
 *        (VARIANT_BY_QUALITY — `proxy_480` to scrub, `vertical_1080` to
 *        render), and a missing variant falls back to the ORIGINAL object
 *        rather than failing. Two ordinary situations need that, and only one
 *        of them is a problem:
 *
 *          AUDIO_HAS_NO_VIDEO_VARIANT — the ingest builds a waveform for audio
 *          and nothing else (see planVariants), so narration and music have no
 *          proxy and no master BY DESIGN. For them the original IS the right
 *          object, and this is the normal path, not a degradation.
 *
 *          An ingest that has not finished yet, where the original exists and
 *          the variants do not. The preview then plays the full-size file —
 *          heavier than it should be, but playable, which beats a silent gap.
 *
 *        The returned `variant` field records which of the two happened, so a
 *        caller can tell a deliberate fallback from an accidental one without
 *        guessing from the file size.
 *
 *        Scoped through assetScopeWhere, so a document referencing another
 *        workspace's asset id resolves to `url: null` rather than to that
 *        workspace's media — the document is data, and a stored id is not
 *        authority to read it. Every URL additionally goes through
 *        signScopedKey's own key check (SIGNING_BOUNDARY).
 * WHERE: `projects.preview` in src/trpc/routers/projects.ts; the render
 *        pre-flight in Phase 04, which asks for `final`.
 */
export async function signDocumentAssets(
  db: DbClient,
  handles: readonly {
    handle: string;
    ref: { assetId: string; kind: ResolvedAsset["kind"] };
  }[],
  organizationId: string,
  quality: RenderQuality,
): Promise<AssetUrlMap> {
  const map: AssetUrlMap = {};
  if (handles.length === 0) return map;

  const wanted = VARIANT_BY_QUALITY[quality];
  const ttl = TTL_BY_QUALITY[quality];

  const rows = await db.asset.findMany({
    where: {
      id: { in: [...new Set(handles.map((entry) => entry.ref.assetId))] },
      ...assetScopeWhere(organizationId),
    },
    include: { variants: true },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const { handle, ref } of handles) {
    const row = byId.get(ref.assetId);

    /* A handle whose row is missing, deleted, or belongs to another workspace.
     * Null, not an exception: MISSING_ASSET_IS_NOT_AN_ERROR — the renderer
     * draws a gap and the rest of the video still renders. */
    if (row === undefined) {
      map[handle] = {
        assetId: ref.assetId,
        kind: ref.kind,
        url: null,
        variant: null,
      };
      continue;
    }

    const variantRow = row.variants.find(
      (candidate) => candidate.variant === wanted,
    );
    const key = variantRow?.storageKey ?? row.storageKey;
    const url = await signScopedKey(key, organizationId, ttl);

    map[handle] = {
      assetId: row.id,
      kind: ref.kind,
      url,
      variant: variantRow === undefined ? null : wanted,
      /* Dimensions come from the VARIANT when there is one — a proxy is 480
       * wide and the row's own width is the master's, and a component sizing
       * against the wrong one would letterbox its own media. */
      ...(row.durationSec !== null
        ? { durationInSeconds: row.durationSec }
        : {}),
      ...(variantRow?.width != null
        ? { width: variantRow.width }
        : row.width !== null
          ? { width: row.width }
          : {}),
      ...(variantRow?.height != null
        ? { height: variantRow.height }
        : row.height !== null
          ? { height: row.height }
          : {}),
    };
  }

  return map;
}
