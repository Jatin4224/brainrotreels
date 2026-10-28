/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: quizzesRouter, quizzes.previewQuestion,
 *   quizzes.start, PREVIEW_IS_ONE_QUESTION, REFUSE_BEFORE_PAYING,
 *   VALIDATE_IN_THE_REQUEST, ONE_WORKFLOW_MANY_WRITERS, A_FLAG_THAT_GATES_READS
 *
 * WHAT:  The two quiz procedures: see one question on a topic, then start a
 *        quiz from a topic or a typed table.
 *
 * WHY:   PREVIEW_IS_ONE_QUESTION is the phase's step 10 and the reason the
 *        preview exists as its own verb: "preview a single question before
 *        committing to a full generation, so a user discovers a bad distractor
 *        for free rather than after paying for the render". It is a MUTATION
 *        rather than a query, which is the one place this file departs from the
 *        Reddit router's shape, and deliberately — a model request is not
 *        idempotent and must not be re-fired by a cache revalidation, a window
 *        refocus or a retry. "Free" here means free of CREDITS, not free of
 *        cost: it spends a model request, which is why it carries the
 *        resource's own rate limit.
 *
 *        VALIDATE_IN_THE_REQUEST. A typed question table is checked by
 *        `checkQuizSet` HERE, in the mutation the customer is waiting on, and
 *        not only inside the writer. The rules are the same function either
 *        way (THE_SCHEMA_IS_NOT_ENOUGH in src/lib/types/quiz.ts) — what
 *        differs is where the answer lands: a refusal in the request arrives
 *        next to the row the person just typed, while the same refusal from
 *        inside the workflow is a failed stage on a progress screen a minute
 *        later. The writer keeps its own check, because the generated path has
 *        no request to validate in.
 *
 *        REFUSE_BEFORE_PAYING, as `scripts.generate` and `redditStories.start`
 *        both do: the credit balance is checked here, before the job is
 *        enqueued, so a workspace that cannot afford a generation is told
 *        immediately instead of watching a job fail. The HOLD is placed inside
 *        the workflow (HOLD_IN_THE_WORKFLOW), because a hold placed in a
 *        request that then times out strands the money with no run to release
 *        it.
 *
 *        ONE_WORKFLOW_MANY_WRITERS: `start` enqueues `script/requested` — the
 *        existing script workflow — exactly as the Reddit router does. There is
 *        no quiz workflow. The hold, the retry classification, the refund on
 *        every path and the one transaction that saves and charges are all
 *        Phase 06's, unchanged, and the question set reaches the generator
 *        through the writer's settings patch
 *        (THE_WRITER_RECORDS_WHAT_IT_DECIDED).
 *
 *        A_FLAG_THAT_GATES_READS: both procedures are gated by the `quizzes`
 *        flag automatically, because the resource declares one — so a `free`
 *        workspace is refused every verb, the preview included, server-side,
 *        with no check in either handler. That is the phase's seventh "done
 *        when" item and the reason neither handler asks about the plan.
 * WHERE: Mounted as `quizzes` in src/trpc/routers/_app.ts. The model call is
 *        src/lib/script/quiz.ts; the document build is
 *        src/lib/generators/quiz.ts.
 */

import { TRPCError } from "@trpc/server";

