/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: readBlockVisuals, writeBlockVisuals,
 *   upsertBlockVisual, resolveBlockVisuals, searchStock, resolveBlockChoice,
 *   ingestBlockVisual, findCachedImageAsset, findCachedStockAsset,
 *   moderateImagePrompt, FALLBACK_CHAIN_IS_THE_POINT, CHAIN_NEVER_THROWS,
 *   PROMPT_IS_THE_CACHE_KEY, PROVENANCE_IS_NOT_OPTIONAL,
 *   READY_AND_CLEARED, SWAP_IS_ONE_BLOCK
 *
 * WHAT:  Every read and write behind per-block visuals: the stored choices on
 *        `Project.settings.visuals`, the stock search, the fallback chain that
 *        decides where a block's picture comes from, the prompt and clip
 *        caches, and the asset row each ingest creates.
 *
 * WHY:   FALLBACK_CHAIN_IS_THE_POINT. The phase's step 4 is a chain — best
 *        matching stock clip, then a generated image, then the styled backdrop
 *        — and this file is the only place it exists. Every other layer sees
 *        the ANSWER: the generator receives resolved facts
 *        (VISUALS_ARE_FACTS), the workflow receives a choice to ingest, and the
 *        UI receives a block with a source on it. Putting the chain in one
 *        function is what makes "with both providers disabled the video still
 *        completes" a property of ONE branchy function rather than something
 *        three callers each have to remember.
 *
 *        CHAIN_NEVER_THROWS, and it is the discipline the whole phase rests on.
 *        Every step of the chain is allowed to fail and NONE of them is allowed
 *        to fail the run: a stock outage, a refused prompt, an exhausted image
 *        quota and an unconfigured deployment all produce the same outcome,
 *        which is a block on the backdrop. The functions here therefore return
 *        a choice (possibly `{ source: 'background' }`) rather than raising,
 *        and the provider errors are caught where they happen and logged. The
 *        one exception is `ingestBlockVisual`, which runs inside a workflow
 *        step and is ALLOWED to throw so Inngest can retry a flaky download —
 *        its failure marks that block `failed` and the generator then treats it
 *        as a block with no visual.
 *
 *        PROMPT_IS_THE_CACHE_KEY is the phase's step 10 and it is checked
 *        BEFORE the model call rather than after, which is the only ordering
 *        that saves anything: an identical prompt in the same workspace reuses
 *        the asset and makes no second request. The stock half has the same
 *        discipline on `(sourceProvider, sourceId)` — the same clip chosen for
 *        two blocks is ingested once.
 *
 *        READY_AND_CLEARED. `resolveBlockVisuals` only ever hands the generator
 *        an asset that is `ready` and whose moderation is cleared, exactly as
 *        `PICKABLE_ASSET_WHERE` does for backgrounds. A block whose asset is
 *        still ingesting, failed, or held for review is treated as a block with
 *        no visual — the backdrop — rather than as a document pointing at
 *        something a render will refuse to sign.
 *
 *        SERVER_ONLY and the only layer here that touches the database, per
 *        CLAUDE.md section 3. The decisions that can actually be WRONG without
 *        a provider — which clip is best, how a prompt hashes, what the stored
 *        shape is — all live in pure modules (src/lib/visuals/,
 *        src/lib/types/visual.ts) and are tested there with no key and no
 *        spend.
 * WHERE: `visuals` router, the `visuals` stage of
 *        src/inngest/functions/project-generate.ts,
 *        src/inngest/functions/visual-ingest.ts, and `generatorContextFor` in
 *        ./pipeline.service.ts.
 */

import "server-only";

import { writeFile } from "node:fs/promises";

/* The ImageError is deliberately NOT caught here: a generation failure happens
 * inside `ingestBlockVisual`, which runs in a workflow step and is allowed to
 * throw so Inngest can retry a busy model — see CHAIN_NEVER_THROWS for the one
 * exception it is. The workflow classifies it. */
import { getImageAdapter } from "@/lib/adapters/image";
import {
  assertStockDownloadUrl,
  getStockAdapter,
  StockError,
  type StockResult,
} from "@/lib/adapters/stock";
import { projectKey } from "@/lib/adapters/storage";
import { type DbClient } from "@/lib/config/prisma";
import { downloadUrlToFile, uploadFile, withStagingDir } from "@/lib/media";
import { proposeBlockVisuals } from "@/lib/script/visuals";
import { jsonObjectSchema } from "@/lib/types/json";
import {
  VISUAL_MIN_CLIP_SECONDS,
  VISUAL_STOCK_RESULTS,
  blockVisualSchema,
  visualPromptHash,
  visualsSettingsSchema,
  visualsSettingsToJson,
  type BlockVisual,
  type StockCandidate,
  type VisualChoice,
  type VisualsSettings,
} from "@/lib/types/visual";
import { orderStockResults, pickBestStockResult } from "@/lib/visuals";
import type { ResolvedBlockVisual } from "@/lib/generators";
import {
  createProcessingAsset,
  isModerationCleared,
  setModerationStatus,
} from "./assets.service";
import { moderateText } from "./moderation.service";

