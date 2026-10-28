/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: writeQuizScript, resolveQuizQuestions,
 *   previewQuizQuestion, REJECT_AND_REGENERATE, ONE_SHAPE_TWO_INPUTS,
 *   MANUAL_IS_NOT_A_MODEL_CALL, THE_WRITER_RECORDS_WHAT_IT_DECIDED
 *
 * WHAT:  Turning a quiz request into a validated question set and the narration
 *        that reads it out.
 *
 * WHY:   ONE_SHAPE_TWO_INPUTS, and this file is where the two inputs become
 *        one. `resolveQuizQuestions` has exactly two arms and they converge
 *        after four lines: a topic goes to the model, a typed table goes
 *        straight through, and BOTH are then checked by the same
 *        `checkQuizSet`. Everything after that point — the narration plan, the
 *        blocks, the settings patch, the generator, the cards — receives an
 *        identical value and cannot tell which arm produced it. That is the
 *        phase's "manually entered questions render identically to generated
 *        ones", made structural.
 *
 *        MANUAL_IS_NOT_A_MODEL_CALL. The typed arm never reaches the LLM
 *        adapter, which is not an optimisation: a customer who typed ten
 *        questions must not be charged a model request to have them read back
 *        to them, and a model asked to "pass these through" would rewrite
 *        them. It IS validated, by the same rules, because a person is as
 *        capable of typing two identical options as a model is.
 *
 *        REJECT_AND_REGENERATE is the phase's step 2 and the third "done when"
 *        check: a set with two correct answers, a duplicate option or a
 *        duplicate question is "rejected and regenerated rather than saved".
 *        So a refused set is asked for ONCE more, with the refusals named
 *        (THE_REJECTION_IS_THE_FEEDBACK in ./quiz-prompt.ts), and a second
 *        refusal is a permanent failure.
 *
 *        Once, and the reason is the same one the LLM adapter gives for its own
 *        single retry (RETRY_ONCE_WITH_THE_ERROR): a second failure is almost
 *        always the model being asked the wrong question rather than having a
 *        bad moment, and every attempt is a paid request against a customer's
 *        credits. Three attempts would triple the cost of the case that was
 *        never going to work.
 *
 *        Note the two retries are at DIFFERENT levels and both are needed. The
 *        adapter retries output that fails the SCHEMA — malformed JSON, a
 *        missing field. This retries output that passes the schema and is not a
 *        quiz (THE_SCHEMA_IS_NOT_ENOUGH in src/lib/types/quiz.ts). Neither can
 *        do the other's job: the adapter cannot know what makes a question set
 *        unusable, and this cannot see a parse failure.
 *
 *        THE_WRITER_RECORDS_WHAT_IT_DECIDED. The resolved questions come back
 *        on the `WrittenScript`'s `settingsPatch`, because they are a DECISION
 *        the writer made that the generator needs later — and a writer cannot
 *        write to the database (SOURCE_IS_ALREADY_EXTRACTED: a writer is pure
 *        apart from the model call, which is what makes it testable against a
 *        fixture). The workflow persists the patch in the same transaction that
 *        saves the blocks and charges the credits, so a quiz can never exist
 *        with narration for questions nobody stored.
 *
 *        SERVER-ONLY, because it reaches the LLM adapter which holds the API
 *        key. The narration planning and the validation are both pure and live
 *        elsewhere (src/lib/quiz/, src/lib/types/quiz.ts), so the parts that
 *        can actually be wrong are testable with no key and no spend.
 * WHERE: SCRIPT_WRITERS['quiz'] in ./writers.ts, and
 *        `quizzes.previewQuestion` in src/trpc/routers/quizzes.ts.
 */

import "server-only";

import { LlmError, getLlmAdapter } from "@/lib/adapters/llm";
import { planQuizNarration } from "@/lib/quiz";
import {
  SCRIPT_WARN_SECONDS,
  estimateSpokenSeconds,
} from "@/lib/types/script";
import {
  checkQuizSet,
  quizDraftSchema,
  quizSettingsToJson,
  type QuizDifficulty,
  type QuizQuestion,
  type QuizRejection,
  type QuizRequest,
  type QuizSettings,
} from "@/lib/types/quiz";
import { quizRetryPrompt, quizSystemPrompt, quizUserPrompt } from "./quiz-prompt";
import type { WrittenScript } from "./writers";

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_SET_REFUSED_MESSAGE, REFUSAL_NAMES_THE_ACTION
 *
 * WHAT:  What a customer is told when two attempts both produced an unusable
 *        set.
 * WHY:   REFUSAL_NAMES_THE_ACTION. The reasons themselves are about individual
 *        questions and are useless to somebody who never saw them, so the
 *        sentence names the two things that actually help: narrow the topic, or
 *        type the questions. The per-question reasons go to the log, where an
 *        operator reads them.
 * WHERE: The `LlmError` thrown below, which the script workflow turns into a
 *        stage failure and a refund.
 */
const QUIZ_SET_REFUSED_MESSAGE =
  "We could not write a fair quiz on that topic — the wrong answers kept giving the right one away. Try a narrower topic, or type the questions yourself.";

