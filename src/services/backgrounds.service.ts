/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: listLibraryAssets, listWorkspaceBackgrounds,
 *   findUsableBackground, lastBackgroundAssetId, firstLibraryBackground,
 *   upsertLibraryAsset, BACKGROUND_SELECT, BackgroundRow,
 *   CATALOGUE_ORDER_IS_STABLE, LIBRARY_IS_ITS_OWN_QUERY, USABLE_IS_FOUR_CHECKS,
 *   resolveProjectBackground, ResolvedBackground, recordLibraryBytes,
 *   libraryAssetId, DbClient
 *
 * WHAT:  The Prisma reads and writes behind the background library: the shared
 *        catalogue, a workspace's own usable media, the one row a project has
 *        chosen, and the upsert the operator's manifest sync performs.
 *
 * WHY:   LIBRARY_IS_ITS_OWN_QUERY, and this is the decision the whole file is
 *        shaped around. The obvious implementation lists "mine or library" in
 *        one query — `assetScopeWhere` exists and does exactly that — and it is
 *        the wrong shape here, because the plan's breadth cap applies to the
 *        CATALOGUE and not to a customer's own files. In one interleaved list,
 *        a workspace that uploaded twenty of its own clips would push the
 *        catalogue rows past its plan's breadth and lock backgrounds it is
 *        entitled to. Two queries, two lists, one gate on one of them.
 *
 *        CATALOGUE_ORDER_IS_STABLE. The catalogue is ordered by `createdAt`
 *        ASCENDING — the only ordering in this codebase that is not newest
 *        first, and it is load-bearing rather than a slip. A plan's breadth cap
 *        is "the first N of the catalogue", so the ordering decides WHICH N: on
 *        a newest-first list, every background the operator adds would silently
 *        push a different one out of reach of a free workspace, and a customer
 *        would find the loop they used last week locked. Oldest first means the
 *        set a plan can use only ever grows.
 *
 *        USABLE_IS_FOUR_CHECKS — see findUsableBackground. A background is
 *        usable when the workspace may READ it, the ingest finished, moderation
 *        cleared it, and the plan reaches its `minPlan`. Three of those are
 *        enforced elsewhere for every asset; the fourth is this phase's.
 *
 *        Pure Prisma, as every service is: no plan resolution, no entitlement
 *        read, no audit. `backgroundAvailableOnPlan` is applied by the ROUTER,
 *        which is where the tier has already been resolved.
 * WHERE: src/trpc/routers/backgrounds.ts, src/services/pipeline.service.ts
 *        (the generator's resolved background) and
 *        src/inngest/functions/library-ingest.ts.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma";
import { type DbClient } from "@/lib/config/prisma";
import type { PlanKey } from "@/lib/config/plans";
import type { AssetKind, AssetSource } from "@/lib/types/asset";
import {
  backgroundAvailableOnPlan,
  plansUpTo,
} from "@/lib/types/background";
import { assetScopeWhere, isModerationCleared } from "./assets.service";

/**
 * SOURCE OF TRUTH KEYWORDS: BACKGROUND_SELECT, BackgroundRow
 *
 * WHAT:  The columns a picker tile and a timeline document need.
 * WHY:   Narrower than ASSET_LIST_SELECT and wider in one place: `license` and
 *        `minPlan` are here because the tile shows the lock and the document
 *        carries the licence, and neither is on the media library's select.
 *        `durationSec` is what the looping maths needs
 *        (LOOP_IS_A_MODULO in src/remotion/components/media-clip.tsx), so a
 *        row without it cannot be looped and the picker says so.
 *
 *        The thumb variant is joined and NARROWED to the one variant, exactly
 *        as the media grid does: every tile needs a poster and fetching it per
 *        row is the n+1 that makes a grid feel broken.
 * WHERE: Both list functions below.
 */
export const BACKGROUND_SELECT = {
  id: true,
  organizationId: true,
  kind: true,
  source: true,
  filename: true,
  contentType: true,
  durationSec: true,
  width: true,
  height: true,
  license: true,
  minPlan: true,
  status: true,
  moderationStatus: true,
  createdAt: true,
  variants: {
    where: { variant: "thumb" },
    select: { variant: true, storageKey: true, width: true, height: true },
  },
} as const satisfies Prisma.AssetSelect;

export type BackgroundRow = Prisma.AssetGetPayload<{
  select: typeof BACKGROUND_SELECT;
}>;

/**
 * SOURCE OF TRUTH KEYWORDS: PICKABLE_ASSET_WHERE, READY_AND_CLEARED
 *
 * WHAT:  The two conditions that are true of every row a picker may offer.
 * WHY:   READY_AND_CLEARED. A `processing` row has no vertical master yet and a
 *        `pending` one is withheld from every render by
 *        NOT_APPROVED_DOES_NOT_RENDER — so offering either would let a customer
 *        pick a background and get a video with a gap where it should be, with
 *        nothing on screen having warned them. The media LIBRARY shows those
 *        rows, because its job is to report on the files you own; a PICKER's
 *        job is to offer only what will work.
 *
 *        `moderationStatus: { in: … }` names the two cleared values rather than
 *        excluding the two that are not, so a fifth status added later is
 *        excluded by default. Same posture as `isModerationCleared` —
 *        the unknown case fails closed.
 * WHERE: Both list functions.
 */
const PICKABLE_ASSET_WHERE = {
  status: "ready",
  moderationStatus: { in: ["approved", "skipped"] },
} as const satisfies Prisma.AssetWhereInput;

/**
 * SOURCE OF TRUTH KEYWORDS: listLibraryAssets, CATALOGUE_ORDER_IS_STABLE
 *
 * WHAT:  One page of the SHARED catalogue, oldest first, with the total.
 * WHY:   `organizationId: null` and nothing else — this is the catalogue, not
 *        "what this workspace can see", so it takes no organization id at all.
 *        A signature that accepted one would invite a caller to pass it and get
 *        a list that quietly included uploads.
 *
 *        Oldest first: see CATALOGUE_ORDER_IS_STABLE in the file header. The
 *        `skip` the caller passes is therefore also the catalogue RANK of the
 *        first row returned, which is what lets the router apply a breadth cap
 *        to a page without counting the whole table.
 * WHERE: `backgroundLibrary.list`.
 */
export async function listLibraryAssets(
  db: DbClient,
  filters: {
    kinds: readonly AssetKind[];
    search?: string | undefined;
  },
  pagination: { skip: number; take: number },
): Promise<{ items: BackgroundRow[]; total: number }> {
  const where: Prisma.AssetWhereInput = {
    organizationId: null,
    source: "library" satisfies AssetSource,
    kind: { in: [...filters.kinds] },
    ...PICKABLE_ASSET_WHERE,
    ...(filters.search !== undefined && filters.search.length > 0
      ? { filename: { contains: filters.search, mode: "insensitive" } }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.asset.findMany({
      where,
      select: BACKGROUND_SELECT,
      /* CATALOGUE_ORDER_IS_STABLE. `id` breaks the tie so the ordering is
       * total — two rows synced in the same millisecond must not be able to
       * swap places between pages. */
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    db.asset.count({ where }),
  ]);

  return { items, total };
}

/**
 * SOURCE OF TRUTH KEYWORDS: listWorkspaceBackgrounds, TENANT_SCOPED_QUERY
 *
 * WHAT:  The workspace's OWN media that can serve as a background.
 * WHY:   Newest first, unlike the catalogue — these are the customer's files
 *        and the one they just uploaded is the one they are looking for. The
 *        breadth cap does not apply (see LIBRARY_IS_ITS_OWN_QUERY), so there is
 *        no rank to preserve and nothing to keep stable.
 *
 *        `organizationId` is a strict equality rather than `assetScopeWhere`,
 *        which would re-include every library row and double the catalogue.
 * WHERE: `backgroundLibrary.list`, when `includeUploads` is on.
 */
export async function listWorkspaceBackgrounds(
  db: DbClient,
  filters: {
    organizationId: string;
    kinds: readonly AssetKind[];
    search?: string | undefined;
  },
  pagination: { skip: number; take: number },
): Promise<{ items: BackgroundRow[]; total: number }> {
  const where: Prisma.AssetWhereInput = {
    organizationId: filters.organizationId,
    kind: { in: [...filters.kinds] },
    ...PICKABLE_ASSET_WHERE,
    ...(filters.search !== undefined && filters.search.length > 0
      ? { filename: { contains: filters.search, mode: "insensitive" } }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.asset.findMany({
      where,
      select: BACKGROUND_SELECT,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
    }),
    db.asset.count({ where }),
  ]);

  return { items, total };
}

/**
 * SOURCE OF TRUTH KEYWORDS: BreadthCursor, breadthCursor, isWithinBreadth,
 *   CATALOGUE_ORDER_IS_STABLE, BREADTH_IS_APPLIED_AT_READ_TIME,
 *   A_CURSOR_NOT_A_ROW_INDEX
 *
 * WHAT:  Where a plan's slice of the catalogue ends, and whether a given row
 *        falls inside it.
 *
 * WHY:   A_CURSOR_NOT_A_ROW_INDEX, and the reason is a bug worth recording.
 *        The obvious implementation of "the first N of the catalogue" is a
 *        row's position in the page being rendered — `skip + index`, which the
 *        list handler has for free. That is correct only while the page IS the
 *        catalogue in order. The moment a SEARCH is applied, `skip + index` is
 *        the rank among the MATCHES: a free workspace searching "rain" would
 *        see the first ten hits unlocked even if they are rows thirty to forty
 *        of the catalogue, click one, and be refused by the server — which
 *        re-checks properly. A lock badge that disagrees with the boundary it
 *        is describing is worse than no badge at all.
 *
 *        So the cap is resolved ONCE into a cursor — the `(createdAt, id)` of
 *        the last row the plan includes — and every row is compared against it.
 *        That comparison is filter-independent, which is the whole point: the
 *        answer is the same whether the row arrived from a page, from a search,
 *        or from a mutation holding nothing but an id. One mechanism for the
 *        read and the write, so the badge and the refusal cannot drift.
 *
 *        `kinds` must be the set the catalogue is being browsed as. The footage
 *        picker and a music picker are different catalogues to a customer, so a
 *        slice is only meaningful within one set.
 *
 *        The three cases are explicit rather than a nullable row, because
 *        "every row is included" (an unlimited plan, or a catalogue smaller
 *        than the cap) and "no row is included" are both reachable and mean
 *        opposite things — a null would have to stand for one and would be read
 *        as the other.
 * WHERE: `backgroundLibrary.list` (the lock badge) and `.applyBackground` (the
 *        boundary).
 */
export type BreadthCursor =
  | { readonly scope: "all" }
  | { readonly scope: "none" }
  | { readonly scope: "upTo"; readonly createdAt: Date; readonly id: string };

export async function breadthCursor(
  db: DbClient,
  args: { kinds: readonly AssetKind[]; breadth: number },
): Promise<BreadthCursor> {
  /* An unlimited plan, which getResourceLimitForPlan reports as Infinity. */
  if (!Number.isFinite(args.breadth)) return { scope: "all" };
  if (args.breadth <= 0) return { scope: "none" };

  const rows = await db.asset.findMany({
    where: {
      organizationId: null,
      source: "library" satisfies AssetSource,
      kind: { in: [...args.kinds] },
      ...PICKABLE_ASSET_WHERE,
    },
    select: { createdAt: true, id: true },
    /* CATALOGUE_ORDER_IS_STABLE — the SAME total ordering the list uses,
     * tie-break included. A cursor taken against a different ordering would
     * drift from the badge by one row, invisibly, until somebody sat exactly on
     * the boundary. */
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: args.breadth - 1,
    take: 1,
  });

  const last = rows[0];
  /* Fewer rows than the cap allows: the plan includes all of them. */
  return last === undefined
    ? { scope: "all" }
    : { scope: "upTo", createdAt: last.createdAt, id: last.id };
}

/**
 * SOURCE OF TRUTH KEYWORDS: isWithinBreadth, A_CURSOR_NOT_A_ROW_INDEX
 *
 * Pure, and deliberately so: this is the comparison the lock badge and the
 * write refusal both make, and the only way to be certain they agree is for it
 * to be one function with no I/O in it. Inclusive of the cursor row — the
 * cursor IS the last row the plan includes.
 */
export function isWithinBreadth(
  row: Pick<BackgroundRow, "id" | "createdAt">,
  cursor: BreadthCursor,
): boolean {
  switch (cursor.scope) {
    case "all":
      return true;
    case "none":
      return false;
    case "upTo": {
      const rowAt = row.createdAt.getTime();
      const cursorAt = cursor.createdAt.getTime();
      return rowAt < cursorAt || (rowAt === cursorAt && row.id <= cursor.id);
    }
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: findUsableBackground, USABLE_IS_FOUR_CHECKS,
 *   MINE_OR_LIBRARY
 *
 * WHAT:  One background by id, if this workspace may actually render it.
 *
 * WHY:   USABLE_IS_FOUR_CHECKS, and this function owns three of them: the row
 *        must be readable by this workspace (MINE_OR_LIBRARY — the shared
 *        predicate from assets.service, so this query is findable by the same
 *        grep as every other asset read), the ingest must have finished, and
 *        moderation must have cleared it. The FOURTH — the plan reaching the
 *        row's `minPlan` — is the caller's, because a plan is an entitlement
 *        and a service does not resolve entitlements.
 *
 *        `isModerationCleared` is applied in code rather than as a `where`
 *        clause even though PICKABLE_ASSET_WHERE expresses the same rule in
 *        SQL above. That is deliberate: this is the path a RENDER depends on,
 *        and the one function in the codebase that has already decided what
 *        "cleared" means should be the thing that decides it here too. If the
 *        two ever disagree, the stricter one wins and the asset is withheld.
 *
 *        Returns null rather than throwing, so the caller chooses between
 *        NOT_FOUND and a softer answer — and NOT_FOUND is right for another
 *        workspace's asset, because FORBIDDEN would confirm the id exists.
 * WHERE: `backgroundLibrary.applyBackground` (the boundary) and
 *        `resolveProjectBackground` (the pipeline's re-check).
 */
export async function findUsableBackground(
  db: DbClient,
  organizationId: string,
  assetId: string,
): Promise<BackgroundRow | null> {
  const row = await db.asset.findFirst({
    where: {
      id: assetId,
      ...assetScopeWhere(organizationId),
      status: "ready",
    },
    select: BACKGROUND_SELECT,
  });
  if (row === null) return null;

  return isModerationCleared(row.moderationStatus) ? row : null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: lastBackgroundAssetId, REMEMBER_THE_LAST_PICK
 *
 * WHAT:  The background this workspace chose most recently, on any project.
 *
 * WHY:   REMEMBER_THE_LAST_PICK is step 8 of the phase, and it is read back out
 *        of `Project.settings` rather than stored on the workspace — which the
 *        phase asks for in so many words ("not a column"). The cost is this
 *        function: there is no index on a jsonb path, so it reads the
 *        workspace's recent projects and takes the first that names one.
 *
 *        BOUNDED, which is what makes that acceptable. It looks at the most
 *        recent handful of projects and stops; a workspace whose last twenty
 *        projects all used the backdrop simply gets the catalogue default,
 *        which is the same answer a new workspace gets and is not worth a
 *        table scan to improve on. `settings` is selected rather than the whole
 *        row because the column is the only thing being read.
 *
 *        It deliberately does NOT validate that the remembered asset is still
 *        usable — the caller does, because the caller is the one that knows the
 *        plan. A deleted or downgraded background therefore falls through to
 *        the default rather than being offered and refused.
 * WHERE: `backgroundLibrary.list` (the suggested default) and
 *        `resolveProjectBackground`.
 */
const LAST_PICK_LOOKBACK = 10;

export async function lastBackgroundAssetId(
  db: DbClient,
  organizationId: string,
  excludeProjectId?: string,
): Promise<string | null> {
  const projects = await db.project.findMany({
    where: {
      organizationId,
      ...(excludeProjectId !== undefined
        ? { id: { not: excludeProjectId } }
        : {}),
    },
    select: { settings: true },
    orderBy: { updatedAt: "desc" },
    take: LAST_PICK_LOOKBACK,
  });

  for (const project of projects) {
    const chosen = readBackgroundAssetId(project.settings);
    if (chosen !== null) return chosen;
  }

  return null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: readBackgroundAssetId, SETTINGS_ARE_PARSED_NOT_TRUSTED
 *
 * WHAT:  The chosen background out of a `Project.settings` value.
 * WHY:   SETTINGS_ARE_PARSED_NOT_TRUSTED. The column is jsonb written by
 *        several phases and possibly by an older release, so this walks it
 *        defensively and returns null for anything that is not a non-empty
 *        string. Shared by the lookback above and by the single-project read,
 *        so the two cannot disagree about what "no background" looks like.
 * WHERE: This file only.
 */
function readBackgroundAssetId(settings: Prisma.JsonValue): string | null {
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    return null;
  }

  const generate = settings["generate"];
  if (
    typeof generate !== "object" ||
    generate === null ||
    Array.isArray(generate)
  ) {
    return null;
  }

  const value = generate["backgroundAssetId"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: firstLibraryBackground, DEFAULT_SENSIBLY
 *
 * WHAT:  The catalogue's first usable footage row for a plan, or null.
 * WHY:   DEFAULT_SENSIBLY, step 8's other half: a new project should not have
 *        to be asked. This is the fallback when the project has no choice and
 *        the workspace has no history — the oldest catalogue row the plan can
 *        reach, which by CATALOGUE_ORDER_IS_STABLE is the one the operator
 *        curated first and is therefore the safest thing to put behind somebody
 *        else's video.
 *
 *        Takes the already-resolved list of plans the caller is entitled to
 *        rather than a `PlanKey`, for the usual reason: a service does not
 *        resolve entitlements. `null` is a real and common answer — an empty
 *        catalogue (which is the shipped state, see
 *        MANIFEST_IS_EMPTY_ON_PURPOSE) means every project gets the styled
 *        backdrop, which is a working video.
 * WHERE: `resolveProjectBackground`.
 */
export async function firstLibraryBackground(
  db: DbClient,
  args: { kinds: readonly AssetKind[]; allowedMinPlans: readonly string[] },
): Promise<BackgroundRow | null> {
  return db.asset.findFirst({
    where: {
      organizationId: null,
      source: "library" satisfies AssetSource,
      kind: { in: [...args.kinds] },
      ...PICKABLE_ASSET_WHERE,
      /* A null `minPlan` is an ungated row and is always allowed; the list
       * carries the plans at or below the caller's own. */
      OR: [{ minPlan: null }, { minPlan: { in: [...args.allowedMinPlans] } }],
    },
    select: BACKGROUND_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveProjectBackground, ResolvedBackground,
 *   THREE_PLACES_TO_LOOK, ONE_RESOLVER_TWO_CALLERS, DEFAULT_SENSIBLY
 *
 * WHAT:  The background a project will actually render with, and where the
 *        answer came from.
 *
 * WHY:   ONE_RESOLVER_TWO_CALLERS, and that is why this lives in a service
 *        rather than in the router where business logic normally belongs. Two
 *        completely different callers have to agree on the answer: the PICKER,
 *        which shows the customer what is selected before a run, and the
 *        PIPELINE, which puts it in the document during one. If the picker
 *        pre-selected one row and the generator resolved another, the customer
 *        would get a video with a background they can see they did not choose —
 *        and nothing on either side would look wrong in isolation.
 *
 *        THREE_PLACES_TO_LOOK, in this order, each falling through only when
 *        the candidate is no longer usable:
 *
 *          1. The project's own stored choice. An explicit decision wins.
 *          2. The workspace's last pick, on any recent project
 *             (REMEMBER_THE_LAST_PICK). Somebody who chose a loop for their
 *             last three videos wants it for the fourth.
 *          3. The catalogue's first row this plan may use (DEFAULT_SENSIBLY).
 *
 *        And then null, which is a real answer and the shipped one: an empty
 *        catalogue means the styled backdrop, which is a complete video.
 *
 *        Every candidate goes back through `findUsableBackground` and the plan
 *        check, INCLUDING the project's own stored choice. That is the point of
 *        re-resolving at generate time rather than trusting the setting: a
 *        background can be deleted, rejected by a later review, or fall out of
 *        reach when a workspace downgrades, and the honest behaviour then is
 *        the next default rather than a video with a hole in it. The plan is
 *        passed IN — a service resolves no entitlements.
 * WHERE: `backgroundLibrary.list` and `.apply`; `generatorContextFor` in
 *        src/services/pipeline.service.ts.
 */
export interface ResolvedBackground {
  row: BackgroundRow;
  /** Which of THREE_PLACES_TO_LOOK produced it — for the UI's wording. */
  origin: "project" | "workspace" | "default";
}

export async function resolveProjectBackground(
  db: DbClient,
  args: {
    organizationId: string;
    projectId: string;
    plan: PlanKey;
    kinds: readonly AssetKind[];
  },
): Promise<ResolvedBackground | null> {
  const project = await db.project.findFirst({
    /* TENANT_SCOPED_QUERY — the workflow calls this and gets none of
     * protectedProcedure's gates. */
    where: { id: args.projectId, organizationId: args.organizationId },
    select: { settings: true },
  });
  if (project === null) return null;

  const usable = async (assetId: string): Promise<BackgroundRow | null> => {
    const row = await findUsableBackground(db, args.organizationId, assetId);
    if (row === null) return null;
    /* USABLE_IS_FOUR_CHECKS — the fourth one, which the service above
     * deliberately leaves to its caller. */
    return backgroundAvailableOnPlan(row.minPlan, args.plan) ? row : null;
  };

  const chosen = readBackgroundAssetId(project.settings);
  if (chosen !== null) {
    const row = await usable(chosen);
    if (row !== null) return { row, origin: "project" };
  }

  const remembered = await lastBackgroundAssetId(
    db,
    args.organizationId,
    args.projectId,
  );
  if (remembered !== null) {
    const row = await usable(remembered);
    if (row !== null) return { row, origin: "workspace" };
  }

  const fallback = await firstLibraryBackground(db, {
    kinds: args.kinds,
    allowedMinPlans: plansUpTo(args.plan),
  });

  return fallback === null ? null : { row: fallback, origin: "default" };
}

/**
 * SOURCE OF TRUTH KEYWORDS: upsertLibraryAsset, MANIFEST_KEY_IS_THE_IDENTITY,
 *   SYNC_PRESERVES_THE_OBJECT
 *
 * WHAT:  Creates or updates one catalogue row from a manifest entry.
 *
 * WHY:   MANIFEST_KEY_IS_THE_IDENTITY. The row's PRIMARY KEY is derived from
 *        the manifest key (`libraryAssetId`) rather than left to `cuid()`,
 *        which is what makes a re-sync an update instead of a second copy.
 *        Without it, correcting a licence string would mint a new asset, leave
 *        the old one in the catalogue, and strand every project that already
 *        pointed at it — and there is no column to match on, because
 *        `Asset` deliberately gains no `manifestKey` field in this phase (the
 *        phase file says "no new models", and a key that IS the id needs no
 *        column).
 *
 *        SYNC_PRESERVES_THE_OBJECT. `storageKey` is written on create and never
 *        updated, because the bytes are fetched once and the key is derived
 *        from the id, which cannot change. `status` is NOT reset to
 *        `processing` on update either: correcting a title or a licence must
 *        not take a working background out of every picker until a transcode
 *        finishes. A row whose BYTES need replacing is a new manifest key.
 *
 *        The licence columns are always written, because they are the whole
 *        point of a re-sync — the one field an operator comes back to fix.
 * WHERE: `backgroundLibrary.sync`.
 */
export async function upsertLibraryAsset(
  db: DbClient,
  data: {
    id: string;
    kind: AssetKind;
    filename: string;
    storageKey: string;
    contentType: string;
    license: string;
    minPlan: string;
  },
): Promise<{ created: boolean }> {
  const existing = await db.asset.findUnique({
    where: { id: data.id },
    select: { id: true },
  });

  if (existing === null) {
    await db.asset.create({
      data: {
        id: data.id,
        organizationId: null,
        kind: data.kind,
        source: "library" satisfies AssetSource,
        filename: data.filename,
        storageKey: data.storageKey,
        contentType: data.contentType,
        /* Zero until the ingest HEADs the fetched object. The column is
         * `Int` and not nullable, and a guessed size would be worse than an
         * honest zero — library bytes are excluded from every tenant's storage
         * quota anyway (see sumAssetBytes). */
        bytes: 0,
        license: data.license,
        minPlan: data.minPlan,
      },
    });
    return { created: true };
  }

  await db.asset.update({
    where: { id: data.id },
    data: {
      kind: data.kind,
      filename: data.filename,
      contentType: data.contentType,
      license: data.license,
      minPlan: data.minPlan,
    },
  });
  return { created: false };
}

/**
 * SOURCE OF TRUTH KEYWORDS: recordLibraryBytes
 *
 * WHAT:  Writes the fetched object's real size onto a library row.
 * WHY:   Separate from `markAssetReady`, which the shared ingest owns and which
 *        writes the PROBED facts (duration, dimensions). The byte count comes
 *        from the fetch, one step earlier and in a different workflow, and
 *        folding it into the ready transition would mean threading a number
 *        through a workflow that does not otherwise know about the library.
 * WHERE: src/inngest/functions/library-ingest.ts.
 */
export async function recordLibraryBytes(
  db: DbClient,
  assetId: string,
  bytes: number,
): Promise<void> {
  await db.asset.update({ where: { id: assetId }, data: { bytes } });
}
