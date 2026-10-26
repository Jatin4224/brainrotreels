/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: backgroundsRouter, backgroundLibrary.list,
 *   backgroundLibrary.applyBackground, backgroundLibrary.sync, LOCKED_NOT_HIDDEN,
 *   BREADTH_IS_APPLIED_AT_READ_TIME, APPLY_IS_THE_BOUNDARY, PORTAL_ONLY_SYNC,
 *   NULL_CLEARS_THE_CHOICE, LIBRARY_IS_SERVED_FROM_THE_CDN
 *
 * WHAT:  The catalogue a workspace browses, the background a project uses, and
 *        the operator's import of the curated manifest.
 *
 * WHY:   LOCKED_NOT_HIDDEN, the same rule as `voices.list` and the caption
 *        gallery. `list` returns every catalogue row it has a page for, each
 *        marked `locked` or not — never a plan-filtered subset. Filtering in
 *        SQL is the obvious implementation and it quietly removes the entire
 *        upsell: a background a customer never sees is one they have no reason
 *        to pay for.
 *
 *        BREADTH_IS_APPLIED_AT_READ_TIME. `RESOURCES.backgroundLibrary.limit`
 *        caps how much of the CATALOGUE a plan may use, and because that
 *        resource has no `create` verb, none of the factory's automatic quota
 *        machinery fires for it — no gate, no counter, nothing in
 *        `UsageMetrics` (BREADTH_NOT_A_COUNTER on the registry entry). The cap
 *        is enforced here instead, as a RANK comparison: a row's position in
 *        the catalogue's stable oldest-first ordering decides whether it is
 *        within the plan's breadth. `skip` is that rank for the first row on a
 *        page, which is why this handler can apply a catalogue-wide cap without
 *        counting the whole table.
 *
 *        APPLY_IS_THE_BOUNDARY. Both gates are re-checked on the write — the
 *        breadth cap and the row's own `minPlan` — because a lock badge stops a
 *        mistake, not a request. The refusal carries the registry's upgrade
 *        sentence, so the client opens the same modal it would from a gated
 *        tile.
 *
 *        PORTAL_ONLY_SYNC, exactly as `voices.sync` is and for the identical
 *        reason: library rows have `organizationId: null` and are served to
 *        every tenant, so a tenant able to write them could replace or withdraw
 *        a background for everybody. The permission is necessary and not
 *        sufficient.
 * WHERE: Mounted as `backgroundLibrary` in src/trpc/routers/_app.ts. Reads and
 *        writes through src/services/backgrounds.service.ts; the byte-fetching
 *        is handed to the `library.ingest` workflow via `library/requested`.
 */

import { TRPCError } from "@trpc/server";

import { createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import { getOrganizationTier } from "@/lib/feature-gate";
import {
  getResourceLimitForPlan,
  getUpgradeMessage,
  RESOURCES,
} from "@/lib/resources";
import { enqueueMany } from "@/lib/adapters/jobs";
import { assetObjectKey, libraryKindForAssetKind } from "@/lib/adapters/storage";
import { manifestEntriesFor } from "@/lib/library/backgrounds.manifest";
import * as backgroundsService from "@/services/backgrounds.service";
import { signScopedKey } from "@/services/assets.service";
import {
  applyBackgroundSchema,
  BACKGROUND_ASSET_KINDS,
  backgroundAvailableOnPlan,
  extensionForContentType,
  libraryAssetId,
  listBackgroundsSchema,
  syncBackgroundLibrarySchema,
} from "@/lib/types";
import type { BackgroundRow } from "@/services/backgrounds.service";
import { writeGenerateSettings } from "@/services/pipeline.service";

/**
 * SOURCE OF TRUTH KEYWORDS: BackgroundTile, TILE_IS_WHAT_A_PICKER_NEEDS
 *
 * WHAT:  One row as the picker renders it: the facts, the poster URL, and the
 *        two booleans that decide how the tile behaves.
 *
 * WHY:   TILE_IS_WHAT_A_PICKER_NEEDS. Named rather than inferred so the shape
 *        survives to the client through `inferRouterOutputs` and so the two
 *        lists (catalogue and uploads) are provably the same shape — the
 *        component renders one grid from both, and a structural difference
 *        would mean two renderers.
 *
 *        `locked` is ONE boolean although it has two causes — the row's
 *        `minPlan`, and the plan's catalogue breadth — because the tile does
 *        the same thing either way: it opens the upgrade modal. `lockReason`
 *        carries which, for the copy.
 *
 *        `loopable` is surfaced rather than inferred client-side from
 *        `durationSec`, because the rule belongs to the renderer
 *        (LOOP_IS_A_MODULO) and a second copy of it in a component is how the
 *        picker ends up promising a seamless loop the render cannot deliver.
 * WHERE: `list` below; src/components/global/background-picker.
 */
export interface BackgroundTile {
  id: string;
  filename: string;
  kind: string;
  source: string;
  contentType: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  license: string;
  minPlan: string | null;
  /** True when this workspace owns it; false for a shared catalogue row. */
  mine: boolean;
  locked: boolean;
  lockReason: "plan" | "breadth" | null;
  /** Whether the renderer can loop it to the narration's length. */
  loopable: boolean;
  /** CDN for library rows, signed for uploads — see signScopedKey. */
  posterUrl: string | null;
}

export const backgroundsRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: backgroundLibrary.list, LOCKED_NOT_HIDDEN,
   *   BREADTH_IS_APPLIED_AT_READ_TIME, TWO_LISTS_ONE_SHAPE
   *
   * WHAT:  A page of the catalogue, the workspace's own usable media, and which
   *        row is currently selected.
   *
   * WHY:   TWO_LISTS_ONE_SHAPE. The catalogue and the uploads are separate
   *        queries and separate arrays, because the breadth cap applies to one
   *        of them and not the other: interleaved, a workspace that uploaded
   *        twenty clips of its own would push catalogue rows past its plan's
   *        breadth and lock backgrounds it has paid for
   *        (LIBRARY_IS_ITS_OWN_QUERY in the service).
   *
   *        `selected` comes from the SAME resolver the pipeline uses
   *        (ONE_RESOLVER_TWO_CALLERS), so the tile the customer sees highlighted
   *        is the row that will actually be in the video — including when it is
   *        a default nobody has chosen yet. Returning the project's raw stored
   *        setting instead would highlight nothing on a new project and would
   *        keep highlighting a background that has since been deleted.
   * WHERE: The picker's query.
   */
  list: protectedProcedure({
    requirePermission: permissions.BACKGROUND_LIBRARY_READ,
    paginate: true,
  })
    .input(listBackgroundsSchema)
    .query(async ({ ctx, input }) => {
      const { skip, take, pageSize } = ctx.pagination;
      const kinds = input.kinds ?? [...BACKGROUND_ASSET_KINDS];
      const includeUploads = input.includeUploads ?? true;

      const tier = await getOrganizationTier(input.organizationId);
      const breadth = getResourceLimitForPlan(
        "backgroundLibrary",
        tier.tier,
      );
      const upgradeMessage = getUpgradeMessage(
        "backgroundLibrary",
        tier.tier,
      );

      /* A_CURSOR_NOT_A_ROW_INDEX. Resolved once, before the page is read, so
       * the lock badge is correct under a search as well — a row's position
       * among the MATCHES says nothing about its position in the catalogue. */
      const cursor = await backgroundsService.breadthCursor(ctx.db, {
        kinds,
        breadth,
      });

      const [catalogue, uploads, selected] = await Promise.all([
        backgroundsService.listLibraryAssets(
          ctx.db,
          { kinds, search: input.search },
          { skip, take },
        ),
        includeUploads
          ? backgroundsService.listWorkspaceBackgrounds(
              ctx.db,
              {
                organizationId: input.organizationId,
                /* A customer's own video file is kind `upload`, not
                 * `background` — the upload path never lets a client name the
                 * kind (UPLOADABLE_ASSET_KINDS) — so the picker has to ask for
                 * both, plus whatever of the catalogue kinds a workspace might
                 * somehow own. */
                kinds: [...kinds, "upload"],
                search: input.search,
              },
              { skip: 0, take },
            )
          : Promise.resolve({ items: [], total: 0 }),
        input.projectId === undefined
          ? Promise.resolve(null)
          : backgroundsService.resolveProjectBackground(ctx.db, {
              organizationId: input.organizationId,
              projectId: input.projectId,
              plan: tier.tier,
              kinds,
            }),
      ]);

      const libraryTiles = await Promise.all(
        catalogue.items.map((row) =>
          tileFor(row, {
            organizationId: input.organizationId,
            mine: false,
            plan: backgroundAvailableOnPlan(row.minPlan, tier.tier),
            /* BREADTH_IS_APPLIED_AT_READ_TIME, through the same pure
             * comparison the write refusal makes. */
            withinBreadth: backgroundsService.isWithinBreadth(row, cursor),
          }),
        ),
      );

      const uploadTiles = await Promise.all(
        uploads.items.map((row) =>
          /* A workspace's own file is never locked: it is not part of the
           * catalogue, so neither gate applies to it. */
          tileFor(row, {
            organizationId: input.organizationId,
            mine: true,
            plan: true,
            withinBreadth: true,
          }),
        ),
      );

      return {
        plan: tier.tier,
        upgradeMessage,
        /* What the plan's breadth actually is, so the picker can say "10 of 40"
         * rather than counting locked tiles and guessing. Infinity does not
         * survive JSON, so an unlimited plan reports null. */
        breadth: Number.isFinite(breadth) ? breadth : null,
        items: libraryTiles,
        uploads: uploadTiles,
        lockedCount: libraryTiles.filter((tile) => tile.locked).length,
        total: catalogue.total,
        totalPages: Math.max(1, Math.ceil(catalogue.total / pageSize)),
        selectedAssetId: selected?.row.id ?? null,
        /* Whether the selection is the customer's own decision or a default we
         * chose for them — the picker words the two differently, because
         * "using this" and "we picked this for you" are not the same claim. */
        selectionOrigin: selected?.origin ?? null,
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: backgroundLibrary.applyBackground, APPLY_IS_THE_BOUNDARY,
   *   NULL_CLEARS_THE_CHOICE, SETTINGS_ARE_MERGED
   *
   * WHAT:  Sets (or clears) the background a project will render with.
   *
   * WHY:   APPLY_IS_THE_BOUNDARY — see the file header. Three refusals, in the
   *        order that makes the message useful:
   *
   *          1. The row is not usable at all (missing, another workspace's,
   *             still ingesting, not cleared by moderation) → NOT_FOUND, which
   *             is also the right answer for somebody else's asset because
   *             FORBIDDEN would confirm the id exists.
   *          2. The row is above this plan's `minPlan` → FORBIDDEN carrying the
   *             registry's upgrade sentence.
   *          3. The row is beyond this plan's catalogue breadth → the same
   *             FORBIDDEN, different sentence. Both are the upgrade modal.
   *
   *        NULL_CLEARS_THE_CHOICE rather than a second mutation: `assetId:
   *        null` goes back to the styled backdrop, which is a real choice.
   *
   *        No document is rewritten. A project's timeline is the pipeline's
   *        OUTPUT, so changing the background changes the next GENERATION —
   *        unlike a caption restyle, which `captions.applyStyle` can apply to
   *        an existing document because it provably cannot change the timing.
   *        Swapping the footage changes what every frame looks like, and
   *        half-rewriting a document from a router would produce a preview the
   *        pipeline never built. The handler says so in its return value so the
   *        UI can tell the customer.
   * WHERE: The picker's tiles and its Remove action.
   */
  applyBackground: protectedProcedure({
    requirePermission: permissions.BACKGROUND_LIBRARY_APPLY,
    audit: { action: "applyBackground" },
  })
    .input(applyBackgroundSchema)
    .mutation(async ({ ctx, input }) => {
      const tier = await getOrganizationTier(input.organizationId);

      if (input.assetId === null) {
        /* NULL_CLEARS_THE_CHOICE — the key is removed, not blanked, so the
         * settings object stays valid (CLEARING_IS_NOT_PATCHING). */
        const cleared = await writeGenerateSettings(
          ctx.db,
          input.organizationId,
          input.projectId,
          {},
          ["backgroundAssetId"],
        );
        if (!cleared) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }
        return { assetId: null, appliesToNextGeneration: true };
      }

      const row = await backgroundsService.findUsableBackground(
        ctx.db,
        input.organizationId,
        input.assetId,
      );
      if (row === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That background is no longer available.",
        });
      }

      /* A background is FOOTAGE. `backgroundAssetId` is read by the generator
       * to build a video item, so a music bed or a waveform-only audio row
       * would produce a document claiming a clip that cannot be drawn. The
       * picker never offers one; this is the boundary saying so. */
      const isFootage =
        (BACKGROUND_ASSET_KINDS as readonly string[]).includes(row.kind) ||
        row.kind === "upload";
      if (!isFootage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That file cannot be used as a background.",
        });
      }

      const upgradeMessage = getUpgradeMessage(
        "backgroundLibrary",
        tier.tier,
      );

      if (!backgroundAvailableOnPlan(row.minPlan, tier.tier)) {
        throw new TRPCError({ code: "FORBIDDEN", message: upgradeMessage });
      }

      /* The breadth cap, re-checked server-side. Only the CATALOGUE is capped,
       * so a workspace's own upload skips this entirely — and the cursor is
       * recomputed here rather than trusted from the list response, because a
       * boundary the client sent would be one it could move.
       *
       * The SAME kind set and the SAME pure comparison the list uses, so the
       * badge and this refusal cannot disagree by a row. */
      if (row.organizationId === null) {
        const breadth = getResourceLimitForPlan("backgroundLibrary", tier.tier);
        const cursor = await backgroundsService.breadthCursor(ctx.db, {
          kinds: [...BACKGROUND_ASSET_KINDS],
          breadth,
        });

        if (!backgroundsService.isWithinBreadth(row, cursor)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Your plan includes the first ${breadth} ${RESOURCES.backgroundLibrary.limit.unit ?? "backgrounds"} in the library. ${upgradeMessage}`,
          });
        }
      }

      const saved = await writeGenerateSettings(
        ctx.db,
        input.organizationId,
        input.projectId,
        { backgroundAssetId: row.id },
      );
      if (!saved) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      return {
        assetId: row.id,
        filename: row.filename,
        /* Said out loud: the current preview is unchanged until the project is
         * generated again. */
        appliesToNextGeneration: true,
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: backgroundLibrary.sync, PORTAL_ONLY_SYNC,
   *   MANIFEST_IS_THE_REVIEW, LIBRARY_IS_ITS_OWN_EVENT
   *
   * WHAT:  Imports the curated manifest: a catalogue row per entry, and a
   *        durable run per entry to fetch its bytes.
   *
   * WHY:   PORTAL_ONLY_SYNC — refused outside the portal workspace on top of
   *        the permission, because a custom role in a tenant could otherwise be
   *        granted `backgroundLibrary:sync` and write rows every other tenant
   *        reads.
   *
   *        The FETCH is not done here. A manifest row is a multi-megabyte
   *        download followed by four transcodes, and this handler runs inside a
   *        10-second Prisma transaction — so the rows are written and one
   *        `library/requested` event is enqueued per entry
   *        (LIBRARY_IS_ITS_OWN_EVENT). The run then hands the asset to the
   *        ordinary ingest, so library rows get exactly the variants uploads
   *        get.
   *
   *        `dryRun` reports what it WOULD do and writes nothing, which is the
   *        first thing anybody wants from a sync against a live catalogue.
   *        Unknown keys are REPORTED rather than ignored — an operator who
   *        mistypes a key and is told "0 created" cannot tell that from a sync
   *        with nothing to do.
   *
   *        Rows are never deleted. `voices.sync` deactivates what the provider
   *        stopped offering (DEACTIVATE_NEVER_DELETE); here, an entry removed
   *        from the manifest leaves its asset in place, because projects point
   *        at it and deleting it would put a hole in videos that already use
   *        it. Withdrawing a background is raising its `minPlan` or deleting it
   *        through the media surface, deliberately, not a side effect of
   *        editing a file.
   * WHERE: Called as the portal workspace. There is NO screen for it yet —
   *        the same state `voices.sync` is in, and deliberately: a catalogue
   *        import is an operator action against an empty manifest, so a
   *        console for it would be a button with nothing to sync. Phase 17's
   *        platform surface is where an operator console belongs.
   */
  sync: protectedProcedure({
    requirePermission: permissions.BACKGROUND_LIBRARY_SYNC,
    audit: { action: "sync" },
    /* A row per manifest entry plus an enqueue each. The default ten seconds is
     * tight for a catalogue of forty. */
    txTimeout: 60_000,
  })
    .input(syncBackgroundLibrarySchema)
    .mutation(async ({ ctx, input }) => {
      /* PORTAL_ONLY_SYNC — the permission is necessary and not sufficient. */
      const organization = await ctx.db.organization.findUnique({
        where: { id: input.organizationId },
        select: { isPortalOrganization: true },
      });
      if (organization?.isPortalOrganization !== true) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The background library can only be synced from the portal.",
        });
      }

      const { entries, unknownKeys } = manifestEntriesFor(input.keys);
      const dryRun = input.dryRun === true;

      let created = 0;
      let updated = 0;
      const queued: { manifestKey: string; assetId: string }[] = [];

      for (const entry of entries) {
        const assetId = libraryAssetId(entry.key);
        const libraryKind = libraryKindForAssetKind(entry.kind);
        if (libraryKind === null) {
          /* Unreachable through the manifest schema, which only admits kinds
           * the library has folders for — checked rather than asserted because
           * `!` is banned and a silent skip would be worse than a loud one. */
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Manifest entry "${entry.key}" has a kind with no library folder.`,
          });
        }

        const extension = extensionForContentType(entry.contentType);
        if (extension === null) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Manifest entry "${entry.key}" has an unsupported content type.`,
          });
        }

        if (dryRun) continue;

        /* SYNC_PRESERVES_THE_OBJECT — the key is derived from the id, which is
         * derived from the manifest key, so it is the same on every sync and
         * the bytes are fetched once. */
        const result = await backgroundsService.upsertLibraryAsset(ctx.db, {
          id: assetId,
          kind: entry.kind,
          filename: entry.title,
          storageKey: assetObjectKey(
            { scope: "library", libraryKind },
            assetId,
            `original.${extension}`,
          ),
          contentType: entry.contentType,
          license: entry.license,
          minPlan: entry.minPlan,
        });

        if (result.created) created += 1;
        else updated += 1;

        queued.push({ manifestKey: entry.key, assetId });
      }

      if (queued.length > 0) {
        await enqueueMany(
          queued.map(({ manifestKey, assetId }) => ({
            requestId: ctx.requestId,
            name: "library/requested" as const,
            data: {
              manifestKey,
              assetId,
              organizationId: input.organizationId,
            },
            /* Keyed on the asset, so re-running a sync while the first one is
             * still working does not start a second fetch of the same object. */
            id: `library-${assetId}`,
          })),
        );
      }

      return {
        dryRun,
        found: entries.length,
        created,
        updated,
        queued: queued.length,
        unknownKeys,
      };
    }),
});

/**
 * SOURCE OF TRUTH KEYWORDS: tileFor, TILE_IS_WHAT_A_PICKER_NEEDS,
 *   LIBRARY_IS_SERVED_FROM_THE_CDN
 *
 * WHAT:  One row turned into a tile, with its poster URL resolved.
 * WHY:   One function for both lists, so the catalogue and the uploads
 *        provably render the same shape — the picker draws one grid from both.
 *
 *        The poster goes through `signScopedKey`, which is also what decides
 *        CDN versus signed: a library key resolves to the permanent public URL
 *        and an upload to a short-lived signed one, and this handler does not
 *        need to know which it got. A row with no thumb yet (nothing to poster,
 *        or a variant that failed) gets null and the tile falls back to an
 *        icon — the same degradation the media grid already does.
 * WHERE: `list` above.
 */
async function tileFor(
  row: BackgroundRow,
  context: {
    organizationId: string;
    mine: boolean;
    plan: boolean;
    withinBreadth: boolean;
  },
): Promise<BackgroundTile> {
  const thumb = row.variants[0];
  const posterUrl =
    thumb === undefined
      ? null
      : await signScopedKey(thumb.storageKey, context.organizationId);

  const locked = !context.plan || !context.withinBreadth;

  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    source: row.source,
    contentType: row.contentType,
    durationSec: row.durationSec,
    width: row.width,
    height: row.height,
    license: row.license,
    minPlan: row.minPlan,
    mine: context.mine,
    locked,
    /* The plan gate is named FIRST when both apply, because it is the one a
     * customer can read off the tile's own badge. */
    lockReason: !context.plan ? "plan" : !context.withinBreadth ? "breadth" : null,
    loopable: row.durationSec !== null && row.durationSec > 0,
    posterUrl,
  };
}
