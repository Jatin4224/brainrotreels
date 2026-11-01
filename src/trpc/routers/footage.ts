/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: footageRouter, aiFootage.generate, aiFootage.list,
 *   aiFootage.estimate, MODERATE_BEFORE_THE_MODEL, REFUSE_BEFORE_PAYING,
 *   CACHE_BEFORE_SPEND, THE_GATE_IS_CALLED_NOT_INHERITED,
 *   GENERATION_STARTS_OUTSIDE_THE_REQUEST, COST_ON_THE_BUTTON
 *
 * WHAT:  The three verbs of the footage studio: what a clip would cost, the
 *        clips this workspace has, and generate one.
 *
 * WHY:   GENERATION_STARTS_OUTSIDE_THE_REQUEST, which is the shape of this
 *        whole file. `generate` classifies the prompt, checks the cache,
 *        refuses what cannot be paid for, writes a row and enqueues — then
 *        RETURNS. It never calls the video model: a generation runs for
 *        minutes and a mutation runs inside a short transaction. The same
 *        split `renders.create` makes.
 *
 *        MODERATE_BEFORE_THE_MODEL happens HERE rather than in the workflow,
 *        and that is deliberate. The phase's step 3 requires the check before
 *        the model call and requires it to fail closed; doing it in the
 *        request means a customer whose prompt is refused is told so
 *        IMMEDIATELY and can reword, instead of watching a tile fail a minute
 *        later with nothing to act on. The decision is recorded either way, so
 *        a refusal still leaves a trail. The workflow does not repeat it: this
 *        is its only producer, and a second classifier call would be paying
 *        twice for an answer already written down.
 *
 *        CACHE_BEFORE_SPEND. An identical prompt at the same length in the
 *        same workspace returns the existing clip, synchronously, with no job
 *        and no charge — the most expensive call in the product is exactly the
 *        one worth not making twice.
 *
 *        REFUSE_BEFORE_PAYING, on the estimate, before the row exists. A
 *        refusal must leave no trace: a `processing` asset that was never
 *        affordable would sit in the library as a clip that is about to arrive
 *        and never will. The HOLD is placed by the workflow — see
 *        HOLD_IN_THE_WORKFLOW there — because a credit movement inside a
 *        request that may time out strands money with no run to release it.
 *
 *        THE_GATE_IS_CALLED_NOT_INHERITED, and this is the one piece of
 *        plumbing worth explaining. The procedure factory applies a limit gate
 *        automatically, but only on the `create` verb — and `create` would
 *        ALSO auto-increment the counter at request time. That would charge a
 *        customer one of their twenty monthly clips for a generation the
 *        provider may refuse. So the verb is `generate`, and the gate is
 *        called explicitly through the same `checkFeatureGate` the factory
 *        uses, reading the same registry entry. The allowance is spent in the
 *        workflow when a clip actually exists (COUNTED_WHEN_THE_CLIP_EXISTS).
 *
 *        COST_ON_THE_BUTTON: `estimate` exists so the button can carry its
 *        price, from the same estimator the hold uses.
 * WHERE: Mounted as `aiFootage` in src/trpc/routers/_app.ts.
 */

import { TRPCError } from "@trpc/server";

import { enqueue } from "@/lib/adapters/jobs";
import { getVideoAdapter } from "@/lib/adapters/video";
import { estimate } from "@/lib/credits";
import { ERROR_CODES } from "@/lib/errors";
import { checkFeatureGate } from "@/lib/feature-gate";
import { permissions } from "@/lib/permissions";
import { uploadKey } from "@/lib/adapters/storage/keys";
import {
  estimateFootageSchema,
  generateFootageSchema,
  listFootageSchema,
} from "@/lib/types/footage";
import { getBalance } from "@/services/credits.service";
import * as footageService from "@/services/footage.service";