/**
 * SOURCE OF TRUTH KEYWORDS: EMPTY_VISUALS, NO_VISUALS_IS_NOT_A_MISSING_READ
 *
 * WHAT:  What a project with no stored visuals reads as.
 * WHY:   NO_VISUALS_IS_NOT_A_MISSING_READ. Every project begins here and most
 *        stay here, so the empty value is a REAL value rather than a null a
 *        caller has to branch on — the same reasoning `DEFAULT_GENERATE_SETTINGS`
 *        follows. `readBlockVisuals` still returns null for a project that does
 *        not exist, because that is a different fact.
 * WHERE: `readBlockVisuals`, `upsertBlockVisual`.
 */
export const EMPTY_VISUALS: VisualsSettings = { blocks: [], imagesGenerated: 0 };

/**
 * SOURCE OF TRUTH KEYWORDS: readBlockVisuals, SETTINGS_ARE_PARSED_NOT_TRUSTED,
 *   TENANT_SCOPED_QUERY
 *
 * WHAT:  This project's stored block visuals, or null if it is not ours.
 * WHY:   Parsed with the block's own schema on every read, because
 *        `Project.settings` is one shared jsonb column written by several
 *        phases and what is in it may have been written by an older release. A
 *        payload that will not parse reads as EMPTY rather than throwing: the
 *        consequence of an unreadable visuals block is a video on the backdrop,
 *        and the consequence of throwing is no video at all.
 * WHERE: Every other function here, the router's `list`, and
 *        `generatorContextFor`.
 */
export async function readBlockVisuals(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<VisualsSettings | null> {
  const project = await db.project.findFirst({
    /* TENANT_SCOPED_QUERY — never by id alone. */
    where: { id: projectId, organizationId },
    select: { settings: true },
  });
  if (project === null) return null;

  return readVisualsFromSettings(project.settings);
}

/** The pure half of the read, shared with `generatorContextFor`. */
export function readVisualsFromSettings(settings: unknown): VisualsSettings {
  const bag = jsonObjectSchema.safeParse(settings);
  if (!bag.success) return { ...EMPTY_VISUALS };

  const parsed = visualsSettingsSchema.safeParse(bag.data["visuals"]);
  return parsed.success ? parsed.data : { ...EMPTY_VISUALS };
}

/**
 * SOURCE OF TRUTH KEYWORDS: writeBlockVisuals, SETTINGS_ARE_MERGED
 *
 * WHAT:  Replaces the whole `visuals` block of the project's settings.
 * WHY:   SETTINGS_ARE_MERGED — only the `visuals` key is replaced, exactly as
 *        `writeGenerateSettings` replaces only `generate`. Writing the whole
 *        column would drop the caption preferences and the quiz's question set,
 *        which live in the same jsonb.
 * WHERE: The `visuals` stage, and `upsertBlockVisual` below.
 */
export async function writeBlockVisuals(
  db: DbClient,
  organizationId: string,
  projectId: string,
  visuals: VisualsSettings,
): Promise<boolean> {
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { settings: true },
  });
  if (project === null) return false;

  const existing = jsonObjectSchema.safeParse(project.settings);
  const bag = existing.success ? existing.data : {};

  await db.project.update({
    where: { id: projectId },
    data: {
      settings: jsonObjectSchema.parse({
        ...bag,
        visuals: visualsSettingsToJson(visuals),
      }),
    },
  });
  return true;
}

/**
 * SOURCE OF TRUTH KEYWORDS: upsertBlockVisual, SWAP_IS_ONE_BLOCK,
 *   READ_MODIFY_WRITE_IS_SCOPED
 *
 * WHAT:  Replaces ONE block's entry, leaving every other block alone.
 *
 * WHY:   SWAP_IS_ONE_BLOCK is the phase's "swapping one block's visual leaves
 *        the other blocks untouched", and this is where it is true in the
 *        database rather than merely in a signature. The entry is replaced
 *        whole rather than deep-merged, because a choice is a DISCRIMINATED
 *        UNION: merging a new `ai_image` choice over an old `stock` one would
 *        leave a licence and a provider id on an image nobody licensed — which
 *        is precisely the unverifiable provenance PROVENANCE_IS_NOT_OPTIONAL
 *        exists to prevent.
 *
 *        READ_MODIFY_WRITE_IS_SCOPED: the read and the write are not in one
 *        transaction, and that is a considered choice rather than an oversight.
 *        Two concurrent swaps of DIFFERENT blocks could lose one of them, and
 *        the cost of that is a picture that has to be chosen again; the cost of
 *        serialising every write to a project's settings is that the `visuals`
 *        stage, the captions screen and the background picker contend on one
 *        row. The caller that genuinely needs atomicity — the stage, which
 *        writes every block at once — passes its own `db` handle and writes
 *        once.
 * WHERE: `visuals.setBlockVisual`, and the ingest workflow's own status writes.
 */
