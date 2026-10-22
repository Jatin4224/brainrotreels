/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: assetsRouter, assets.createUploadUrl,
 *   assets.completeUpload, assets.list, assets.get, assets.update,
 *   assets.delete, BYTES_METERED_ON_STORAGE, GATE_BEFORE_SIGNING,
 *   TRUST_THE_BUCKET_NOT_THE_CLIENT, DELETE_REMOVES_EVERY_OBJECT
 *
 * WHAT:  The media surface: a two-step upload (sign, then confirm), a paginated
 *        library read, a single read with signed URLs, rename and delete.
 * WHY:   BYTES_METERED_ON_STORAGE. `assets` declares no `limit` of its own
 *        (see RESOURCES.assets), so NONE of the factory's automatic quota
 *        behaviour fires for this router — there is no gate on create and no
 *        counter bump on create or delete. Every one of those is hand-written
 *        here against `storage`, which is the resource that actually owns the
 *        quota, following the same documented pattern invitation.create uses
 *        for seats. Grep BYTES_METERED_ON_STORAGE for all three sites.
 *
 *        GATE_BEFORE_SIGNING is the ordering that matters most in this file.
 *        The storage gate is checked in `createUploadUrl`, BEFORE a write URL
 *        exists — refusing in `completeUpload` would mean the bytes are already
 *        in the bucket and already costing money, and the only remaining
 *        choices would be to charge for them or to silently delete a
 *        customer's file.
 *
 *        TRUST_THE_BUCKET_NOT_THE_CLIENT: `completeUpload` HEADs the object and
 *        charges the quota the size R2 reports. A client-supplied byte count is
 *        a number the quota is billed on, so it is exactly the number not to
 *        take on trust.
 * WHERE: Mounted as `assets` in src/trpc/routers/_app.ts. Reads and writes
 *        through src/services/assets.service.ts; the heavy work is handed to
 *        the `asset.ingest` workflow via `asset/uploaded`.
 */

import { TRPCError } from "@trpc/server";

