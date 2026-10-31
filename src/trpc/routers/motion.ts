/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: motionRouter, motionStudio.styles, motionStudio.designStyle,
 *   motionStudio.design, motionStudio.redesignBeat, GATE_IS_THE_WHOLE_ROUTER,
 *   CODE_VALIDATES_NOT_THE_EYE, DESIGN_IS_A_MUTATION, ONE_BEAT_IS_THE_UNIT
 *
 * WHAT:  The motion studio's four procedures: list the style library, design a
 *        style from three answers, read a project's storyboard, and redesign
 *        one beat of it.
 *
 * WHY:   GATE_IS_THE_WHOLE_ROUTER. Mounted under the registry key
 *        `motionStudio`, so the procedure factory's flag gate fires on every
 *        verb including the READ — a workspace without the feature cannot list
 *        the library and cannot reach `designStyle` by calling it directly.
 *        `free: false` and `starter: false` in one registry entry are the
 *        whole of the server-side enforcement, and there is no per-procedure
 *        check to forget. The same arrangement `timelineEditor` uses.
 *
 *        DESIGN_IS_A_MUTATION even though it stores nothing, which is the same
 *        departure `quizzes.previewQuestion` makes and for the same reason: a
 *        model request is not idempotent and must not be re-fired by a cache
 *        revalidation, a window refocus or a react-query retry. Each firing is
 *        a billed request.
 *
 *        `designStyle` still stores NOTHING, and that is not an oversight:
 *        a designed style is handed back and kept in the screen's state until
 *        somebody applies it. `redesignBeat` does write, and it is the only
 *        verb here that does — one beat's scene, in place, leaving every
 *        sibling byte-identical (THE_OTHERS_ARE_BYTE_IDENTICAL).
 *
 *        ONE_BEAT_IS_THE_UNIT. There is deliberately no "redesign this video"
 *        verb. Redesigning everything is the PIPELINE's job, where it is a
 *        metered stage with a progress row and durable steps; a tRPC mutation
 *        that fanned out forty model requests would hold a transaction open
 *        for minutes and lose the lot on the first timeout. The strip's button
 *        fixes one graphic, which is the thing a human reviewing a video
 *        actually wants.
 *
 *        CODE_VALIDATES_NOT_THE_EYE: the validation is NOT here. It is inside
 *        `designMotionStyle`, between the model and the return, because the
 *        refusals are fed back to the model for one repair attempt rather than
 *        shown to the customer. By the time this router sees a result it is
 *        either a valid style or an `LlmError`.
 * WHERE: Mounted as `motionStudio` in src/trpc/routers/_app.ts.
 */

import { TRPCError } from "@trpc/server";

import { LlmError } from "@/lib/adapters/llm";
import { SAFE_ZONE_BY_ASPECT } from "@/lib/generators/common";
import { getMotionStyle, listMotionStyles } from "@/lib/motion-styles";
import { permissions } from "@/lib/permissions";
import { beatSeconds, resolveSceneAnchors } from "@/lib/scene";
import { designBeat, designMotionStyle } from "@/lib/script";
import {
  designMotionStyleSchema,
  listMotionStylesSchema,
} from "@/lib/types/motion-style";
import { CANVAS_BY_ASPECT, aspectRatioSchema } from "@/lib/types/project";
import {
  motionDesignSchema,
  redesignBeatSchema,
  toBeatIntent,
  type Beat,
  type MotionBeatView,
  type MotionDesignView,
} from "@/lib/types/scene";
import {
  readMotionBeatContext,
  replaceMotionBeat,
} from "@/services/motion.service";

import { createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";

export const motionRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: motionStudio.styles, A_FLAG_THAT_GATES_READS
   *
   * WHAT:  The shipped style library.
   * WHY:   A query, and gated — see GATE_IS_THE_WHOLE_ROUTER. It reads no
   *        database and takes no project: the library is module data, and this
   *        procedure exists so the screen gets it through the same gate as
   *        everything else rather than importing it into a client bundle and
   *        rendering a list a free workspace could read.
   * WHERE: The style picker.
   */
  styles: protectedProcedure({ requirePermission: permissions.PROJECTS_READ })
    .input(listMotionStylesSchema)
    .query(() => ({ styles: listMotionStyles() })),

  /**
   * SOURCE OF TRUTH KEYWORDS: motionStudio.designStyle, DESIGN_IS_A_MUTATION,
   *   REJECT_AND_REGENERATE
   *
   * WHAT:  A validated style from three answers, plus the sentence explaining
   *        it. Stored nowhere.
   *
   * WHY:   It THROWS on a style that could not be validated twice rather than
   *        returning refusals, which is the opposite of
   *        `quizzes.previewQuestion` and right for both. A preview's whole
   *        purpose is to show what a topic produces, refusals included; here
   *        the refusals are internal feedback the model already acted on, and
   *        a half-valid style handed to the screen would put an unreadable
   *        video one click away. The customer's recourse is the library, and
   *        the message says so.
   *
   *        `txTimeout` is raised for the same reason the quiz preview raises
   *        it: two model requests can take longer than the default ten
   *        seconds, and the repair attempt is the second one.
   * WHERE: The style picker's "design one for me".
   */
  designStyle: protectedProcedure({
    requirePermission: permissions.PROJECTS_READ,
    /* Up to two model requests — see REJECT_AND_REGENERATE. */
    txTimeout: 60_000,
  })
    .input(designMotionStyleSchema)
    .mutation(async ({ input }) => {
      try {
        const designed = await designMotionStyle({
          subject: input.subject,
          audience: input.audience,
          feeling: input.feeling,
        });
        return { style: designed.style, rationale: designed.rationale };
      } catch (error) {
        if (error instanceof LlmError) {
          console.warn(`[motionStudio.designStyle] ${error.detail}`);
          throw new TRPCError({
            /* The same code `scripts.generate` and `quizzes.previewQuestion`
             * use for a request that was fine and an answer that was not. */
            code: "UNPROCESSABLE_CONTENT",
            message: error.message,
          });
        }
        throw error;
      }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: motionStudio.design, THE_STRIP_READS_A_VIEW_NOT_THE_BLOB,
   *   A_RESOLVED_STYLE_NOT_AN_ID, A_PROJECT_WITH_NO_DESIGN_IS_NOT_AN_ERROR
   *
   * WHAT:  A project's storyboard as the beat strip shows it — every beat with
   *        its words, its seconds, its intent and its scene if one exists yet.
   *
   * WHY:   A_PROJECT_WITH_NO_DESIGN_IS_NOT_AN_ERROR. A motion project whose
   *        design stage has not run returns an EMPTY beat list and a resolved
   *        style, not a NOT_FOUND. The strip then renders its empty state,
   *        which is the correct screen for "generate this video first" — and
   *        the same response covers a stage that is half way through, because
   *        the storyboard is stored before any scene is designed.
   *
   *        THE_STRIP_READS_A_VIEW_NOT_THE_BLOB. The seconds and the text are
   *        computed here from the alignment, because neither is stored: the
   *        beat holds word INDICES so that a re-alignment moves the design
   *        with the audio. Sending the client the raw settings blob plus the
   *        whole transcript to do the same join would ship a transcript to
   *        label a dozen cards.
   * WHERE: The beat strip.
   */
  design: protectedProcedure({ requirePermission: permissions.PROJECTS_READ })
    .input(motionDesignSchema)
    .query(async ({ input }): Promise<MotionDesignView> => {
      const context = await readMotionBeatContext({
        organizationId: input.organizationId,
        projectId: input.projectId,
      });

      if (context === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This project is no longer available.",
        });
      }

      /* The aspect column is a String; an unrecognised value falls back to the
       * product's default shape, as it does in the pipeline. */
      const aspect = aspectRatioSchema.safeParse(context.aspect);
      const resolvedAspect = aspect.success ? aspect.data : "9:16";

      const beats: MotionBeatView[] = context.beats.map((stored) => {
        const beat: Beat = {
          index: stored.index,
          startWord: stored.startWord,
          endWord: stored.endWord,
          intent: toBeatIntent(stored.intent),
        };
        const span = beatSeconds(beat, context.words);

        return {
          index: beat.index,
          intent: beat.intent,
          text: context.words
            .slice(beat.startWord, beat.endWord + 1)
            .map((word) => word.w)
            .join(" "),
          startSeconds: span.start,
          durationSeconds: span.end - span.start,
          scene: stored.scene ?? null,
          source: stored.source ?? null,
          review: stored.review ?? null,
        };
      });

      return {
        /* Resolved here — see A_RESOLVED_STYLE_NOT_AN_ID. */
        style: getMotionStyle(context.styleId),
        aspect: resolvedAspect,
        safeZone: SAFE_ZONE_BY_ASPECT[resolvedAspect],
        beats,
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: motionStudio.redesignBeat, ONE_BEAT_IS_THE_UNIT,
   *   THE_OTHERS_ARE_BYTE_IDENTICAL, THE_RANGE_IS_NOT_AN_INPUT,
   *   RATE_LIMITED_NOT_METERED, A_STALE_RANGE_IS_REFUSED
   *
   * WHAT:  Designs one beat again and stores the result on that beat alone.
   *
   * WHY:   THE_RANGE_IS_NOT_AN_INPUT: the word range, the intent and the style
   *        come from what is stored, so the only thing a caller decides is
   *        WHICH beat. The reasoning is on `redesignBeatSchema`.
   *
   *        RATE_LIMITED_NOT_METERED. This spends a model request (up to two,
   *        with the repair) and deliberately does NOT increment
   *        `motionVideos` — a customer fixing one ugly beat has not made
   *        another video. The registry's `redesignBeat` rate limit is the
   *        right instrument for a human pressing a button, and it is enforced
   *        by the procedure factory from the PATH, so there is nothing to
   *        check here.
   *
   *        A_STALE_RANGE_IS_REFUSED. A beat whose word range no longer fits
   *        the alignment — a re-recorded line, a regenerated script — cannot
   *        be measured, and designing it against the wrong words would store
   *        a scene about a sentence the video no longer says. That is a
   *        PRECONDITION_FAILED naming the fix rather than a silent fallback,
   *        because the fix (regenerate) is the customer's to make.
   *
   *        It CANNOT fail for a design failure: `designBeat` falls back to a
   *        measured plain beat, and the response says `source: "fallback"` so
   *        the strip can show that the retry did not help. That is the same
   *        THE_PIPELINE_ALWAYS_FINISHES bias the workflow has, applied to a
   *        button: a customer who pressed redesign gets a different beat, or
   *        an honest label, never a spinner that ends in a toast.
   * WHERE: The beat strip's redesign button.
   */
  redesignBeat: protectedProcedure({
    requirePermission: permissions.PROJECTS_UPDATE,
    /* Up to two model requests — the same allowance designStyle takes. */
    txTimeout: 60_000,
  })
    .input(redesignBeatSchema)
    .mutation(async ({ input }) => {
      const context = await readMotionBeatContext({
        organizationId: input.organizationId,
        projectId: input.projectId,
      });

      if (context === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This project is no longer available.",
        });
      }

      const stored = context.beats.find(
        (beat) => beat.index === input.beatIndex,
      );
      if (stored === undefined) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That beat is not part of this video's storyboard.",
        });
      }

      /* A_STALE_RANGE_IS_REFUSED — the range has to still point at words. */
      const first = context.words[stored.startWord];
      const last = context.words[stored.endWord];
      if (first === undefined || last === undefined) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The narration has changed since this beat was designed. Generate the video again to rebuild its beats.",
        });
      }

      const aspect = aspectRatioSchema.safeParse(context.aspect);
      const resolvedAspect = aspect.success ? aspect.data : "9:16";

      const beat: Beat = {
        index: stored.index,
        startWord: stored.startWord,
        endWord: stored.endWord,
        intent: toBeatIntent(stored.intent),
      };
      const span = beatSeconds(beat, context.words);
      const durationSeconds = span.end - span.start;

      const style = getMotionStyle(context.styleId);
      const layout = {
        canvas: CANVAS_BY_ASPECT[resolvedAspect],
        safeZone: SAFE_ZONE_BY_ASPECT[resolvedAspect],
      };

      const outcome = await designBeat({
        beat,
        words: context.words,
        style,
        aspect: resolvedAspect,
        ctx: layout,
        durationSeconds,
      });

      /* RESOLVE_BEFORE_STORING, exactly as the design stage does: a word
       * anchor is meaningless to a renderer, which never sees the transcript. */
      const scene = resolveSceneAnchors({
        scene: outcome.scene,
        words: context.words,
        beatStart: span.start,
        beatDuration: durationSeconds,
      });

      const written = await replaceMotionBeat({
        organizationId: input.organizationId,
        projectId: input.projectId,
        beatIndex: beat.index,
        scene,
        source: outcome.source,
      });

      if (!written) {
        /* The storyboard changed under the request — a regeneration finishing
         * mid-redesign. Nothing was written, which is the right outcome. */
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This video's storyboard changed while the beat was being designed. Reload and try again.",
        });
      }

      const view: MotionBeatView = {
        index: beat.index,
        intent: beat.intent,
        text: context.words
          .slice(beat.startWord, beat.endWord + 1)
          .map((word) => word.w)
          .join(" "),
        startSeconds: span.start,
        durationSeconds,
        scene,
        source: outcome.source,
        /* The stored finding was about the PREVIOUS scene and this response
         * carries a new one, so it is dropped rather than copied forward. A
         * badge that outlived the picture it was about is worse than no badge.
         * The vision pass runs per generation, not per redesign — one still
         * and one vision request on a button press would quietly triple what
         * that button costs. */
        review: null,
      };

      return { beat: view, attempts: outcome.attempts };
    }),
});