import { createStructuredError, createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";

export const footageRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: aiFootage.estimate, COST_ON_THE_BUTTON,
   *   ONE_PRICE_TWO_SURFACES
   *
   * WHAT:  What a clip of this length costs, and whether it is affordable.
   * WHY:   The same estimator the hold uses, so the number on the button is
   *        provably the number that gets reserved. It returns the BALANCE
   *        alongside, so the button can switch to "Top up" without a second
   *        round trip and so the two numbers it compares were read at the same
   *        instant.
   *
   *        It also reports whether a provider is configured at all, because a
   *        deployment with no credential should say so on the screen rather
   *        than accepting a request it cannot serve.
   * WHERE: The footage form's submit button.
   */
  estimate: protectedProcedure({
    requirePermission: permissions.AI_FOOTAGE_READ,
  })
    .input(estimateFootageSchema)
    .query(async ({ ctx, input }) => {
      const cost = estimate({
        kind: "aiFootage",
        durationSeconds: input.durationSec,
      });

      const [balance, adapter, gate] = await Promise.all([
        getBalance(input.organizationId, ctx.db),
        getVideoAdapter(),
        checkFeatureGate(input.organizationId, "aiFootage"),
      ]);

      return {
        cost,
        balance,
        available: adapter.configured,
        /* The plan's own answer, so the screen can explain a zero allowance
         * with the registry's upgrade sentence rather than inventing copy. */
        allowed: gate.allowed,
        upgradeMessage: gate.upgradeMessage,
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: aiFootage.list, A_FAILED_CLIP_IS_STILL_SHOWN
   *
   * WHAT:  This workspace's generated clips, newest first.
   * WHY:   Includes rows that are still processing and rows that failed, with
   *        their reason — see A_FAILED_CLIP_IS_STILL_SHOWN in the service. The
   *        screen polls this while a clip is being made.
   * WHERE: The footage grid.
   */
  list: protectedProcedure({ requirePermission: permissions.AI_FOOTAGE_READ })
    .input(listFootageSchema)
    .query(async ({ ctx, input }) => ({
      clips: await footageService.listFootage(ctx.db, input.organizationId),
    })),

  /**
   * SOURCE OF TRUTH KEYWORDS: aiFootage.generate, MODERATE_BEFORE_THE_MODEL,
   *   CACHE_BEFORE_SPEND, REFUSE_BEFORE_PAYING, THE_GATE_IS_CALLED_NOT_INHERITED
   *
   * WHAT:  Queues one clip, or returns the one this workspace already has.
   * WHY:   The order of the five checks is the whole design, and each one is
   *        before the next for a reason given in the file header: provider,
   *        allowance, moderation, cache, balance. Nothing is written and
   *        nothing is enqueued until all five pass.
   * WHERE: The footage form.
   */
  generate: protectedProcedure({
    requirePermission: permissions.AI_FOOTAGE_CREATE,
    audit: { action: "generate" },
  })
    .input(generateFootageSchema)
    .mutation(async ({ ctx, input }) => {
      /* [1] Is this even possible here? A deployment with no credential
       * refuses before anything is recorded — NOT_CONFIGURED_IS_A_CASE. */
      const adapter = await getVideoAdapter();
      if (!adapter.configured) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Footage generation is not configured on this deployment yet.",
        });
      }

      /* [2] THE_GATE_IS_CALLED_NOT_INHERITED — the registry's allowance, read
       * through the same function the factory would have used. */
      const gate = await checkFeatureGate(input.organizationId, "aiFootage");
      if (!gate.allowed) {
        throw createStructuredError(
          "FORBIDDEN",
          gate.reason ?? "Plan limit reached",
          {
            errorCode: ERROR_CODES.USAGE_LIMIT_REACHED,
            resource: "aiFootage",
            limit: gate.limit ?? 0,
            current: gate.currentUsage ?? 0,
            currentPlan: gate.plan,
            upgradeRequired: true,
            message: gate.reason ?? "You have no AI footage left this month.",
            upgradeMessage: gate.upgradeMessage,
          },
        );
      }

      /* [3] MODERATE_BEFORE_THE_MODEL, and before the cache: a refused prompt
       * must be refused even if an identical one slipped through earlier. */
      const cleared = await footageService.moderateFootagePrompt(ctx.db, {
        organizationId: input.organizationId,
        prompt: input.prompt,
      });
      if (!cleared) {
        throw createStructuredError(
          "FORBIDDEN",
          "That prompt cannot be used to generate video.",
          {
            errorCode: ERROR_CODES.CONTENT_POLICY,
            /* The categories are recorded on the moderation row; the customer
             * is told the shape of the problem rather than a classifier's
             * label, which is rarely actionable prose. */
            categories: ["prompt"],
            review: false,
            message:
              "That prompt cannot be used to generate video. Avoid real people, brands and trademarks, and describe the scene instead.",
          },
        );
      }

      /* [4] CACHE_BEFORE_SPEND — the same prompt at the same length is the
       * clip they already have. */
      const promptHash = footageService.footagePromptHash(input.prompt);
      const cached = await footageService.findCachedFootage(ctx.db, {
        organizationId: input.organizationId,
        promptHash,
        durationSec: input.durationSec,
      });
      if (cached !== null) {
        return { assetId: cached.id, reused: true, cost: null };
      }

      /* [5] REFUSE_BEFORE_PAYING, on the estimate and before the row. */
      const cost = estimate({
        kind: "aiFootage",
        durationSeconds: input.durationSec,
      });
      const balance = await getBalance(input.organizationId, ctx.db);
      if (balance < cost.total) {
        throw createStructuredError(
          "FORBIDDEN",
          `This clip costs ${cost.total} credits and this workspace has ${balance}.`,
          {
            errorCode: ERROR_CODES.INSUFFICIENT_CREDITS,
            resource: "credits",
            required: cost.total,
            available: balance,
            message: `Not enough credits for this clip. ${cost.total} needed, ${balance} available.`,
          },
        );
      }

      /* THE_ROW_EXISTS_BEFORE_THE_SPEND. Created here so the grid shows the
       * request the instant it is made, and shows it failing if it fails. */
      const asset = await footageService.createFootageAsset(ctx.db, {
        organizationId: input.organizationId,
        prompt: input.prompt,
        promptHash,
        durationSec: input.durationSec,
        filename: `${promptHash}.mp4`,
        /* A workspace-level key, not a project one: a generated clip belongs to
         * the library and can be used in any project, or none. */
        storageKey: uploadKey(
          input.organizationId,
          `footage-${promptHash}`,
          "clip.mp4",
        ),
      });

      await enqueue({
        requestId: ctx.requestId,
        name: "clip/requested",
        data: {
          organizationId: input.organizationId,
          assetId: asset.id,
          prompt: input.prompt,
          durationSec: input.durationSec,
        },
        /* Keyed on the asset, which is unique per request: a double-click
         * collapses onto one run, while a genuine second attempt at the same
         * prompt is a cache hit above and never reaches here. */
        id: `clip-${asset.id}`,
      });

      return { assetId: asset.id, reused: false, cost };
    }),
});
