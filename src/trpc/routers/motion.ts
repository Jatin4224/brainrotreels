/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: motionRouter, motionStudio.styles, motionStudio.designStyle,
 *   GATE_IS_THE_WHOLE_ROUTER, CODE_VALIDATES_NOT_THE_EYE, DESIGN_IS_A_MUTATION,
 *   NOTHING_IS_STORED_YET
 *
 * WHAT:  The two motion studio procedures: list the style library, and design a
 *        style from three answers.
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
 *        NOTHING_IS_STORED_YET. Neither procedure writes, so neither takes a
 *        `projectId`. A designed style is handed back and kept in the screen's
 *        state until somebody applies it — and APPLYING is 16d's job, because
 *        the thing it writes to (`style.motionStyleId` on a motion document,
 *        `Project.settings` for the storyboard) does not exist on any project
 *        until the designer can produce one. Shipping an apply mutation now
 *        would mean shipping a verb that writes a field no renderer reads.
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
import { listMotionStyles } from "@/lib/motion-styles";
import { permissions } from "@/lib/permissions";
import { designMotionStyle } from "@/lib/script";
import {
  designMotionStyleSchema,
  listMotionStylesSchema,
} from "@/lib/types/motion-style";

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
});
