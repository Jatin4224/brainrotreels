/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: visualsRouter, aiImages.list, aiImages.searchStock,
 *   aiImages.setBlockVisual, BlockVisualTile, StockCandidateTile,
 *   SWAP_IS_ONE_BLOCK, LICENCE_IS_SHOWN_ON_EVERY_CANDIDATE,
 *   SET_IS_THE_BOUNDARY, THE_CHAIN_IS_NOT_RE_RUN_HERE,
 *   AVAILABILITY_IS_TOLD_NOT_GUESSED
 *
 * WHAT:  The per-block visuals a customer sees before generating, the stock
 *        search behind the swap drawer, and the write that replaces one block's
 *        picture.
 *
 * WHY:   SET_IS_THE_BOUNDARY, which is the decision this router is shaped
 *        around. Everything a client can see here — a licence on a tile, a
 *        plan's remaining image allowance, which provider is configured — is a
 *        hint, and `setBlockVisual` re-checks every gate that matters: the
 *        workspace's `aiImages` quota, the credit balance, the download host of
 *        a stock URL, and the readability of an uploaded asset. A lock badge
 *        stops a mistake, not a request — the same argument
 *        APPLY_IS_THE_BOUNDARY makes in the backgrounds router.
 *
 *        LICENCE_IS_SHOWN_ON_EVERY_CANDIDATE is the phase's step 8 in so many
 *        words ("show the licence on each candidate"), and it is satisfied
 *        structurally rather than by a component remembering to: `license` is a
 *        REQUIRED field on `StockCandidate`, so a tile cannot be rendered from
 *        a candidate that has none.
 *
 *        THE_CHAIN_IS_NOT_RE_RUN_HERE. There is no "choose for me again"
 *        mutation, and that is deliberate. The automatic chain costs a model
 *        call for the shot plan plus a search per block plus possibly an image
 *        per block, and it belongs to the generate pipeline where the hold, the
 *        settlement and the per-block ingest runs already live. What a customer
 *        gets here is the four things the phase asks for — search stock again,
 *        prompt an image again, use their own upload, fall back to the
 *        background — each of which is one `setBlockVisual` call with a
 *        different `choice`. One verb, four sources, no second copy of the
 *        chain.
 *
 *        AVAILABILITY_IS_TOLD_NOT_GUESSED. `list` reports whether the stock
 *        seam and the image seam are configured, because a client that inferred
 *        it from an empty search result would show "no clips match" for a
 *        deployment that simply has no key — two completely different sentences
 *        for the customer, and only the server knows which is true.
 *
 *        Mounted as `aiImages`, matching its registry entry, which is what wires
 *        the permissions and the rate limits: the factory derives both from the
 *        procedure PATH (AUTO_DERIVED_FROM_RESOURCES). The resource declares no
 *        `create` verb on purpose — see RESOURCES.aiImages for why a `create`
 *        or `delete` here would make the monthly allowance refundable with two
 *        clicks — so the quota check in `setBlockVisual` is written out rather
 *        than automatic.
 * WHERE: Mounted as `aiImages` in src/trpc/routers/_app.ts. Reads and writes
 *        through src/services/visuals.service.ts; the fetching and the model
 *        call are handed to the `visual.ingest` workflow via
 *        `footage/requested`.
 */

import { TRPCError } from "@trpc/server";

import type { DbClient } from "@/lib/config/prisma";

import { createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import { checkFeatureGate } from "@/lib/feature-gate";
import { CREDIT_RATES, estimateVisualsCost } from "@/lib/credits";
import { enqueue } from "@/lib/adapters/jobs";
import { assertStockDownloadUrl } from "@/lib/adapters/stock/hosts";
import {
  blockVisualSchema,
  listBlockVisualsSchema,
  searchStockSchema,
  setBlockVisualSchema,
  visualPromptHash,
  type BlockVisual,
  type StockCandidate,
  type VisualChoice,
} from "@/lib/types/visual";
import { listScriptBlocks } from "@/services/scripts.service";
import { isModerationCleared, signVariantUrl } from "@/services/assets.service";
import { getBalance } from "@/services/credits.service";
import * as visualsService from "@/services/visuals.service";

/**
 * SOURCE OF TRUTH KEYWORDS: BlockVisualTile, TILE_IS_WHAT_A_PICKER_NEEDS
 *
 * WHAT:  One script block as the swap UI renders it: the paragraph it belongs
 *        to, where its picture came from, and a poster to show for it.
 *
 * WHY:   TILE_IS_WHAT_A_PICKER_NEEDS, named rather than inferred for the reason
 *        `BackgroundTile` is: the shape survives to the client through
 *        `inferRouterOutputs`, and naming it keeps a component from being
 *        written against whatever this handler happened to return.
 *
 *        The row is built from the SCRIPT BLOCKS and not from the stored
 *        visuals, so a block with no entry appears in the list with
 *        `source: 'background'` rather than being missing. A customer looking
 *        at a five-paragraph script must see five rows — four pictures and one
 *        "on the background" is a thing they can act on, and four rows is a
 *        list they will think is broken.
 *
 *        `posterUrl` is the THUMB variant, not the master: a five-row list of
 *        full-size stills is tens of megabytes for a drawer somebody glances
 *        at. Null while an ingest is still running, which the row also reports
 *        through `status`.
 * WHERE: `list` below; src/components/global/visual-picker.
 */
export interface BlockVisualTile {
  blockId: string;
  /** Which paragraph this is, 1-based, for the row's heading. */
  position: number;
  /** A short excerpt of the narration, so a row is identifiable. */
  excerpt: string;
  source: VisualChoice["source"];
  status: BlockVisual["status"];
  /** The licence of whatever is on screen. Null for the styled background. */
  license: string | null;
  attribution: string | null;
  /** The stock query this block's pick came from, for a second search. */
  query: string | null;
  /** The image prompt proposed for it, for a second generation. */
  prompt: string | null;
  /** Customer-facing, and only when `status` is `failed`. */
  error: string | null;
  posterUrl: string | null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: StockCandidateTile,
 *   LICENCE_IS_SHOWN_ON_EVERY_CANDIDATE
 *
 * WHAT:  One search result as a tile, and as the exact object
 *        `setBlockVisual` takes back.
 *
 * WHY:   It IS the `StockCandidate` — the same shape, not a projection of it —
 *        so the swap UI hands back what it was given rather than reassembling
 *        a choice from fields it picked off a tile. That is what stops a tile
 *        losing the licence on the way to the write, which is the one piece of
 *        provenance that cannot be recovered later
 *        (PROVENANCE_IS_NOT_OPTIONAL).
 * WHERE: `searchStock` below.
 */
export type StockCandidateTile = StockCandidate;

/**
 * SOURCE OF TRUTH KEYWORDS: EXCERPT_CHARS, EXCERPT_IS_FOR_IDENTIFYING
 *
 * How much of a paragraph a row shows. Enough to recognise which paragraph it
 * is and not enough to be the paragraph — the script screen is where the words
 * are read, and a drawer that repeated them in full would push the pictures,
 * which are the point of this screen, off the bottom.
 */
const EXCERPT_CHARS = 120;

export const visualsRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: aiImages.list, AVAILABILITY_IS_TOLD_NOT_GUESSED,
   *   COST_ON_THE_BUTTON
   *
   * WHAT:  Every script block with its current visual, what this workspace may
   *        still generate, and what the images already planned will cost.
   *
   * WHY:   COST_ON_THE_BUTTON is the phase's step 9 — "the review step itemises
   *        'N images' in the breakdown" — and the breakdown comes from
   *        `estimateVisualsCost`, which is the SAME function the `visuals`
   *        stage holds against and settles with. Three places, one answer; a
   *        second calculation in a component is how a customer is shown one
   *        price and charged another.
   *
   *        The remaining allowance is reported as a NUMBER rather than as a
   *        boolean, because the two refusals read differently: a workspace with
   *        no allowance at all gets the upgrade modal, and one that has used
   *        forty-eight of fifty needs to be told that two paragraphs can have
   *        images and the rest cannot.
   * WHERE: The visual picker's query.
   */
  list: protectedProcedure({
    requirePermission: permissions.AI_IMAGES_READ,
  })
    .input(listBlockVisualsSchema)
    .query(async ({ ctx, input }) => {
      const stored = await visualsService.readBlockVisuals(
        ctx.db,
        input.organizationId,
        input.projectId,
      );
      if (stored === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That project could not be found.",
        });
      }

      const blocks = await listScriptBlocks(
        ctx.db,
        input.organizationId,
        input.projectId,
      );
      const byBlock = new Map(
        stored.blocks.map((entry) => [entry.blockId, entry]),
      );

      const tiles: BlockVisualTile[] = [];
      for (const [index, block] of blocks.entries()) {
        const entry = byBlock.get(block.id);
        const choice = entry?.choice ?? { source: "background" as const };

        /* Signed only for a block whose asset is actually there. A pending or
         * failed block has no variant to sign, and asking would be a query per
         * row for a guaranteed null. */
        const posterUrl =
          entry?.status === "ready" && entry.assetId !== undefined
            ? await signVariantUrl(
                entry.assetId,
                "thumb",
                input.organizationId,
              )
            : null;

        tiles.push({
          blockId: block.id,
          position: index + 1,
          excerpt: excerpt(block.narrationText),
          source: choice.source,
          status: entry?.status ?? "ready",
          license: choice.source === "stock" ? choice.license : null,
          attribution:
            choice.source === "stock" ? (choice.attribution ?? null) : null,
          query: entry?.query ?? null,
          prompt: entry?.prompt ?? null,
          error: entry?.error ?? null,
          posterUrl,
        });
      }

      const [gate, balance, stockReady, imageReady] = await Promise.all([
        checkFeatureGate(input.organizationId, "aiImages", 0),
        getBalance(input.organizationId),
        visualsService.stockSearchAvailable(),
        visualsService.imageGenerationAvailable(),
      ]);

      const quotaLeft = gate.allowed
        ? gate.limit === undefined
          ? blocks.length
          : Math.max(0, gate.limit - (gate.currentUsage ?? 0))
        : 0;
      const affordable = Math.max(
        0,
        Math.floor(balance / Math.max(1, CREDIT_RATES.perAiImage)),
      );

      const plannedImages = stored.blocks.filter(
        (entry) => entry.choice.source === "ai_image",
      ).length;

      return {
        blocks: tiles,
        /* AVAILABILITY_IS_TOLD_NOT_GUESSED — see the file header. */
        stockAvailable: stockReady,
        imagesAvailable: imageReady,
        /** The lower of the plan's remaining allowance and what the balance buys. */
        imagesRemaining: Math.min(quotaLeft, affordable),
        imagesUsed: gate.currentUsage ?? 0,
        imagesLimit: gate.limit ?? null,
        upgradeMessage: gate.upgradeMessage,
        /* The plan the gates were judged against, so the upload tab can size
         * its own limit from the same answer rather than reading a second one
         * — the background picker returns it for the identical reason. */
        plan: gate.plan,
        /** COST_ON_THE_BUTTON — itemised, from the same estimator. */
        cost: estimateVisualsCost({ aiImages: plannedImages }),
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: aiImages.searchStock, EMPTY_IS_NOT_A_FAILURE,
   *   THEIR_RATE_LIMIT_NOT_OURS
   *
   * WHAT:  Candidate clips for a query the customer typed or edited.
   *
   * WHY:   A QUERY rather than a mutation, because nothing is written and
   *        nothing is charged — but it is rate-limited harder than a read
   *        usually is, because every call is a request against a third-party
   *        quota shared by every workspace on the deployment
   *        (THEIR_RATE_LIMIT_NOT_OURS on the registry entry).
   *
   *        Returns an empty array for an unconfigured deployment as well as for
   *        a query that matched nothing — the two are distinguished by
   *        `list`'s `stockAvailable`, which is where the UI gets the sentence
   *        from. Collapsing them here would mean a component inferring a
   *        deployment's configuration from a search result.
   *
   *        `blockSeconds` is taken from the project's own narration rather than
   *        from the client, so the ordering a customer sees is scored against
   *        the real length of the paragraph — the same length the automatic pick
   *        used (PICKER_SHOWS_THE_SAME_ORDER).
   * WHERE: The swap drawer's search box.
   */
  searchStock: protectedProcedure({
    requirePermission: permissions.AI_IMAGES_READ,
  })
    .input(searchStockSchema)
    .query(async ({ ctx, input }) => {
      const candidates = await visualsService.searchStock({
        query: input.query,
        /* SEARCH_IS_SCORED_FOR_A_BLOCK — the paragraph's real measured
         * length, read server-side, so this grid and the automatic pick are
         * ordered by the same rule. */
        blockSeconds: await visualsService.blockSeconds(ctx.db, {
          organizationId: input.organizationId,
          projectId: input.projectId,
          blockId: input.blockId,
        }),
      });

      return { candidates };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: aiImages.setBlockVisual, SWAP_IS_ONE_BLOCK,
   *   SET_IS_THE_BOUNDARY, NO_SSRF_THROUGH_A_STORED_URL,
   *   MODERATE_BEFORE_THE_MODEL
   *
   * WHAT:  Replaces one block's visual with a stock clip, a generated image, an
   *        upload of the customer's own, or the styled background.
   *
   * WHY:   SET_IS_THE_BOUNDARY. Four checks happen here and nowhere earlier,
   *        each guarding something a client could otherwise reach past:
   *
   *          - A STOCK URL is checked against the provider's registered
   *            delivery hosts BEFORE it is stored, not only before it is
   *            fetched. The workflow checks it again — this stops a bad row
   *            being written, that stops a bad row being used
   *            (NO_SSRF_THROUGH_A_STORED_URL).
   *          - An IMAGE is gated on the plan's `aiImages` allowance and on the
   *            balance, with the registry's own upgrade sentence, so a free
   *            workspace is refused server-side and not merely hidden from.
   *          - An IMAGE PROMPT is classified before anything is stored, because
   *            storing it means a workflow will send it to a model
   *            (MODERATE_BEFORE_THE_MODEL, the phase's step 7).
   *          - An UPLOAD is re-read as a row in THIS workspace, so a guessed
   *            asset id cannot attach another tenant's media to this project.
   *
   *        SWAP_IS_ONE_BLOCK: the input names one `blockId` and the write
   *        touches one entry (`upsertBlockVisual`), which is the phase's
   *        "swapping one block's visual leaves the other blocks untouched"
   *        expressed as a signature rather than as a thing this handler
   *        remembers.
   *
   *        The fetching is handed to `visual.ingest` rather than done here, for
   *        the reason every other heavy path in this codebase gives: a mutation
   *        runs inside a ten-second transaction budget and an image generation
   *        takes tens of seconds. A `background` choice is the one case that
   *        enqueues nothing, because there are no bytes.
   * WHERE: Every button in the swap drawer.
   */
  setBlockVisual: protectedProcedure({
    requirePermission: permissions.AI_IMAGES_GENERATE,
  })
    .input(setBlockVisualSchema)
    .mutation(async ({ ctx, input }) => {
      const stored = await visualsService.readBlockVisuals(
        ctx.db,
        input.organizationId,
        input.projectId,
      );
      if (stored === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That project could not be found.",
        });
      }

      /* The block has to be a real block of THIS project's script — otherwise
       * the settings would grow entries no paragraph will ever claim, and the
       * generator would carry them forever. */
      const blocks = await listScriptBlocks(
        ctx.db,
        input.organizationId,
        input.projectId,
      );
      const block = blocks.find((entry) => entry.id === input.blockId);
      if (block === undefined) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That paragraph is no longer part of this script.",
        });
      }

      const choice = await validateChoice(ctx.db, {
        organizationId: input.organizationId,
        choice: input.choice,
      });

      const previous = stored.blocks.find(
        (entry) => entry.blockId === input.blockId,
      );

      const next = blockVisualSchema.parse({
        blockId: input.blockId,
        choice,
        status: choice.source === "background" ? "ready" : "pending",
        /* The query and the prompt survive a swap, so the drawer's "search
         * again" and "generate again" still have the text the automatic plan
         * proposed — see the note on `blockVisualSchema`. A customer-typed
         * prompt replaces the stored one, because it is now the one that
         * describes what is on screen. */
        ...(choice.source === "ai_image"
          ? { prompt: choice.prompt }
          : previous?.prompt === undefined
            ? {}
            : { prompt: previous.prompt }),
        ...(previous?.query === undefined ? {} : { query: previous.query }),
      });

      const written = await visualsService.upsertBlockVisual(ctx.db, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        block: next,
      });
      if (!written) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That project could not be found.",
        });
      }

      if (next.status === "pending") {
        await enqueue({
          name: "footage/requested",
          data: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            blockId: input.blockId,
          },
          /* Keyed on the block AND the choice, so a double-clicked button
           * collapses to one run while a genuine second swap of the same block
           * gets its own. A key on the block alone would make a customer's
           * change of mind a no-op. */
          id: `visual-${input.projectId}-${input.blockId}-${choiceKey(choice)}`,
        });
      }

      return { blockId: input.blockId, source: choice.source, status: next.status };
    }),
});

