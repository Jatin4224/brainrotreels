/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: captionsRouter, captions.styles, captions.get,
 *   captions.applyStyle, captions.align, LOCKED_NOT_HIDDEN, RESTYLING_IS_FREE,
 *   ALIGNMENT_RUNS_IN_A_WORKFLOW, DEGRADED_IS_NOT_A_CACHE_HIT
 *
 * WHAT:  The style library a workspace browses, the caption settings it
 *        saves, and the alignment that gives those captions their timing.
 *
 * WHY:   LOCKED_NOT_HIDDEN, as in the voice picker and for the same reason:
 *        `styles` returns EVERY style with a `locked` flag, never a
 *        plan-filtered subset. A style a customer never sees is one they have
 *        no reason to pay for, and filtering server-side is the obvious
 *        implementation that quietly removes the entire upsell. The lock is
 *        enforced on `apply`, which is the boundary.
 *
 *        RESTYLING_IS_FREE. `applyStyle` spends no credits and makes no provider
 *        call — it rebuilds a track from words that already exist. That is
 *        why it is rate limited loosely and `align` is not: one is a document
 *        write, the other is an STT round trip over the whole narration.
 *
 *        ALIGNMENT_RUNS_IN_A_WORKFLOW — `align` enqueues and returns. A
 *        narration is dozens of lines and each is a provider round trip, so
 *        doing it in the request would blow the 10-second transaction many
 *        times over. The same decision as `scripts.generate` and
 *        `voices.narrate`.
 * WHERE: Mounted as `captions` in src/trpc/routers/_app.ts.
 */

import { TRPCError } from "@trpc/server";

import { createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import { checkBooleanFeature, getOrganizationTier } from "@/lib/feature-gate";
import { enqueue } from "@/lib/adapters/jobs";
import {
  CAPTION_STYLE_FAMILIES,
  getCaptionStyle,
  isCaptionStyleId,
  listCaptionStyles,
  passesContrast,
} from "@/lib/captions";
import {
  alignProjectSchema,
  applyCaptionStyleSchema,
  captionStyleAvailableOnPlan,
  getCaptionsSchema,
  listCaptionStylesSchema,
} from "@/lib/types/caption";
import * as alignmentService from "@/services/alignment.service";
import { findProjectForOrganization } from "@/services/projects.service";

export const captionsRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: captions.styles, LOCKED_NOT_HIDDEN
   *
   * WHAT:  The whole library, each style marked locked or not.
   * WHY:   `locked` is computed from BOTH gates — the `premiumCaptionStyles`
   *        flag (may this workspace use gated styles at all) and the style's
   *        own `minPlan` (which ones) — because they answer different
   *        questions and a style is only usable when both allow it.
   *
   *        `contrastOk` ships with every card. It is not for the customer:
   *        it is how a style added without running the test shows up in the
   *        product rather than silently in somebody's video. The test is
   *        still the enforcement; this is the second pair of eyes.
   * WHERE: The style gallery.
   */
  styles: protectedProcedure({ requirePermission: permissions.CAPTION_STYLES_READ })
    .input(listCaptionStylesSchema)
    .query(async ({ input }) => {
      const [tier, premium] = await Promise.all([
        getOrganizationTier(input.organizationId),
        checkBooleanFeature(input.organizationId, "premiumCaptionStyles"),
      ]);

      const styles = listCaptionStyles({
        search: input.search,
        family: input.family,
      });

      return {
        plan: tier.tier,
        premiumEnabled: premium.enabled,
        upgradeMessage: premium.upgradeMessage,
        families: CAPTION_STYLE_FAMILIES,
        styles: styles.map((style) => {
          const withinPlan = captionStyleAvailableOnPlan(
            style.minPlan,
            tier.tier,
          );
          /* A style above the free tier needs the flag as well — the flag is
           * what a trial turns off wholesale. */
          const needsPremium = style.minPlan !== "free";
          return {
            ...style,
            locked: !withinPlan || (needsPremium && !premium.enabled),
            contrastOk: passesContrast(style).ok,
          };
        }),
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: captions.get, DEGRADED_IS_NOT_A_CACHE_HIT,
   *   READY_LINES_ONLY
   *
   * WHAT:  Everything the captions panel needs in one read: the saved
   *        settings, the alignment's state, and whether an alignment is
   *        needed at all.
   * WHY:   One query rather than three, so the panel's button, its badge and
   *        its warning were all decided from the same snapshot — fetching
   *        them separately shows "up to date" next to an enabled "Re-align"
   *        button for the instant between two queries.
   *
   *        `words` is returned in full. It is the input to the live preview,
   *        which has to group and time captions exactly as the renderer will
   *        — a count would make the preview a different program.
   * WHERE: /dashboard/projects/[id]/captions.
   */
  get: protectedProcedure({ requirePermission: permissions.CAPTION_STYLES_READ })
    .input(getCaptionsSchema)
    .query(async ({ ctx, input }) => {
      const project = await findProjectForOrganization(
        ctx.db,
        input.organizationId,
        input.projectId,
      );
      if (project === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const [settings, plan] = await Promise.all([
        alignmentService.readCaptionSettings(
          ctx.db,
          input.organizationId,
          input.projectId,
        ),
        alignmentService.alignmentPlan(
          ctx.db,
          input.organizationId,
          input.projectId,
        ),
      ]);

      const words =
        plan.existing === null
          ? []
          : alignmentService.readAlignmentWords(plan.existing);

      return {
        settings: settings ?? alignmentService.DEFAULT_CAPTION_SETTINGS,
        words,
        alignment:
          plan.existing === null
            ? null
            : {
                engine: plan.existing.engine,
                degraded: plan.existing.degraded,
                updatedAt: plan.existing.updatedAt,
                stale: !plan.cached,
              },
        narration: {
          lines: plan.lines.length,
          /* READY_LINES_ONLY — lines that failed or are still recording
           * cannot be aligned, and the panel says so rather than producing
           * captions with a hole in them. */
          skipped: plan.skipped,
          durationSec: Math.round(plan.totalDurationSec * 100) / 100,
        },
        upToDate: plan.cached,
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: captions.applyStyle, RESTYLING_IS_FREE,
   *   LOCKED_NOT_HIDDEN
   *
   * WHAT:  Saves the style, the band and the words-per-card, and rebuilds the
   *        caption track if the project has a document.
   * WHY:   This is the BOUNDARY the lock badge is a courtesy for. Both gates
   *        are re-checked server-side, because a disabled card stops a
   *        mistake, not a request — and the refusal carries the registry's
   *        own upgrade sentence so the client opens the same modal it would
   *        from a gated button.
   *
   *        An UNKNOWN style id is refused here rather than falling back to
   *        the default (which is what `getCaptionStyle` does for a render).
   *        A customer who picked a style and silently got another one has no
   *        way to tell that is what happened; a render of an old document
   *        naming a retired style has no better option than the default.
   * WHERE: The gallery's save action.
   */
  applyStyle: protectedProcedure({
    requirePermission: permissions.CAPTION_STYLES_APPLY,
    audit: { action: "applyStyle" },
  })
    .input(applyCaptionStyleSchema)
    .mutation(async ({ ctx, input }) => {
      if (!isCaptionStyleId(input.styleId)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That caption style is no longer available.",
        });
      }

      const style = getCaptionStyle(input.styleId);

      const [tier, premium] = await Promise.all([
        getOrganizationTier(input.organizationId),
        checkBooleanFeature(input.organizationId, "premiumCaptionStyles"),
      ]);

      const withinPlan = captionStyleAvailableOnPlan(style.minPlan, tier.tier);
      const needsPremium = style.minPlan !== "free";

      if (!withinPlan || (needsPremium && !premium.enabled)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            premium.upgradeMessage ??
            "That caption style is not included in your current plan.",
        });
      }

      const settings = {
        styleId: style.id,
        position: input.position ?? style.position,
        wordsPerChunk: input.wordsPerChunk ?? style.maxWords,
        enabled: input.enabled,
      };

      const saved = await alignmentService.writeCaptionSettings(
        ctx.db,
        input.organizationId,
        input.projectId,
        settings,
      );
      if (!saved) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      /* TIMELINE_IS_OPTIONAL_UNTIL_PHASE_09 — a no-op, reported honestly,
       * when the project has no document yet. */
      const applied = await alignmentService.applyCaptionsToTimeline(ctx.db, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        styleId: settings.styleId,
        position: settings.position,
        wordsPerChunk: settings.wordsPerChunk,
        enabled: settings.enabled,
      });

      return { settings, ...applied };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: captions.align, ALIGNMENT_RUNS_IN_A_WORKFLOW,
   *   READY_LINES_ONLY, DEGRADED_IS_NOT_A_CACHE_HIT
   *
   * WHAT:  Starts (or re-starts) the alignment of a project's narration.
   * WHY:   Refuses BEFORE enqueuing when there is nothing to align, because a
   *        refusal the customer is waiting on can say "record the narration
   *        first", whereas one inside a run can only mark the project failed.
   *        The workflow re-checks, because it trusts no payload.
   *
   *        A cache hit returns `queued: false` rather than running: that is
   *        the phase's "re-aligning unchanged audio makes zero provider
   *        calls", enforced at the only door that can start a run.
   * WHERE: The captions panel's Align / Re-align button.
   */
  align: protectedProcedure({
    requirePermission: permissions.CAPTION_STYLES_ALIGN,
    audit: { action: "align" },
  })
    .input(alignProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const plan = await alignmentService.alignmentPlan(
        ctx.db,
        input.organizationId,
        input.projectId,
        { force: input.force === true },
      );

      if (plan.lines.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            plan.skipped > 0
              ? "The narration is not finished — record every line before timing the captions."
              : "Record the narration first; captions are timed against it.",
        });
      }

      if (plan.cached) {
        return { queued: false, upToDate: true };
      }

      await enqueue({
        name: "align/requested",
        data: {
          projectId: input.projectId,
          organizationId: input.organizationId,
          force: input.force === true,
        },
        /* Keyed on the project AND the audio, so a double-click produces one
         * run while a genuine re-run after a re-recorded line is a different
         * key and is not swallowed as a duplicate. */
        id: `align-${input.projectId}-${plan.audioHash}`,
      });

      return { queued: true, upToDate: false };
    }),
});