/**
 * SOURCE OF TRUTH KEYWORDS: writeQuizScript, ONE_SHAPE_TWO_INPUTS,
 *   THE_WRITER_RECORDS_WHAT_IT_DECIDED
 *
 * WHAT:  A quiz request as a finished script, plus the question set to store.
 *
 * WHY:   Returns the SAME `WrittenScript` shape the other two writers return,
 *        so the workflow that holds, saves and charges does not branch on the
 *        format (ONE_WORKFLOW_MANY_WRITERS in ./writers.ts). The quiz's one
 *        addition is `settingsPatch` — see
 *        THE_WRITER_RECORDS_WHAT_IT_DECIDED in the file header.
 *
 *        The blocks come from `planQuizNarration`, not from the model. A model
 *        asked for narration as well as questions would be a second thing to
 *        validate and a second thing to get wrong, and there is nothing to
 *        decide: "Question three." followed by the question, then the answer,
 *        is the format. That is also what makes the narration RE-DERIVABLE by
 *        the generator (QUIZ_NARRATION_IS_PLANNED_ONCE), which is how a line
 *        is matched back to the card it belongs to.
 *
 *        `estimatedSeconds` deliberately counts only the SPOKEN words and not
 *        the countdowns, which is the same arithmetic every other format uses
 *        (`estimateSpokenSeconds`) and the same number the credit estimate and
 *        the stored blocks carry. The countdowns make the finished video longer
 *        than this figure — by `countdownSec` per question, exactly — and the
 *        wizard shows that total separately, because the thing a customer is
 *        warned about here is the length of the SCRIPT and the thing they want
 *        to know is the length of the VIDEO. Conflating them would make one of
 *        the two numbers wrong wherever it appeared.
 * WHERE: SCRIPT_WRITERS['quiz'].
 */