/**
 * SOURCE OF TRUTH KEYWORDS: validateChoice, SET_IS_THE_BOUNDARY
 *
 * WHAT:  The four per-source checks `setBlockVisual` makes, in one place.
 * WHY:   Factored out so the handler reads as what it does rather than as four
 *        nested branches — and so the checks are exhaustive over the union by
 *        construction: a fifth source cannot be added without a case here,
 *        because the `switch` returns on every arm and TypeScript proves it.
 * WHERE: `setBlockVisual`.
 */
async function validateChoice(
  db: DbClient,
  args: {
    organizationId: string;
    choice: VisualChoice;
  },
): Promise<VisualChoice> {
  const { choice } = args;

  switch (choice.source) {
    case "background":
      return choice;

    case "stock": {
      if (!(await visualsService.stockSearchAvailable())) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stock footage is not available on this deployment.",
        });
      }
      try {
        /* NO_SSRF_THROUGH_A_STORED_URL — refused before it is stored. */
        assertStockDownloadUrl(choice.provider, choice.downloadUrl);
      } catch (error) {
        console.error(
          `[aiImages.setBlockVisual] refused a stock URL — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That clip could not be used. Pick another one.",
        });
      }
      return choice;
    }

    case "upload": {
      const row = await db.asset.findFirst({
        where: {
          id: choice.assetId,
          organizationId: args.organizationId,
          status: "ready",
        },
        select: { id: true, contentType: true, moderationStatus: true },
      });
      if (row === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That file could not be found in this workspace.",
        });
      }
      if (
        !row.contentType.startsWith("image/") &&
        !row.contentType.startsWith("video/")
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A paragraph's visual has to be an image or a video.",
        });
      }
      /* NOT_APPROVED_DOES_NOT_RENDER. Refused here rather than silently
       * accepted, because a block pointing at an uncleared asset would fall
       * back to the background at render time with nothing explaining why. */
      if (!isModerationCleared(row.moderationStatus)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "That file is still being reviewed. It can be used once the review is done.",
        });
      }
      return choice;
    }

    case "ai_image": {
      if (!(await visualsService.imageGenerationAvailable())) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Image generation is not available on this deployment.",
        });
      }

      /* The plan's allowance, with the registry's own sentence — the same
       * refusal a gated tile's upgrade modal shows. */
      const gate = await checkFeatureGate(args.organizationId, "aiImages", 1);
      if (!gate.allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: gate.reason ?? gate.upgradeMessage,
        });
      }

      const balance = await getBalance(args.organizationId);
      if (balance < CREDIT_RATES.perAiImage) {
        throw new TRPCError({
          code: "PAYMENT_REQUIRED",
          message:
            "There are not enough credits to generate an image. Top up and try again.",
        });
      }

      /* MODERATE_BEFORE_THE_MODEL — the phase's step 7, and before the choice
       * is STORED rather than before it is used: a stored prompt is one a
       * workflow will send to a model. */
      const cleared = await visualsService.moderateImagePrompt(db, {
        organizationId: args.organizationId,
        prompt: choice.prompt,
      });
      if (!cleared) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That description could not be used. Avoid real people, brands and anything graphic, and try again.",
        });
      }

      /* The hash is recomputed server-side rather than taken from the client:
       * it is the CACHE KEY, and a client that could choose it could point a
       * block at another prompt's image. */
      return {
        source: "ai_image",
        prompt: choice.prompt,
        promptHash: visualPromptHash(choice.prompt),
      };
    }
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: choiceKey, IDEMPOTENCY_KEY
 *
 * A short, stable identity for one choice, so a double-clicked button collapses
 * to one run and a real change of mind does not. Derived from the fields that
 * decide WHICH picture, never from the whole object — a stock URL's expiring
 * query parameters would otherwise make the same clip a different key on every
 * search.
 */
function choiceKey(choice: VisualChoice): string {
  switch (choice.source) {
    case "stock":
      return `stock-${choice.provider}-${choice.providerId}`;
    case "ai_image":
      return `image-${choice.promptHash}`;
    case "upload":
      return `upload-${choice.assetId}`;
    case "background":
      return "background";
  }
}

function excerpt(text: string): string {
  const flat = text.trim().replace(/\s+/g, " ");
  return flat.length <= EXCERPT_CHARS
    ? flat
    : `${flat.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`;
}