import { createStructuredError, createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import { ERROR_CODES } from "@/lib/errors";
import { enqueue } from "@/lib/adapters/jobs";
import { estimate } from "@/lib/credits";
import { LlmError } from "@/lib/adapters/llm";
import { getBalance } from "@/services/credits.service";
import { findProjectForOrganization } from "@/services/projects.service";
import { previewQuizQuestion } from "@/lib/script";
import { planQuizNarration } from "@/lib/quiz";
import { jsonObjectSchema } from "@/lib/types/json";
import {
  checkQuizSet,
  previewQuizQuestionSchema,
  quizRequestSchema,
  startQuizSchema,
} from "@/lib/types/quiz";
import {
  SCRIPT_WARN_SECONDS,
  estimateSpokenSeconds,
} from "@/lib/types/script";

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_TARGET_SECONDS, ONE_PRICE_TWO_SURFACES
 *
 * WHAT:  The length a quiz is priced and held against.
 *
 * WHY:   A quiz's length is not a choice the customer makes — it is the sum of
 *        the narration and the countdowns, which is not known until the
 *        questions exist. But the credit estimate, the refusal and the
 *        workflow's hold all need a number BEFORE the model is called
 *        (REFUSE_BEFORE_PAYING), and `estimate({ kind: 'script' })` takes
 *        seconds.
 *
 *        So the figure is the product's own ceiling for a short video, the same
 *        value the Reddit panel defaults to, and the commit re-estimates
 *        against it unchanged. That makes a quiz cost exactly what a
 *        sixty-second script costs, which is honest in the direction that
 *        matters: every quiz this product can produce is at or under a minute
 *        of narration, so nobody is charged for more than they could get.
 *
 *        It is NOT derived from the question count. A ten-question quiz and a
 *        three-question quiz would then be priced differently for the same
 *        single model request, which is a price that tracks the output rather
 *        than the cost.
 * WHERE: `start`'s refusal, and the `script/requested` event the workflow
 *        prices its hold from.
 */
const QUIZ_TARGET_SECONDS = 60;

export const quizzesRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: quizzes.previewQuestion, PREVIEW_IS_ONE_QUESTION
   *
   * WHAT:  One question on a topic, with any problems named, stored nowhere.
   *
   * WHY:   It returns the REFUSALS alongside the question rather than throwing
   *        on them, which is the opposite of what `start` does and is right
   *        for both. The whole purpose of a preview is to show what a topic
   *        produces — including "the correct answer is the only long option",
   *        which is the exact discovery the phase wants somebody to make for
   *        free. Throwing would hide the thing they asked to see.
   *
   *        It takes no `projectId` and writes nothing, so it works from the
   *        create screen before a project exists.
   * WHERE: The quiz input panel's "try a question" button.
   */
  previewQuestion: protectedProcedure({
    requirePermission: permissions.QUIZZES_READ,
    /* A model request, so the default ten seconds is tight. */
    txTimeout: 30_000,
  })
    .input(previewQuizQuestionSchema)
    .mutation(async ({ input }) => {
      try {
        const result = await previewQuizQuestion({
          topic: input.topic,
          difficulty: input.difficulty,
        });
        return {
          question: result.question,
          rejections: result.rejections,
        };
      } catch (error) {
        if (error instanceof LlmError) {
          console.warn(`[quizzes.previewQuestion] ${error.detail}`);
          throw new TRPCError({
            /* The same code `scripts.generate` uses for a source we reached
             * and cannot use: the request was fine, the answer was not. */
            code: "UNPROCESSABLE_CONTENT",
            message: error.message,
          });
        }
        throw error;
      }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: quizzes.start, VALIDATE_IN_THE_REQUEST,
   *   REFUSE_BEFORE_PAYING, ONE_WORKFLOW_MANY_WRITERS
   *
   * WHAT:  Records the quiz request on the project and queues the writing.
   *
   * WHY:   It is the quiz twin of `redditStories.start` and does the same four
   *        things in the same order, deliberately: refuse for free, validate
   *        what can be validated now, write the request to the project,
   *        enqueue. Keeping the shape identical is what lets the EXISTING
   *        script workflow serve a third format with no edit to its credit
   *        handling.
   *
   *        What it stores is the REQUEST, under `settings.script.quiz` — not a
   *        question set, because on the topic path there isn't one yet
   *        (THE_REQUEST_IS_NOT_THE_RESULT). The writer resolves it and records
   *        the result under `settings.quiz`, in the same transaction that saves
   *        the blocks and charges the credits.
   *
   *        `sourceText` is written as the human-readable form of the request
   *        because the pipeline's moderation stage classifies exactly that
   *        field (MODERATE_BEFORE_PAYING) — so a topic AND a typed table are
   *        both put in front of the safety check. A manual set that skipped
   *        moderation would be the one way to get unmoderated text into a
   *        generated video.
   *
   *        It does NOT accept a project of the wrong kind: the writer and the
   *        generator are both chosen from `Project.kind`, so a `voiceover`
   *        project handed a quiz would narrate the questions with no cards.
   *        The refusal is here rather than a surprise two stages later.
   * WHERE: The quiz input panel's start button.
   */
  start: protectedProcedure({
    requirePermission: permissions.QUIZZES_CREATE,
    audit: { action: "start" },
    /* A settings write and nothing else — but it is a large one for a
     * ten-question table, and the default ten seconds is tight on a cold
     * connection. */
    txTimeout: 30_000,
  })
    .input(startQuizSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await findProjectForOrganization(
        ctx.db,
        input.organizationId,
        input.projectId,
      );
      if (project === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      if (project.kind !== "quiz") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That project is not a quiz. Create a quiz project to use these questions.",
        });
      }

      /**
       * VALIDATE_IN_THE_REQUEST — the typed arm only. The generated arm has
       * nothing to check yet; its set is validated, and re-asked for once, by
       * the writer (REJECT_AND_REGENERATE).
       */
      if (input.source.kind === "manual") {
        const rejections = checkQuizSet(input.source.questions);
        const first = rejections[0];
        if (first !== undefined) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            /* Named by question number, because the panel attaches it to a
             * row and the number is how the customer counts them. */
            message: `Question ${first.questionIndex + 1}: ${first.message}`,
          });
        }
      }

      /* REFUSE_BEFORE_PAYING — before anything is written, so a workspace with
       * no balance is told now. The same estimator the hold and the commit
       * use (ONE_PRICE_TWO_SURFACES). */
      const cost = estimate({
        kind: "script",
        durationSeconds: QUIZ_TARGET_SECONDS,
      });
      const available = await getBalance(input.organizationId, ctx.db);
      if (available < cost.total) {
        throw createStructuredError(
          "FORBIDDEN",
          `Making this video costs ${cost.total} credits and this workspace has ${available}.`,
          {
            errorCode: ERROR_CODES.INSUFFICIENT_CREDITS,
            resource: "credits",
            required: cost.total,
            available,
            message: `Not enough credits. ${cost.total} needed, ${available} available.`,
          },
        );
      }

      const request = quizRequestSchema.parse({
        source: input.source,
        countdownSec: input.countdownSec,
        answerType: input.answerType,
        difficulty: input.difficulty,
        ...(input.countdownAssetId === undefined
          ? {}
          : { countdownAssetId: input.countdownAssetId }),
      });

      const sourceText = describeRequest(request);

      const existing = jsonObjectSchema.safeParse(project.settings);
      const bag = existing.success ? existing.data : {};

      await ctx.db.project.update({
        where: { id: project.id },
        data: {
          /* The topic, for the projects list and for an operator reading a
           * row. A typed table has no source to point at. */
          sourceRef:
            request.source.kind === "topic" ? request.source.value : null,
          settings: jsonObjectSchema.parse({
            ...bag,
            /* SETTINGS_ARE_MERGED — only the key this write owns. */
            script: {
              sourceKind: "text",
              sourceTitle:
                request.source.kind === "topic" ? request.source.value : null,
              truncated: false,
              targetSeconds: QUIZ_TARGET_SECONDS,
              /* A quiz has no tone: the host reads a question and an answer,
               * and there is nothing for a tone to steer. Stored because the
               * stored request schema the pipeline re-reads requires one. */
              tone: "casual",
              /* MODERATE_BEFORE_PAYING reads this field — see the handler's
               * note on why a typed table is written into it too. */
              sourceText,
              quiz: request,
            },
          }),
        },
      });

      /* The writing goes to the EXISTING script workflow, which resolves the
       * writer from the project's kind. Keyed on the project and the request's
       * shape, so a double-click produces one run while a genuine second
       * attempt with different questions produces another. */
      await enqueue({
        requestId: ctx.requestId,
        name: "script/requested",
        data: {
          projectId: project.id,
          organizationId: input.organizationId,
          targetSeconds: QUIZ_TARGET_SECONDS,
          tone: "casual",
        },
        id: `script-${project.id}-quiz-${sourceText.length}-${request.countdownSec}-${request.answerType}`,
      });

      return {
        queued: true,
        cost,
        /**
         * SOURCE OF TRUTH KEYWORDS: PROJECTED_LENGTH_INCLUDES_THE_COUNTDOWNS
         *
         * What the customer is shown next. The narration estimate and the
         * COUNTDOWNS are returned separately because they answer different
         * questions and conflating them would make one of the two numbers
         * wrong wherever it appeared: `narrationSeconds` is what the
         * over-60-seconds warning is about (it is the SCRIPT's length, the
         * same arithmetic every format uses), and `projectedSeconds` is how
         * long the VIDEO will be.
         *
         * Only knowable for a typed table — a topic has no questions yet, so
         * both come back null rather than as a guess at what a model will
         * write.
         */
        ...projectedLength(request),
      };
    }),
});