export async function writeQuizScript(input: {
  request: QuizRequest;
  /** The project's own name, used as the quiz title on a typed set. */
  fallbackTitle: string;
}): Promise<WrittenScript> {
  const resolved = await resolveQuizQuestions(input.request);

  const settings: QuizSettings = {
    ...(resolved.topic === null ? {} : { topic: resolved.topic }),
    questions: resolved.questions,
    countdownSec: input.request.countdownSec,
    answerType: input.request.answerType,
    difficulty: input.request.difficulty,
    ...(input.request.countdownAssetId === undefined
      ? {}
      : { countdownAssetId: input.request.countdownAssetId }),
  };

  const segments = planQuizNarration(settings);

  const blocks = segments.map((segment) => ({
    sectionType: segment.sectionType,
    narrationText: segment.narrationText,
    speakerTag: segment.speakerTag,
  }));

  const blockSeconds = blocks.map((block) =>
    estimateSpokenSeconds(block.narrationText),
  );
  const estimatedSeconds =
    Math.round(
      blockSeconds.reduce((total, seconds) => total + seconds, 0) * 100,
    ) / 100;

  const title =
    resolved.title.length > 0 ? resolved.title : input.fallbackTitle;

  return {
    title,
    blocks,
    blockSeconds,
    estimatedSeconds,
    overLimit: estimatedSeconds > SCRIPT_WARN_SECONDS,
    warnAtSeconds: SCRIPT_WARN_SECONDS,
    /**
     * THE_WRITER_RECORDS_WHAT_IT_DECIDED — the resolved set, under the key the
     * generator reads. Parsed back by `quizSettingsSchema` on every read, so
     * what is stored here is the only description of the quiz and nothing
     * downstream has to reconstruct it.
     */
    settingsPatch: { quiz: quizSettingsToJson(settings) },
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveQuizQuestions, ONE_SHAPE_TWO_INPUTS,
 *   REJECT_AND_REGENERATE, MANUAL_IS_NOT_A_MODEL_CALL
 *
 * WHAT:  A validated question set from either input path.
 *
 * WHY:   The two arms and the one check — see the file header. The MANUAL arm
 *        throws a PERMANENT error on a refusal, because a typed table that
 *        fails validation will fail identically on every retry and the person
 *        who typed it is the only one who can fix it. The TOPIC arm asks again
 *        once first.
 *
 *        `topic` comes back on the result rather than being read off the
 *        request by the caller, because only one arm has one and the caller
 *        would otherwise re-branch on `kind` to find out.
 * WHERE: `writeQuizScript`.
 */
async function resolveQuizQuestions(request: QuizRequest): Promise<{
  title: string;
  topic: string | null;
  questions: QuizQuestion[];
}> {
  if (request.source.kind === "manual") {
    /* MANUAL_IS_NOT_A_MODEL_CALL — no adapter, no spend, same validation. */
    const rejections = checkQuizSet(request.source.questions);
    if (rejections.length > 0) {
      throw refusedSet(rejections, "manual");
    }
    return {
      title: "",
      topic: null,
      questions: [...request.source.questions],
    };
  }

  const topic = request.source.value;
  const questionCount = request.source.questionCount;

  const first = await askForQuestions(
    quizUserPrompt({ topic, questionCount, difficulty: request.difficulty }),
  );
  const firstRejections = checkQuizSet(first.questions);
  if (firstRejections.length === 0) {
    return { title: first.title, topic, questions: first.questions };
  }

  /* REJECT_AND_REGENERATE — once, with the reasons named. */
  console.warn(
    `[script.quiz] First set refused: ${describe(firstRejections)}. Asking again.`,
  );

  const second = await askForQuestions(
    quizRetryPrompt({
      topic,
      questionCount,
      difficulty: request.difficulty,
      rejections: firstRejections,
    }),
  );
  const secondRejections = checkQuizSet(second.questions);
  if (secondRejections.length === 0) {
    return { title: second.title, topic, questions: second.questions };
  }

  throw refusedSet(secondRejections, "generated");
}

/**
 * SOURCE OF TRUTH KEYWORDS: previewQuizQuestion, PREVIEW_IS_ONE_QUESTION
 *
 * WHAT:  One question on a topic, written and validated, stored nowhere.
 *
 * WHY:   PREVIEW_IS_ONE_QUESTION is the phase's step 10: a customer should
 *        discover a bad distractor for the price of one small request rather
 *        than after paying for a whole generation. It is the SAME prompt, the
 *        SAME schema and the SAME `checkQuizSet` the real path uses, asked for
 *        one question — so what the preview shows is representative rather
 *        than a different code path that happens to look similar.
 *
 *        It does NOT retry. A refused preview is information the customer
 *        wanted — "this topic produces giveaway answers" is the answer to the
 *        question they asked — and spending a second request to hide it would
 *        make the preview both slower and less honest than the thing it
 *        previews.
 * WHERE: `quizzes.previewQuestion`.
 */
export async function previewQuizQuestion(input: {
  topic: string;
  difficulty: QuizDifficulty;
}): Promise<{
  question: QuizQuestion;
  rejections: QuizRejection[];
}> {
  const draft = await askForQuestions(
    quizUserPrompt({
      topic: input.topic,
      questionCount: 1,
      difficulty: input.difficulty,
    }),
  );

  const question = draft.questions[0];
  if (question === undefined) {
    /* The schema demands at least one, so this is unreachable — and an
     * assertion is banned, so the refusal is honest instead. */
    throw new LlmError(
      "No question came back for that topic. Try a different one.",
      { detail: "quiz preview returned an empty set", permanent: true },
    );
  }

  /* Shown WITH its refusals rather than hidden behind them: the whole point is
   * to let somebody look at what this topic produces. */
  return { question, rejections: checkQuizSet([question]) };
}

/**
 * SOURCE OF TRUTH KEYWORDS: askForQuestions, SCHEMA_IS_THE_CONTRACT
 *
 * WHAT:  One model request for a question set.
 * WHY:   The system prompt is the same on every call and takes no arguments
 *        (TOPIC_IS_STILL_UNTRUSTED), so only the user turn varies and this
 *        function takes only that. Keeping the system turn out of the parameter
 *        list means no caller here can pass a different one.
 * WHERE: Both arms of `resolveQuizQuestions`, and the preview.
 */
async function askForQuestions(user: string): Promise<{
  title: string;
  questions: QuizQuestion[];
}> {
  const llm = await getLlmAdapter();
  const draft = await llm.generate({
    /* Takes no arguments — see UNTRUSTED_TEXT_IS_NEVER_SYSTEM. */
    system: quizSystemPrompt(),
    user,
    schema: quizDraftSchema,
    purpose: "quiz.questions",
  });
  return { title: draft.title, questions: draft.questions };
}

/**
 * SOURCE OF TRUTH KEYWORDS: refusedSet, PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  The error for a set that cannot be used.
 * WHY:   An `LlmError` with `permanent: true`, which is what the script
 *        workflow already classifies: it marks the stage failed with this
 *        message, releases the hold and does not retry
 *        (NO_PATH_FORGETS_THE_REFUND). Inventing a new error class would mean
 *        teaching that workflow about the quiz format, which is the one thing
 *        ONE_WORKFLOW_MANY_WRITERS exists to prevent.
 *
 *        The customer-facing message is deliberately NOT the list of
 *        per-question reasons — see QUIZ_SET_REFUSED_MESSAGE. The reasons go in
 *        `detail`, which is what reaches the log.
 * WHERE: Both refusal paths in `resolveQuizQuestions`.
 */
function refusedSet(
  rejections: readonly QuizRejection[],
  source: "manual" | "generated",
): LlmError {
  const message =
    source === "manual"
      ? /* The person who typed it is the only one who can fix it, so the
         * message names the first problem rather than a generic sentence. */
        (rejections[0]?.message ??
        "That question set cannot be used. Check the questions and try again.")
      : QUIZ_SET_REFUSED_MESSAGE;

  return new LlmError(message, {
    detail: `quiz set refused (${source}): ${describe(rejections)}`,
    permanent: true,
  });
}

function describe(rejections: readonly QuizRejection[]): string {
  return rejections
    .map((rejection) => `q${rejection.questionIndex + 1}:${rejection.reason}`)
    .join(", ");
}