import { createStructuredError, createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import { checkFeatureGate, getOrganizationTier } from "@/lib/feature-gate";
import { ERROR_CODES } from "@/lib/errors";
import { decrementUsage, incrementUsage } from "@/services/usage.service";
import {
  DEFAULT_SIGNED_PUT_TTL_SECONDS,
  getStorageAdapter,
  isOwnedByOrganization,
  uploadKey,
} from "@/lib/adapters/storage";
import { enqueue } from "@/lib/adapters/jobs";
import * as assetsService from "@/services/assets.service";
import {
  completeUploadSchema,
  createUploadUrlSchema,
  deleteAssetSchema,
  extensionForContentType,
  getAssetSchema,
  kindForContentType,
  listAssetsSchema,
  maxUploadBytesForPlan,
  renameAssetSchema,
  VARIANT_NAMES,
  type VariantName,
} from "@/lib/types";
import { formatBytes } from "@/lib/resources";

/**
 * SOURCE OF TRUTH KEYWORDS: SignedVariant, assets.get
 *
 * WHAT:  One variant as `assets.get` returns it — its dimensions plus a
 *        short-lived URL.
 * WHY:   Named rather than inferred so the full map `assets.get` returns keeps
 *        its `Record<VariantName, SignedVariant | null>` shape all the way to
 *        the client. `url` is nullable because signing can legitimately refuse
 *        (a row whose key is outside its own prefix — see SIGNING_BOUNDARY),
 *        and a consumer has to handle that rather than render a broken player.
 * WHERE: The `get` handler below; reached on the client through
 *        inferRouterOutputs.
 */
interface SignedVariant {
  variant: VariantName;
  width: number | null;
  height: number | null;
  bytes: number;
  url: string | null;
}

export const assetsRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: assets.createUploadUrl, GATE_BEFORE_SIGNING,
   *   EXACT_CONTENT_LENGTH, PER_FILE_CAP_NOT_A_QUOTA
   *
   * WHAT:  Issues a presigned PUT for one file, after proving the workspace is
   *        allowed to store it.
   * WHY:   Three refusals, in this order, because each is cheaper than the next
   *        and because the last one is the one a customer can act on:
   *
   *          1. The PER-FILE cap for the plan (PER_FILE_CAP_NOT_A_QUOTA) — a
   *             plain BAD_REQUEST, since no upgrade makes an arbitrarily large
   *             file acceptable; the message names the cap.
   *          2. The STORAGE quota, via checkFeatureGate with the real byte
   *             count. This throws the same structured FORBIDDEN the factory's
   *             own gate throws, carrying the registry's upgrade copy, so the
   *             client's upgrade modal opens identically whether the refusal
   *             came from here or from an auto-gated path.
   *          3. Nothing else. The content type is validated by the schema and
   *             the key is built by the key helpers.
   *
   *        `audit: false` deliberately. This mutation changes no state — it
   *        hands out a URL — and a row per issued URL would bury the row that
   *        matters (the upload itself, recorded by completeUpload) under noise.
   *        The per-resource rate limit on this path is what makes abuse of it
   *        visible instead.
   * WHERE: Called once per file by src/components/global/media-upload.
   */
  createUploadUrl: protectedProcedure({
    requirePermission: permissions.ASSETS_CREATE,
    audit: false,
  })
    .input(createUploadUrlSchema)
    .mutation(async ({ input }) => {
      const tier = await getOrganizationTier(input.organizationId);
      const perFileCap = maxUploadBytesForPlan(tier.tier);

      if (input.bytes > perFileCap) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `That file is ${formatBytes(input.bytes)}. The largest single file on your plan is ${formatBytes(perFileCap)}.`,
        });
      }

      /* GATE_BEFORE_SIGNING — the quota is checked for THIS MANY BYTES, not for
       * "one more asset". That is the whole reason the gate takes a quantity. */
      const gate = await checkFeatureGate(
        input.organizationId,
        "storage",
        input.bytes,
      );
      if (!gate.allowed) {
        throw createStructuredError(
          "FORBIDDEN",
          gate.reason || "Storage limit reached",
          {
            errorCode: ERROR_CODES.USAGE_LIMIT_REACHED,
            resource: "storage",
            limit: gate.limit ?? 0,
            current: gate.currentUsage ?? 0,
            currentPlan: gate.plan,
            upgradeRequired: true,
            message:
              gate.reason || "This upload would exceed your storage limit",
            upgradeMessage: gate.upgradeMessage,
          },
        );
      }

      /* The asset id is minted HERE, before the row exists, because the key
       * contains it and the key has to be signed before any bytes are stored.
       * It is NOT the row's id — `completeUpload` creates the row with the
       * schema's own cuid and stores this key against it. That is deliberate:
       * tying the key to a row id would mean creating the row before knowing
       * whether the upload happens, leaving a `processing` asset behind for
       * every abandoned drag. A hex uuid rather than a cuid because this is
       * only ever a key segment, and `assertKeySegment` is what validates it. */
      const assetId = crypto.randomUUID().replace(/-/g, "");
      const extension = extensionForContentType(input.contentType);
      if (extension === null) {
        /* Unreachable through the schema, which only admits allowlisted types.
         * Kept because the schema and the allowlist are two objects, and this
         * is the line that fails loudly rather than storing `original.null`. */
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `We do not accept ${input.contentType} files.`,
        });
      }

      /* NEVER a hand-built key — the prefix is what enforces tenancy at the
       * storage layer (STORAGE_KEY_CONVENTION). The stored object is named from
       * the content type, not from the customer's filename: a name the browser
       * supplied has no business in a key, and the display name is kept on the
       * row instead. */
      const storageKey = uploadKey(
        input.organizationId,
        assetId,
        `original.${extension}`,
      );

      const storage = await getStorageAdapter();
      const url = await storage.signedPutUrl(storageKey, {
        contentType: input.contentType,
        /* EXACT_CONTENT_LENGTH: the real size, because it is signed INTO the
         * URL and R2 rejects a body of any other length. See
         * createUploadUrlSchema for why this is not the plan cap. */
        maxBytes: input.bytes,
      });

      return {
        url,
        storageKey,
        expiresInSeconds: DEFAULT_SIGNED_PUT_TTL_SECONDS,
        /* Echoed back so the client PUTs exactly what was signed rather than
         * re-deriving the header and disagreeing by a byte. */
        contentType: input.contentType,
        bytes: input.bytes,
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: assets.completeUpload, TRUST_THE_BUCKET_NOT_THE_CLIENT,
   *   BYTES_METERED_ON_STORAGE, asset/uploaded
   *
   * WHAT:  Creates the asset row for bytes that have landed, charges the
   *        storage quota, and starts the ingest workflow.
   * WHY:   The key is re-checked against the caller's prefix before anything is
   *        believed (isOwnedByOrganization): a client that could name an
   *        arbitrary key could attach another workspace's object to its own row
   *        and then read it through a signed URL legitimately issued for that
   *        row.
   *
   *        Then the object is HEADed — TRUST_THE_BUCKET_NOT_THE_CLIENT. This
   *        does two jobs at once: it proves the upload actually happened (a
   *        client calling this without uploading gets NOT_FOUND rather than a
   *        phantom row), and it produces the byte count the quota is charged
   *        on. The row is created and the counter bumped with THAT number.
   *
   *        The ingest event is sent LAST, and outside the row write by design:
   *        it carries only the id, keyed for idempotency on it, so two
   *        confirmations of the same upload collapse to one ingest run rather
   *        than two competing transcodes writing the same variant keys.
   * WHERE: Called by the drop zone once its PUT resolves.
   */
  completeUpload: protectedProcedure({
    requirePermission: permissions.ASSETS_CREATE,
  })
    .input(completeUploadSchema)
    .mutation(async ({ ctx, input }) => {
      if (!isOwnedByOrganization(input.storageKey, input.organizationId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That storage location does not belong to this workspace.",
        });
      }

      const storage = await getStorageAdapter();
      const head = await storage.head(input.storageKey);
      if (head === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That upload did not complete. Please try again.",
        });
      }

      /* The kind is re-derived from the content type rather than taken from the
       * client (see UPLOADABLE_ASSET_KINDS); the client's hint only survives
       * when it agrees with what the file is. */
      const derivedKind = kindForContentType(input.contentType);
      if (derivedKind === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `We do not accept ${input.contentType} files.`,
        });
      }

      const asset = await assetsService.createProcessingAsset(ctx.db, {
        organizationId: input.organizationId,
        kind: input.kind ?? derivedKind,
        source: "upload",
        filename: input.filename,
        storageKey: input.storageKey,
        contentType: input.contentType,
        bytes: head.bytes,
      });

      /* BYTES_METERED_ON_STORAGE — by hand, because `assets` has no limit of
       * its own and the factory therefore bumps nothing. Inside the handler's
       * transaction, so a failed row write cannot leave the counter inflated. */
      await incrementUsage(input.organizationId, "storage", head.bytes, ctx.db);

      await enqueue({
        requestId: ctx.requestId,
        name: "asset/uploaded",
        data: { assetId: asset.id, organizationId: input.organizationId },
        id: `asset-ingest-${asset.id}`,
      });

      return asset;
    }),

  list: protectedProcedure({
    requirePermission: permissions.ASSETS_READ,
    paginate: true,
  })
    .input(listAssetsSchema)
    .query(async ({ ctx, input }) => {
      const { skip, take, pageSize } = ctx.pagination;
      const page = await assetsService.listAssets(
        ctx.db,
        {
          organizationId: input.organizationId,
          search: input.search,
          kinds: input.kinds,
          status: input.status,
        },
        { skip, take },
      );

      /* THUMB_URLS_WITH_THE_ROWS. The grid cannot render without them, so
       * fetching them per tile would be a request per asset on every page
       * change. Signing is local HMAC — no network call per row — and the rows
       * came out of the scoped query above, which signScopedKey still
       * re-checks against the key's own prefix. A row whose thumb is missing
       * (audio, or an ingest still running) gets null and the tile falls back
       * to an icon. */
      const items = await Promise.all(
        page.items.map(async (asset) => {
          const thumb = asset.variants[0];
          const thumbUrl =
            thumb === undefined
              ? null
              : await assetsService.signScopedKey(
                  thumb.storageKey,
                  input.organizationId,
                );
          const { variants: _variants, ...rest } = asset;
          return { ...rest, thumbUrl };
        }),
      );

      /* SERVER_TOTAL_PAGES — computed against the pageSize the FACTORY clamped
       * to, as in projects.list, so the client's pager cannot disagree with the
       * query that produced the rows. */
      return {
        items,
        total: page.total,
        totalPages: Math.max(1, Math.ceil(page.total / pageSize)),
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: assets.get, SIGNING_BOUNDARY, getAssetVariants
   *
   * WHAT:  One asset with every variant it has and a signed URL for each.
   * WHY:   Returns the FULL variant map including the nulls, because that is
   *        the published contract (getAssetVariants) and a caller deciding
   *        whether a proxy exists should not have to tell "absent" from
   *        "forgotten". Each URL is signed through the service's boundary, so a
   *        row with a corrupted key yields a null URL rather than a
   *        cross-tenant read.
   * WHERE: The media detail drawer; the editor's asset picker in Phase 15.
   */
  get: protectedProcedure({ requirePermission: permissions.ASSETS_READ })
    .input(getAssetSchema)
    .query(async ({ ctx, input }) => {
      const asset = await assetsService.findAssetWithVariants(
        ctx.db,
        input.organizationId,
        input.id,
      );
      if (!asset)
        throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });

      const url = await assetsService.signScopedKey(
        asset.storageKey,
        input.organizationId,
      );

      /* The rows are already loaded, so the map is built from them rather than
       * re-read — but it is built by the SERVICE's toVariantMap, not by a
       * `.find()` per name here, so the router and getAssetVariants cannot
       * disagree about an unrecognised variant name. */
      const rowsByVariant = assetsService.toVariantMap(asset.variants);
      const variants = assetsService.emptyVariantMap<SignedVariant>();

      for (const name of VARIANT_NAMES) {
        const row = rowsByVariant[name];
        if (row === null) continue;
        variants[name] = {
          variant: name,
          width: row.width,
          height: row.height,
          bytes: row.bytes,
          url: await assetsService.signScopedKey(
            row.storageKey,
            input.organizationId,
          ),
        };
      }

      const { variants: _variants, ...rest } = asset;

      return { ...rest, url, variants };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: assets.update, LIBRARY_IS_READ_ONLY
   *
   * WHAT:  Renames an asset. Nothing else about an asset is editable.
   * WHY:   LIBRARY_IS_READ_ONLY. The ownership predicate is "mine or library",
   *        so a plain scoped lookup would let a tenant rename a SHARED library
   *        row — visible to every other workspace. A write therefore needs the
   *        stricter check, and `organizationId === null` is exactly the case to
   *        refuse.
   *        Named `update` rather than `rename` so the registry's audit template
   *        and the permission constant line up with the path the factory
   *        derives; the input schema admits only `filename`, so the narrowness
   *        is in the contract rather than in the verb.
   * WHERE: The rename dialog in the media row menu.
   */
  update: protectedProcedure({ requirePermission: permissions.ASSETS_UPDATE })
    .input(renameAssetSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await assetsService.findAssetForOrganization(
        ctx.db,
        input.organizationId,
        input.id,
      );
      if (!existing)
        throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });

      if (existing.organizationId === null) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Library media is shared and cannot be renamed.",
        });
      }

      return assetsService.renameAsset(ctx.db, existing.id, input.filename);
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: assets.delete, DELETE_REMOVES_EVERY_OBJECT,
   *   BYTES_METERED_ON_STORAGE, ORPHAN_OBJECTS_OVER_MISSING_OBJECTS
   *
   * WHAT:  Removes an asset: the row, its variant rows, every object in the
   *        bucket, and the bytes from the storage counter.
   * WHY:   The order is the interesting part, and it is chosen for the failure
   *        direction rather than for tidiness:
   *
   *          1. Collect the keys WHILE the rows still exist
   *             (DELETE_REMOVES_EVERY_OBJECT — after the cascade they are
   *             unrecoverable and the objects would be billed forever).
   *          2. Delete the row. The variants cascade.
   *          3. Decrement `storage` by the recorded byte total, by hand
   *             (BYTES_METERED_ON_STORAGE) — the factory's auto-decrement does
   *             not fire, because `assets` is not a limit resource.
   *          4. Delete the objects, LAST.
   *
   *        ORPHAN_OBJECTS_OVER_MISSING_OBJECTS: step 4 is deliberately outside
   *        the part that can roll back. If the transaction failed after the
   *        objects were gone, the row would come back pointing at nothing — a
   *        tile that looks fine and 404s. This way the worst case is objects
   *        with no row, which cost storage and are swept by the cleanup cron,
   *        and which nothing in the product can be broken by.
   *
   *        Library rows are refused for the same reason as rename: deleting one
   *        would remove shared media from every workspace.
   * WHERE: The delete action in the media row menu.
   */
  delete: protectedProcedure({ requirePermission: permissions.ASSETS_DELETE })
    .input(deleteAssetSchema)
    .mutation(async ({ ctx, input }) => {
      const asset = await assetsService.findAssetWithVariants(
        ctx.db,
        input.organizationId,
        input.id,
      );
      if (!asset)
        throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });

      if (asset.organizationId === null) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Library media is shared and cannot be deleted.",
        });
      }

      const keys = assetsService.collectAssetObjectKeys(asset);

      await assetsService.deleteAssetRow(ctx.db, asset.id);
      await decrementUsage(
        input.organizationId,
        "storage",
        asset.bytes,
        ctx.db,
      );

      const storage = await getStorageAdapter();
      await storage.deleteObjects(keys);

      return { id: asset.id, filename: asset.filename, bytes: asset.bytes };
    }),
});