export async function upsertBlockVisual(
  db: DbClient,
  args: {
    organizationId: string;
    projectId: string;
    block: BlockVisual;
    /** Added to the cumulative image counter. See IMAGES_GENERATED_IS_CUMULATIVE. */
    imagesGenerated?: number;
  },
): Promise<boolean> {
  const current = await readBlockVisuals(
    db,
    args.organizationId,
    args.projectId,
  );
  if (current === null) return false;

  const blocks = current.blocks.filter(
    (entry) => entry.blockId !== args.block.blockId,
  );
  /* Order follows the script, and a swapped block keeps its place: the entry is
   * re-inserted where the old one was rather than appended, so the picker's
   * list does not reshuffle under somebody's cursor. */
  const index = current.blocks.findIndex(
    (entry) => entry.blockId === args.block.blockId,
  );
  if (index === -1) blocks.push(args.block);
  else blocks.splice(index, 0, args.block);

  return writeBlockVisuals(db, args.organizationId, args.projectId, {
    blocks,
    imagesGenerated:
      current.imagesGenerated + Math.max(0, args.imagesGenerated ?? 0),
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveBlockVisuals, READY_AND_CLEARED,
 *   RESOLVED_BEFORE_THE_GENERATOR, NO_PROVIDER_URL_IN_A_DOCUMENT
 *
 * WHAT:  Block id → the facts a generator needs, for every block whose visual
 *        is genuinely usable.
 *
 * WHY:   READY_AND_CLEARED, the same four checks `findUsableBackground` makes
 *        and for the same reason: an asset that is still ingesting has no
 *        variants, a failed one has no file, and one held for review is
 *        withheld from every render (NOT_APPROVED_DOES_NOT_RENDER). Handing any
 *        of the three to a generator would produce a document that validates
 *        and then renders a black rectangle.
 *
 *        A block that fails any check is simply ABSENT from the result, which
 *        the generator reads as "this block is on the backdrop" — see the note
 *        on `ResolvedBlockVisual` for why absent and fell-back are deliberately
 *        the same fact.
 *
 *        `isStill` is derived from the asset's CONTENT TYPE rather than from the
 *        choice's source, because that is the question the renderer actually
 *        asks: an `ai_image` is always a still, but an `upload` may be either,
 *        and a customer who uploaded a clip for a block must not get a Ken
 *        Burns drift applied to moving footage.
 *
 *        ONE QUERY for every asset the blocks name, not one per block — a
 *        twelve-block script would otherwise be twelve round trips to answer
 *        one question, exactly as `resolveCast` avoids.
 * WHERE: `generatorContextFor` in ./pipeline.service.ts.
 */
export async function resolveBlockVisuals(
  db: DbClient,
  args: {
    organizationId: string;
    visuals: VisualsSettings;
  },
): Promise<Record<string, ResolvedBlockVisual | undefined>> {
  const byAsset = new Map<string, string[]>();
  for (const block of args.visuals.blocks) {
    if (block.status !== "ready" || block.assetId === undefined) continue;
    const existing = byAsset.get(block.assetId);
    if (existing === undefined) byAsset.set(block.assetId, [block.blockId]);
    else existing.push(block.blockId);
  }
  if (byAsset.size === 0) return {};

  const rows = await db.asset.findMany({
    where: {
      id: { in: [...byAsset.keys()] },
      /* TENANT_SCOPED_QUERY. A generated image and an ingested clip both belong
       * to the workspace that paid for them — unlike a library background,
       * there is no shared-catalogue case here, so the scope is exact. */
      organizationId: args.organizationId,
      status: "ready",
    },
    select: {
      id: true,
      contentType: true,
      durationSec: true,
      width: true,
      height: true,
      license: true,
      moderationStatus: true,
    },
  });

  const resolved: Record<string, ResolvedBlockVisual | undefined> = {};

  for (const row of rows) {
    if (!isModerationCleared(row.moderationStatus)) continue;

    const isStill = row.contentType.startsWith("image/");

    for (const blockId of byAsset.get(row.id) ?? []) {
      resolved[blockId] = {
        assetId: row.id,
        /* A still has no source length to loop against, and a clip the ingest
         * could not measure plays once and holds (LOOP_IS_A_MODULO). */
        durationSec: isStill ? null : row.durationSec,
        license: licenseCategoryForVisual(row.license),
        width: row.width,
        height: row.height,
        isStill,
      };
    }
  }

  return resolved;
}

/**
 * SOURCE OF TRUTH KEYWORDS: licenseCategoryForVisual,
 *   LICENSE_TERMS_ARE_NOT_A_CATEGORY
 *
 * WHAT:  The document's licence CATEGORY for a stored licence string.
 *
 * WHY:   LICENSE_TERMS_ARE_NOT_A_CATEGORY, the same mapping
 *        `licenseCategoryForSource` performs for backgrounds, and it falls back
 *        to `unknown` for the same reason: `unknown` is a value a render can be
 *        refused on, and guessing `licensed` would be a claim nobody checked.
 *
 *        The mapping is on the stored TERMS rather than on the asset's `source`
 *        column, because that is where the information is: a stock clip's row
 *        carries the provider's licence name verbatim
 *        (LICENCE_IS_NEVER_INFERRED) and a generated image carries our own
 *        `generated`.
 * WHERE: `resolveBlockVisuals`.
 */
function licenseCategoryForVisual(
  license: string,
): ResolvedBlockVisual["license"] {
  const value = license.trim().toLowerCase();
  if (value === "generated") return "generated";
  if (value === "owned") return "owned";
  if (value.length === 0) return "unknown";
  /* A named third-party licence — "Pexels License" and anything like it. The
   * category says only that somebody licensed it; the TERMS stay on the row. */
  return "licensed";
}

/**
 * SOURCE OF TRUTH KEYWORDS: searchStock, EMPTY_IS_NOT_A_FAILURE,
 *   PICKER_SHOWS_THE_SAME_ORDER, CHAIN_NEVER_THROWS
 *
 * WHAT:  Candidate clips for one query, best first, with their licence on each.
 *
 * WHY:   Returns an EMPTY ARRAY for every failure — an unconfigured deployment,
 *        a rate limit, an outage, a query that matched nothing — because every
 *        caller's response to all four is identical: move down the chain, or
 *        show an empty grid with a sentence. CHAIN_NEVER_THROWS; the reason is
 *        logged for an operator, who is the only person who can act on the
 *        difference.
 *
 *        Ordered by the SAME score the automatic pick uses
 *        (PICKER_SHOWS_THE_SAME_ORDER in src/lib/visuals/select.ts), so the
 *        tile the chain chose is the first one a customer sees.
 * WHERE: `visuals.searchStock` and `resolveBlockChoice`.
 */
export async function searchStock(args: {
  query: string;
  blockSeconds: number;
}): Promise<StockCandidate[]> {
  let results: StockResult[];
  let provider: string;

  try {
    const adapter = await getStockAdapter();
    provider = adapter.id;
    if (!adapter.configured) return [];

    results = await adapter.search(args.query, {
      orientation: "portrait",
      minDurationSec: VISUAL_MIN_CLIP_SECONDS,
      limit: VISUAL_STOCK_RESULTS,
    });
  } catch (error) {
    const detail =
      error instanceof StockError
        ? `${error.reason}: ${error.detail}`
        : error instanceof Error
          ? error.message
          : String(error);
    console.error(`[visuals.service] stock search failed — ${detail}`);
    return [];
  }

  return orderStockResults(results, args.blockSeconds).map((result) => ({
    provider,
    providerId: result.providerId,
    previewUrl: result.previewUrl,
    downloadUrl: result.downloadUrl,
    license: result.license,
    ...(result.attribution === undefined
      ? {}
      : { attribution: result.attribution }),
    ...(result.durationSec === undefined
      ? {}
      : { durationSec: result.durationSec }),
    ...(result.width === undefined ? {} : { width: result.width }),
    ...(result.height === undefined ? {} : { height: result.height }),
  }));
}

/**
 * SOURCE OF TRUTH KEYWORDS: blockSeconds, SEARCH_IS_SCORED_FOR_A_BLOCK,
 *   MEASURED_NOT_ESTIMATED
 *
 * WHAT:  How many seconds of narration one script block runs to.
 *
 * WHY:   MEASURED_NOT_ESTIMATED. Summed from the MEASURED durations of the
 *        narration lines that block was split into, never from a word count:
 *        the number decides whether a clip covers the block or has to loop
 *        (COVERAGE_BEATS_RESOLUTION), and an estimate here would rank clips
 *        against a length the finished video does not have. A block becomes one
 *        or more lines (`splitBlockIntoLines`), which is why this is a SUM —
 *        and why it needs `NarrationLine.blockId` (LINE_REMEMBERS_ITS_BLOCK).
 *
 *        Returns 0 for a block with no recorded narration, which is honest
 *        rather than a fallback: the scorer treats a zero-length block as one
 *        every clip covers, which is the right answer when nothing is known
 *        about how long the paragraph will be.
 * WHERE: `aiImages.searchStock`, so a customer's own search is ordered by the
 *        same rule the automatic pick used.
 */
export async function blockSeconds(
  db: DbClient,
  args: { organizationId: string; projectId: string; blockId: string },
): Promise<number> {
  const lines = await db.narrationLine.findMany({
    where: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      blockId: args.blockId,
      status: "ready",
    },
    select: { durationSec: true },
  });

  return lines.reduce((total, line) => total + (line.durationSec ?? 0), 0);
}

/**
 * SOURCE OF TRUTH KEYWORDS: BlockPlanInput, planProjectVisuals,
 *   ONE_MODEL_CALL_THEN_ONE_CHAIN_PER_BLOCK
 *
 * WHAT:  A whole project's blocks turned into choices: one model call for the
 *        shot plan, then the fallback chain per block.
 *
 * WHY:   ONE_MODEL_CALL_THEN_ONE_CHAIN_PER_BLOCK. The plan is a single request
 *        for the whole script (ONE_CALL_FOR_THE_SCRIPT in
 *        src/lib/script/visual-prompt.ts) and the chain is then per block,
 *        because the chain's steps are per-block decisions: this paragraph
 *        matched a clip, that one needs an image, the third fell back.
 *
 *        `imageBudget` is passed IN rather than read here, and that is the
 *        entitlement boundary. How many images this workspace may still
 *        generate is a plan question answered by `checkFeatureGate`, and a
 *        service that resolved it would be a service making an entitlement
 *        decision — which the architecture puts in the procedure layer and, for
 *        a workflow, in the workflow. The chain is told a NUMBER and spends it.
 * WHERE: The `visuals` stage of src/inngest/functions/project-generate.ts.
 */
export interface BlockPlanInput {
  blockId: string;
  narrationText: string;
  /** Roughly how long this block's narration runs, for the clip scoring. */
  seconds: number;
}

export async function planProjectVisuals(
  db: DbClient,
  args: {
    organizationId: string;
    projectId: string;
    blocks: readonly BlockPlanInput[];
    /** How many images the plan and the balance between them allow. */
    imageBudget: number;
    kindLabel?: string;
  },
): Promise<{ blocks: BlockVisual[]; imagesPlanned: number }> {
  /**
   * SOURCE OF TRUTH KEYWORDS: NO_PLAN_WITH_NOWHERE_TO_SPEND_IT,
   *   DO_NOT_PAY_FOR_AN_ANSWER_NOBODY_CAN_USE
   *
   * The shot plan is a BILLED model request, and with no stock search and no
   * image budget there is nothing for its answer to do: every block would fall
   * through to the backdrop whatever the model proposed. So the model is not
   * asked at all, and every block is resolved to `background` directly.
   *
   * This is the common case rather than an edge one — it is exactly the state
   * the phase requires to produce a complete video ("with both providers
   * disabled, the video still completes on the styled background"), which means
   * it is also the state of every deployment that has not configured either
   * key. Paying a model per generation to decorate a decision that was already
   * made is the kind of charge nobody would ever attribute.
   *
   * The image budget is part of the condition, not just the adapter's
   * configuration: a free workspace has a budget of zero
   * (ZERO_IS_A_REAL_CAP), so a deployment with an image key but a free customer
   * is in the same position as one with no key.
   */
  const [stockReady, imageReady] = await Promise.all([
    stockSearchAvailable(),
    args.imageBudget > 0 ? imageGenerationAvailable() : Promise.resolve(false),
  ]);

  if (!stockReady && !imageReady) {
    return {
      blocks: args.blocks.map((block) =>
        blockVisualSchema.parse({
          blockId: block.blockId,
          choice: { source: "background" },
          status: "ready",
        }),
      ),
      imagesPlanned: 0,
    };
  }

  const proposals = await proposeBlockVisuals({
    blocks: args.blocks.map((block) => ({ narrationText: block.narrationText })),
    ...(args.kindLabel === undefined ? {} : { kindLabel: args.kindLabel }),
    purpose: `visuals.plan:${args.projectId}`,
  });

  const blocks: BlockVisual[] = [];
  let imagesPlanned = 0;

  for (const [index, block] of args.blocks.entries()) {
    const proposal = proposals[index] ?? null;

    const resolved = await resolveBlockChoice(db, {
      organizationId: args.organizationId,
      proposal,
      blockSeconds: block.seconds,
      imageAllowed: imagesPlanned < args.imageBudget,
    });

    if (resolved.choice.source === "ai_image") imagesPlanned += 1;

    blocks.push(
      blockVisualSchema.parse({
        blockId: block.blockId,
        choice: resolved.choice,
        /* `background` needs no bytes, so it is READY the moment it is chosen —
         * the backdrop is a style the document already knows. */
        status: resolved.choice.source === "background" ? "ready" : "pending",
        ...(proposal === null ? {} : { query: proposal.query }),
        ...(proposal === null ? {} : { prompt: proposal.prompt }),
      }),
    );
  }

  return { blocks, imagesPlanned };
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveBlockChoice, FALLBACK_CHAIN_IS_THE_POINT,
 *   CHAIN_NEVER_THROWS, MODERATE_BEFORE_THE_MODEL
 *
 * WHAT:  Where ONE block's picture should come from: the best matching stock
 *        clip, else a generated image, else the styled backdrop.
 *
 * WHY:   This function IS the phase's step 4, in its order, and the order is
 *        the decision. Stock is first because it is free to the customer and
 *        shows real footage; an image is second because it costs credits and a
 *        plan allowance; the backdrop is last because it always works. Each
 *        step is allowed to come up empty and none of them is allowed to raise
 *        — CHAIN_NEVER_THROWS.
 *
 *        MODERATE_BEFORE_THE_MODEL is the phase's step 7 and it happens HERE
 *        rather than in the adapter, because a moderation decision has to be
 *        RECORDED and only a service can record one
 *        (PROMPT_IS_ALREADY_MODERATED in the image adapter's contract). A
 *        blocked prompt does not fail the block: it falls through to the
 *        backdrop, because refusing the whole video over one paragraph's shot
 *        description would be a worse outcome than a plainer video — and the
 *        refusal is already recorded for an operator to see.
 *
 *        Note what this function does NOT do: it does not call the image model.
 *        It decides that an image SHOULD be generated and returns the prompt
 *        and its hash; the generation happens in the ingest workflow, where a
 *        two-minute provider call belongs. That split is also what makes the
 *        prompt cache work before anything is spent — a cached prompt comes
 *        back from this function already pointing at its asset.
 * WHERE: `planProjectVisuals`, and the router when a customer re-rolls one
 *        block.
 */
export async function resolveBlockChoice(
  db: DbClient,
  args: {
    organizationId: string;
    proposal: { query: string; prompt: string } | null;
    blockSeconds: number;
    imageAllowed: boolean;
  },
): Promise<{ choice: VisualChoice }> {
  const proposal = args.proposal;
  if (proposal === null) return { choice: { source: "background" } };

  /* [1] STOCK — free to the customer, and real footage. */
  const candidates = await searchStock({
    query: proposal.query,
    blockSeconds: args.blockSeconds,
  });
  /* A `StockCandidate` is a `StockResult` plus the provider id, so the pure
   * picker takes the list as it stands — no re-shaping, and therefore no second
   * place where a field could be dropped on the way to the scorer. */
  const best = pickBestStockResult(candidates, args.blockSeconds);

  if (best !== null) {
    const candidate = candidates.find(
      (entry) => entry.providerId === best.providerId,
    );
    if (candidate !== undefined) {
      return { choice: { source: "stock", ...candidate } };
    }
  }

  /* [2] A GENERATED IMAGE — only when the plan and the budget allow it. */
  if (!args.imageAllowed) return { choice: { source: "background" } };

  const adapterConfigured = await imageGenerationAvailable();
  if (!adapterConfigured) return { choice: { source: "background" } };

  /* MODERATE_BEFORE_THE_MODEL — the phase's step 7. */
  const cleared = await moderateImagePrompt(db, {
    organizationId: args.organizationId,
    prompt: proposal.prompt,
  });
  if (!cleared) return { choice: { source: "background" } };

  return {
    choice: {
      source: "ai_image",
      prompt: proposal.prompt,
      promptHash: visualPromptHash(proposal.prompt),
    },
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: imageGenerationAvailable, NOT_CONFIGURED_IS_A_CASE
 *
 * Whether this deployment can generate images at all. Separate from the
 * generation itself so the chain, the router and the review step can all ask
 * the same question without a provider call — and so an unconfigured
 * deployment never reaches a step that would throw.
 */
export async function imageGenerationAvailable(): Promise<boolean> {
  try {
    const adapter = await getImageAdapter();
    return adapter.configured;
  } catch (error) {
    console.error(
      `[visuals.service] the image seam could not be loaded — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: stockSearchAvailable, NOT_CONFIGURED_IS_A_CASE
 *
 * Whether this deployment can search for stock footage at all. Read by the
 * swap UI so it can say the search is unavailable rather than showing an empty
 * grid that looks like a library with nothing in it.
 */
export async function stockSearchAvailable(): Promise<boolean> {
  try {
    const adapter = await getStockAdapter();
    return adapter.configured;
  } catch (error) {
    console.error(
      `[visuals.service] the stock seam could not be loaded — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: moderateImagePrompt, MODERATE_BEFORE_THE_MODEL,
 *   TRADEMARKS_AND_REAL_PEOPLE
 *
 * WHAT:  Whether this prompt may be sent to an image model. Records the
 *        decision either way.
 *
 * WHY:   The phase's step 7: "moderate generated image prompts before the model
 *        call, per Phase 10 — trademarks and real people especially". Context
 *        `prompt` rather than `input`, which is the distinction
 *        MODERATION_CONTEXTS exists to draw: this is a REQUEST somebody is
 *        making of a generator, judged more strictly than source material,
 *        because what comes out is published in our name.
 *
 *        Subject type `prompt`, so the record is about the request rather than
 *        about an asset that does not exist yet — the asset row is created
 *        only if this passes, and a refusal must still leave a trail.
 *
 *        `moderateText` never throws and FAILS CLOSED, so a classifier outage
 *        blocks the generation and the block falls back to the backdrop. That
 *        is the right failure for a paid model call whose output we would
 *        publish.
 * WHERE: `resolveBlockChoice`, and the router before a customer-typed prompt.
 */
export async function moderateImagePrompt(
  db: DbClient,
  args: {
    organizationId: string;
    prompt: string;
  },
): Promise<boolean> {
  const outcome = await moderateText(db, {
    organizationId: args.organizationId,
    subjectType: "prompt",
    /* The hash rather than a row id: there is no row yet, and the hash is the
     * identity the cache uses, so two refusals of the same prompt are visibly
     * the same prompt in the queue. */
    subjectId: visualPromptHash(args.prompt),
    text: args.prompt,
    context: "prompt",
    purpose: "visuals.imagePrompt",
  });

  if (outcome.blocked) {
    console.warn(
      `[visuals.service] image prompt blocked (${outcome.status}): ${outcome.reason ?? "no reason recorded"}`,
    );
  }

  return !outcome.blocked;
}

/**
 * SOURCE OF TRUTH KEYWORDS: findCachedStockAsset, findCachedImageAsset,
 *   PROMPT_IS_THE_CACHE_KEY, REUSE_WITHIN_THE_WORKSPACE
 *
 * WHAT:  An asset this workspace already has for the same clip, or the same
 *        prompt.
 *
 * WHY:   PROMPT_IS_THE_CACHE_KEY is the phase's step 10, and the shape is
 *        copied deliberately from `findCachedAudio`: scoped to the workspace,
 *        matched on the hash, and restricted to rows that are `ready` — a
 *        pending or failed row has no usable file behind it, and reusing one
 *        would point a block at nothing.
 *
 *        REUSE_WITHIN_THE_WORKSPACE. Never across workspaces, although the same
 *        prompt would produce the same picture: the bytes sit under that
 *        customer's storage quota, the row is theirs to delete, and sharing a
 *        generated image between tenants would leak what one of them asked for.
 *
 *        The stock half matches `(sourceProvider, sourceId)` rather than the
 *        download URL, because a provider's URLs carry expiring parameters —
 *        the ID is the stable identity, which is exactly why
 *        PROVENANCE_IS_NOT_OPTIONAL stores it.
 *
 *        Newest match first, as in the narration cache: an older row is likelier
 *        to have been superseded.
 * WHERE: The ingest workflow, before it spends anything.
 */
export async function findCachedStockAsset(
  db: DbClient,
  args: { organizationId: string; provider: string; sourceId: string },
): Promise<{ id: string } | null> {
  return db.asset.findFirst({
    where: {
      organizationId: args.organizationId,
      sourceProvider: args.provider,
      sourceId: args.sourceId,
      status: "ready",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

export async function findCachedImageAsset(
  db: DbClient,
  args: { organizationId: string; promptHash: string },
): Promise<{ id: string } | null> {
  return db.asset.findFirst({
    where: {
      organizationId: args.organizationId,
      promptHash: args.promptHash,
      status: "ready",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: ingestBlockVisual, EVERYTHING_GOES_THROUGH_INGEST,
 *   PROVENANCE_IS_NOT_OPTIONAL, CACHE_BEFORE_SPEND, STOCK_IS_HOST_CHECKED
 *
 * WHAT:  Puts one block's chosen bytes in our bucket and creates the asset row
 *        for them. Returns the asset id and whether anything was spent.
 *
 * WHY:   EVERYTHING_GOES_THROUGH_INGEST is the phase's step 5: a chosen clip or
 *        a generated image "is ingested like an upload so it gets
 *        `vertical_1080`, `proxy_480` and `thumb` variants plus a licence
 *        record". This function does only the one thing the upload path does
 *        not — get somebody else's bytes to a storage key — and the caller then
 *        hands the row to `asset-ingest`, which owns the probe, the variants
 *        and the readiness transition. Exactly the FETCH_ONCE_THEN_HAND_OVER
 *        shape `library-ingest` established: two producers, one pipeline.
 *
 *        CACHE_BEFORE_SPEND. Both caches are checked first, so an identical
 *        prompt makes no model call and a clip chosen for two blocks is
 *        downloaded once — the phase's "re-running with an identical prompt
 *        makes no second model call", enforced before any money moves rather
 *        than reconciled after.
 *
 *        STOCK_IS_HOST_CHECKED. The download URL was stored on the project and
 *        is being fetched server-side, which makes it the one genuinely
 *        dangerous field in this phase (NO_SSRF_THROUGH_A_STORED_URL). It is
 *        checked against the provider's own delivery hosts here, at the fetch,
 *        as well as on the write — the write stops a mistake and this stops a
 *        row that was written by an older release or by somebody probing.
 *
 *        THROWS, unlike everything else in this file. It runs inside a workflow
 *        step, so a flaky download should be retried by Inngest rather than
 *        quietly degraded — and a permanent failure marks the block `failed`,
 *        which the generator then reads as a block with no visual.
 * WHERE: src/inngest/functions/visual-ingest.ts.
 */
export async function ingestBlockVisual(
  db: DbClient,
  args: {
    organizationId: string;
    projectId: string;
    blockId: string;
    choice: VisualChoice;
  },
): Promise<{ assetId: string; cached: boolean; needsIngest: boolean }> {
  const { choice } = args;

  if (choice.source === "upload") {
    /* Nothing to fetch: the customer's own asset is already ingested. It is
     * re-checked for readability here rather than trusted from the settings,
     * because the row may have been deleted since the swap. */
    const row = await db.asset.findFirst({
      where: {
        id: choice.assetId,
        organizationId: args.organizationId,
        status: "ready",
      },
      select: { id: true },
    });
    if (row === null) {
      throw new Error(
        `[visuals.service] upload ${choice.assetId} is not a ready asset in this workspace.`,
      );
    }
    return { assetId: row.id, cached: true, needsIngest: false };
  }

  if (choice.source === "background") {
    throw new Error(
      "[visuals.service] a background choice has no bytes to ingest.",
    );
  }

  /* CACHE_BEFORE_SPEND — see the file header. */
  const cached =
    choice.source === "stock"
      ? await findCachedStockAsset(db, {
          organizationId: args.organizationId,
          provider: choice.provider,
          sourceId: choice.providerId,
        })
      : await findCachedImageAsset(db, {
          organizationId: args.organizationId,
          promptHash: choice.promptHash,
        });

  if (cached !== null) {
    return { assetId: cached.id, cached: true, needsIngest: false };
  }

  if (choice.source === "stock") {
    /* STOCK_IS_HOST_CHECKED — throws before a single byte is fetched. */
    assertStockDownloadUrl(choice.provider, choice.downloadUrl);

    return withStagingDir(async (dir) => {
      const localPath = dir.file("source.mp4");
      await downloadUrlToFile(
        choice.downloadUrl,
        localPath,
        `the stock clip for block ${args.blockId}`,
      );

      const asset = await createProcessingAsset(db, {
        organizationId: args.organizationId,
        /* `upload` would be a lie and `background` would put it in the
         * background picker; `ai_footage` is this product's kind for footage it
         * did not receive from the customer. */
        kind: "ai_footage",
        source: "stock",
        filename: `${choice.provider}-${choice.providerId}.mp4`,
        storageKey: projectKey(
          args.organizationId,
          args.projectId,
          "footage",
          `${asStorageSegment(choice.provider)}-${asStorageSegment(choice.providerId)}.mp4`,
        ),
        contentType: "video/mp4",
        bytes: 0,
      });

      /* PROVENANCE_IS_NOT_OPTIONAL — written in the same breath as the row, so
       * there is no window in which a clip exists without its licence. */
      await db.asset.update({
        where: { id: asset.id },
        data: {
          license: choice.license,
          sourceProvider: choice.provider,
          sourceId: choice.providerId,
          ...(choice.attribution === undefined
            ? {}
            : { attribution: choice.attribution }),
        },
      });

      const bytes = await uploadFile({
        localPath,
        storageKey: asset.storageKey,
        contentType: asset.contentType,
      });
      await db.asset.update({ where: { id: asset.id }, data: { bytes } });

      return { assetId: asset.id, cached: false, needsIngest: true };
    });
  }

  /* A generated image. The model call is here rather than in
   * `resolveBlockChoice` because it takes tens of seconds and belongs in a
   * workflow step — see that function's own note. */
  const adapter = await getImageAdapter();
  const generated = await adapter.generate(choice.prompt, { aspect: "9:16" });

  return withStagingDir(async (dir) => {
    const localPath = dir.file("image.png");
    await writeFile(localPath, generated.image);

    const asset = await createProcessingAsset(db, {
      organizationId: args.organizationId,
      kind: "image",
      source: "generated",
      filename: `${args.blockId}.png`,
      storageKey: projectKey(
        args.organizationId,
        args.projectId,
        "footage",
        `${asStorageSegment(args.blockId)}-${choice.promptHash}.png`,
      ),
      contentType: generated.contentType,
      bytes: 0,
    });

    /* The audit record the phase asks for: the prompt, its hash and the model
     * that actually served it (MODEL_VERSION_IS_RETURNED_NOT_ASSUMED). */
    await db.asset.update({
      where: { id: asset.id },
      data: {
        license: "generated",
        promptText: choice.prompt,
        promptHash: choice.promptHash,
        modelVersion: generated.modelVersion,
        sourceProvider: adapter.id,
      },
    });

    const bytes = await uploadFile({
      localPath,
      storageKey: asset.storageKey,
      contentType: asset.contentType,
    });
    await db.asset.update({ where: { id: asset.id }, data: { bytes } });

    /**
     * SOURCE OF TRUTH KEYWORDS: GENERATED_IMAGE_IS_CLEARED_UPSTREAM,
     *   MODERATION_IS_NOT_APPLICABLE_TO_OUR_OWN_SYNTHESIS
     *
     * `skipped`, written here and deliberately, for the same reason narration
     * audio is (see narrate-line.ts): this is our own synthesis from a PROMPT
     * the pipeline already classified under the stricter `prompt` standard
     * before the model was called (MODERATE_BEFORE_THE_MODEL), and the model
     * applied its own policy on top. Sending the pixels to a classifier would
     * be paying to moderate our own output, and this product has no vision
     * classifier to send them to; leaving the row `pending` would withhold the
     * image from the video it was generated for, which is the one outcome that
     * makes the feature useless.
     *
     * It is NOT `approved`, because nothing looked at the pixels — `skipped`
     * means "moderation applies and it happened upstream", which is exactly
     * true here.
     *
     * The ingest workflow re-reads and may still REJECT on the filename; this
     * is the floor, not a bypass.
     */
    await setModerationStatus(db, asset.id, "skipped");

    return { assetId: asset.id, cached: false, needsIngest: true };
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: asStorageSegment, KEY_TRAVERSAL_GUARD
 *
 * WHAT:  A provider's id as something safe to put in a storage key.
 * WHY:   `assertKeySegment` THROWS on a segment that could escape its prefix
 *        (it is deliberately not a sanitiser), and a provider's id is somebody
 *        else's string — Pexels uses integers today and nothing promises that
 *        forever. Normalising here, before the key is built, means a provider
 *        that starts issuing ids with slashes in them is a slightly uglier
 *        filename rather than a thrown ingest. The id's real, unmodified value
 *        is on the row in `sourceId`, which is what provenance is read from.
 * WHERE: `ingestBlockVisual`'s key construction.
 */
function asStorageSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  return safe.length > 0 ? safe : "visual";
}