/**
 * SOURCE OF TRUTH KEYWORDS: describeRequest, MODERATE_BEFORE_PAYING,
 *   MANUAL_IS_MODERATED_TOO
 *
 * WHAT:  The request as plain text, for the moderation stage to classify.
 *
 * WHY:   MANUAL_IS_MODERATED_TOO. The pipeline's `moderate` step reads
 *        `settings.script.sourceText` and nothing else, so whatever is not in
 *        that field is not classified. A topic is one line and obviously
 *        belongs there; a typed question table is the case worth being
 *        deliberate about, because it is the one path where a customer writes
 *        the content themselves and could otherwise reach a generated video
 *        unchecked.
 *
 *        Questions and options are both included: an option is as capable of
 *        carrying something the safety check exists to catch as a question is,
 *        and the video reads both aloud. Explanations too, for the same reason.
 * WHERE: `start`, once, before the settings write.
 */
function describeRequest(
  request: ReturnType<typeof quizRequestSchema.parse>,
): string {
  if (request.source.kind === "topic") {
    return `Quiz topic: ${request.source.value}`;
  }

  return request.source.questions
    .map((question, index) => {
      const parts = [`Question ${index + 1}: ${question.question}`];
      parts.push(`Options: ${question.options.join("; ")}`);
      const explanation = question.explanation?.trim() ?? "";
      if (explanation.length > 0) parts.push(`Note: ${explanation}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

/**
 * SOURCE OF TRUTH KEYWORDS: projectedLength,
 *   PROJECTED_LENGTH_INCLUDES_THE_COUNTDOWNS
 *
 * WHAT:  How long the narration will be and how long the video will be.
 *
 * WHY:   It uses `planQuizNarration` — the same plan the writer turns into
 *        blocks and the generator maps lines against
 *        (QUIZ_NARRATION_IS_PLANNED_ONCE) — rather than estimating the question
 *        text directly. Estimating the raw questions would miss the "Question
 *        three." prefixes, the reveals and the intro, which together are a
 *        third of a short quiz's words, and the number would then be visibly
 *        lower than what the script editor shows a minute later.
 *
 *        Returns nulls for a topic rather than a guess: the questions do not
 *        exist yet, and a projected length that turned out wrong is worse than
 *        no projection, because the customer would have planned around it.
 * WHERE: `start`'s return value, read by the panel.
 */
function projectedLength(
  request: ReturnType<typeof quizRequestSchema.parse>,
): {
  narrationSeconds: number | null;
  projectedSeconds: number | null;
  overLimit: boolean;
  warnAtSeconds: number;
} {
  if (request.source.kind === "topic") {
    return {
      narrationSeconds: null,
      projectedSeconds: null,
      overLimit: false,
      warnAtSeconds: SCRIPT_WARN_SECONDS,
    };
  }

  const segments = planQuizNarration({
    questions: request.source.questions,
    countdownSec: request.countdownSec,
  });

  const narrationSeconds =
    Math.round(
      segments.reduce(
        (total, segment) => total + estimateSpokenSeconds(segment.narrationText),
        0,
      ) * 100,
    ) / 100;

  const beats = segments.reduce(
    (total, segment) => total + segment.leadSilenceSec,
    0,
  );

  return {
    narrationSeconds,
    projectedSeconds: Math.round((narrationSeconds + beats) * 100) / 100,
    /* The warning is about the SCRIPT, as it is for every other format. */
    overLimit: narrationSeconds > SCRIPT_WARN_SECONDS,
    warnAtSeconds: SCRIPT_WARN_SECONDS,
  };
}
