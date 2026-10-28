/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: quizQuestionSchema, QuizQuestion, quizSettingsSchema,
 *   QuizSettings, quizDraftSchema, QuizDraft, QUIZ_SPEAKER_TAG,
 *   QUIZ_REJECTION_COPY, quizRejectionMessage, checkQuizSet, QuizRejection,
 *   startQuizSchema, previewQuizQuestionSchema, QUIZ_COUNTDOWN_SECONDS,
 *   ONE_SHAPE_TWO_INPUTS, THE_SCHEMA_IS_NOT_ENOUGH, LENGTH_IS_THE_LLM_TELL,
 *   PHONETICS_ARE_SPOKEN_NOT_SHOWN
 *
 * WHAT:  The vocabulary of a quiz — one question, a whole set, the shape a
 *        MODEL must return, the reasons a set is refused, and the input schema
 *        of every `quizzes.*` procedure.
 *
 * WHY:   ONE_SHAPE_TWO_INPUTS is the phase's step 1 and the reason this file
 *        exists before anything that uses it. A topic goes to a model and a
 *        typed question table goes straight through, and from step 3 onward
 *        NOTHING can tell them apart — because both arms are parsed by
 *        `quizQuestionSchema` and both are checked by `checkQuizSet`. That is
 *        what makes the phase's "manually entered questions render identically
 *        to generated ones" structural rather than a thing somebody tested
 *        once: there is no second path for a hand-written set to travel down.
 *
 *        THE_SCHEMA_IS_NOT_ENOUGH, which is why `checkQuizSet` exists beside
 *        the schema rather than inside it. Zod can say "`correctIndex` is a
 *        non-negative integer"; it cannot say "that index is inside THIS
 *        question's options", "no two questions in this set are the same", or
 *        "the correct answer is suspiciously the only long option". Those are
 *        CROSS-FIELD and CROSS-QUESTION rules, and each one is a real video
 *        that would otherwise have been generated and paid for:
 *
 *          - an index past the end of `options` draws a reveal highlighting
 *            nothing, which is a quiz with no answer;
 *          - two identical options make a question with two correct answers
 *            or none, depending on which one the viewer picks;
 *          - the same question twice is a ten-question video that asks eight
 *            things.
 *
 *        It returns a LIST of refusals rather than throwing, because the
 *        generated path RE-ASKS the model with the reasons attached (see
 *        src/lib/script/quiz.ts) and the manual path shows them next to the
 *        offending row. A thrown error serves neither.
 *
 *        LENGTH_IS_THE_LLM_TELL is the one rule here that is about model
 *        behaviour rather than about correctness, and the phase names it: a
 *        model asked for three distractors writes the real answer carefully and
 *        the wrong ones carelessly, so the correct option ends up visibly
 *        longer than every other. A viewer picks it without knowing the topic,
 *        which makes the video worthless as a quiz while being perfectly valid
 *        as data. It is checked with BOTH a ratio and an absolute gap, because
 *        a ratio alone refuses "Jupiter" against "Mars" — four characters
 *        against seven is a 1.75x ratio and an entirely fair question.
 *
 *        PHONETICS_ARE_SPOKEN_NOT_SHOWN. `phonetics` maps a term to how it
 *        should be SAID, and it is applied only to the narration text — the
 *        card goes on drawing `question` and `options` exactly as written. So
 *        "SQL" is read as "sequel" and still reads as "SQL" on screen, which
 *        is the only arrangement that is right on both channels. The TTS seam
 *        takes no SSML by design (see the header of
 *        src/lib/adapters/tts/types.ts — "no streaming, no SSML, no voice
 *        management"), and respelling the spoken copy achieves what the phase
 *        asks for without widening that contract for one format.
 * WHERE: src/lib/quiz/, src/lib/script/quiz.ts, src/lib/generators/quiz.ts,
 *        src/trpc/routers/quizzes.ts and the quiz input panel. Re-exported
 *        from src/lib/types.
 */

import { z } from "zod";

import type { JsonObject } from "./json";

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_QUESTION_MAX_CHARS, QUIZ_OPTION_MAX_CHARS,
 *   QUIZ_MIN_OPTIONS, QUIZ_MAX_OPTIONS, QUIZ_MAX_QUESTIONS,
 *   CAPS_ARE_WHAT_FITS_THE_CARD
 *
 * WHAT:  The bounds of a question.
 * WHY:   CAPS_ARE_WHAT_FITS_THE_CARD — these are not arbitrary database
 *        hygiene. 200 characters is roughly what the smallest font band on
 *        `QuestionCard` can set inside the safe zone at 1080x1920, and 80 is
 *        what an option can hold on one or two lines beside three others. A
 *        longer value is not stored and then truncated at draw time; it is
 *        refused at the boundary, where the person who typed it is still
 *        looking at it.
 *
 *        The option count is 2 to 4 because the card lays out at most four and
 *        a two-option question is a true-or-false, which is a legitimate quiz
 *        and needs no second layout.
 * WHERE: `quizQuestionSchema`, and the card's font bands.
 */
export const QUIZ_QUESTION_MAX_CHARS = 200;
export const QUIZ_OPTION_MAX_CHARS = 80;
export const QUIZ_EXPLANATION_MAX_CHARS = 200;
export const QUIZ_MIN_OPTIONS = 2;
export const QUIZ_MAX_OPTIONS = 4;
export const QUIZ_MIN_QUESTIONS = 1;
export const QUIZ_MAX_QUESTIONS = 10;
export const QUIZ_TOPIC_MAX_CHARS = 200;

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_PHONETIC_MAX_ENTRIES, QUIZ_PHONETIC_MAX_CHARS
 *
 * How many pronunciation overrides one question may carry, and how long each
 * side may be. Bounded for the reason every record in this codebase is: an
 * unbounded map on a jsonb column is an unbounded write per request, and the
 * replacement is applied per term per line, so the cost is linear in this
 * number.
 */
export const QUIZ_PHONETIC_MAX_ENTRIES = 12;
export const QUIZ_PHONETIC_MAX_CHARS = 60;

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_COUNTDOWN_SECONDS, COUNTDOWN_IS_A_CHOICE
 *
 * WHAT:  How long the thinking beat lasts, and the bounds a customer may pick
 *        inside.
 * WHY:   COUNTDOWN_IS_A_CHOICE — it is the one timing decision a quiz author
 *        genuinely has an opinion about, so it is configurable rather than a
 *        constant. The bounds are the product's opinion: below two seconds
 *        nobody can read four options, and above ten the viewer has scrolled.
 *        Five is the default because it is the beat these videos actually use.
 * WHERE: `quizSettingsSchema`, the wizard's timer field, and the gap the
 *        generator leaves before each reveal.
 */
export const QUIZ_COUNTDOWN_MIN_SECONDS = 2;
export const QUIZ_COUNTDOWN_MAX_SECONDS = 10;
export const QUIZ_COUNTDOWN_DEFAULT_SECONDS = 5;

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_SPEAKER_TAG, ONE_VOICE_IS_THE_HOST
 *
 * WHAT:  Who narrates a quiz.
 * WHY:   ONE_VOICE_IS_THE_HOST. A Reddit story has three roles because the
 *        thread has three kinds of participant (TAGS_ARE_ROLES_NOT_USERNAMES in
 *        ./reddit); a quiz has one presenter who asks and then answers. A
 *        second tag for the reveal was the alternative and it is worse in two
 *        ways: it would demand a second voice assignment before the project
 *        could generate (`validateAssignments` refuses an uncast speaker), and
 *        a different voice reading the answer sounds like a different show.
 *
 *        It is `host` rather than `narrator` deliberately, even though
 *        `narrator` is `splitScriptIntoLines`'s default: the tag becomes a
 *        `Speaker` row the customer casts, and "Host" is what the role is
 *        called on a quiz. Writing it out means the cast screen reads the same
 *        way the video does.
 * WHERE: Every block the quiz writer emits; the Speaker row the pipeline
 *        upserts.
 */
export const QUIZ_SPEAKER_TAG = "host";

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_ANSWER_TYPES, quizAnswerTypeSchema,
 *   QuizAnswerType, ANSWER_TYPE_IS_PRESENTATION
 *
 * WHAT:  Whether the options are shown.
 * WHY:   ANSWER_TYPE_IS_PRESENTATION, and this is the decision that keeps the
 *        contract honest. A set is AUTHORED the same way either way — every
 *        question carries its options and its `correctIndex`, because that is
 *        what a reveal highlights and what `checkQuizSet` validates against —
 *        and the answer type decides only whether `QuestionCard` draws the
 *        option list. So switching a finished quiz from multiple choice to open
 *        is a settings change and a re-render, not a re-authoring.
 *
 *        The alternative — an `open` question with no options at all — would
 *        make `correctIndex` meaningless, split the schema into two variants,
 *        and leave the reveal with nothing to point at.
 * WHERE: `quizSettingsSchema`; read by the generator and baked onto the card.
 */
export const QUIZ_ANSWER_TYPES = ["multiple-choice", "open"] as const;

export const quizAnswerTypeSchema = z.enum(QUIZ_ANSWER_TYPES);

export type QuizAnswerType = z.infer<typeof quizAnswerTypeSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_DIFFICULTIES, quizDifficultySchema,
 *   QuizDifficulty
 *
 * WHAT:  How hard to make the questions.
 * WHY:   It steers the PROMPT and nothing else — there is no scoring, no
 *        weighting and no filtering downstream, so it is stored on the settings
 *        and read by the writer. A manual set carries it too, because the
 *        wizard's "add five more about this" has to ask the model for something
 *        consistent with what is already in the table.
 * WHERE: `quizSettingsSchema`; the quiz prompt's user turn.
 */
export const QUIZ_DIFFICULTIES = ["easy", "medium", "hard"] as const;

export const quizDifficultySchema = z.enum(QUIZ_DIFFICULTIES);

export type QuizDifficulty = z.infer<typeof quizDifficultySchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: quizQuestionSchema, QuizQuestion, ONE_SHAPE_TWO_INPUTS
 *
 * WHAT:  One question, however it was authored.
 *
 * WHY:   The phase's own contract, kept field for field. `correctIndex` is an
 *        INDEX rather than a `correct: boolean` on each option, which is what
 *        makes "exactly one correct answer" true by construction — a flag per
 *        option permits zero and permits four, and both ship. The index is
 *        checked against `options.length` by `checkQuizSet`, which is the one
 *        thing a schema cannot do from inside a field.
 *
 *        `.strict()` so a model that invents a field fails the parse rather
 *        than having it silently dropped — a `difficulty` or `category` the
 *        model decided to add is a signal the prompt and the schema have
 *        drifted, and the adapter's one retry is exactly the right response.
 *
 *        Strings are TRIMMED here rather than at the callsites. Leading
 *        whitespace is invisible on screen and in a diff but makes two
 *        otherwise-identical options distinct, which is how a duplicate gets
 *        past a duplicate check.
 * WHERE: Both input arms, the model's output, the settings, and the card.
 */
export const quizQuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(QUIZ_QUESTION_MAX_CHARS),
    options: z
      .array(z.string().trim().min(1).max(QUIZ_OPTION_MAX_CHARS))
      .min(QUIZ_MIN_OPTIONS)
      .max(QUIZ_MAX_OPTIONS),
    correctIndex: z.number().int().min(0),
    explanation: z.string().trim().max(QUIZ_EXPLANATION_MAX_CHARS).optional(),
    /**
     * PHONETICS_ARE_SPOKEN_NOT_SHOWN — term to spoken form, applied to the
     * narration only. Keyed by the term AS WRITTEN on the card, so the
     * replacement can be looked up without a second normalisation step.
     */
    phonetics: z
      .record(
        z.string().trim().min(1).max(QUIZ_PHONETIC_MAX_CHARS),
        z.string().trim().min(1).max(QUIZ_PHONETIC_MAX_CHARS),
      )
      .refine(
        (value) => Object.keys(value).length <= QUIZ_PHONETIC_MAX_ENTRIES,
        `At most ${QUIZ_PHONETIC_MAX_ENTRIES} pronunciation overrides per question.`,
      )
      .optional(),
  })
  .strict();

export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: quizSettingsSchema, QuizSettings,
 *   QUIZ_SETTINGS_LIVE_ON_THE_PROJECT
 *
 * WHAT:  A whole quiz, as it is stored on `Project.settings.quiz`.
 *
 * WHY:   QUIZ_SETTINGS_LIVE_ON_THE_PROJECT, which is the phase's "Data: None"
 *        turned into a decision. Questions are NOT an entity with a lifecycle
 *        of their own: they are authored once, baked into a scene track, and
 *        edited thereafter through the timeline editor like any other item. A
 *        `QuizQuestion` table would be a second source of truth for something
 *        the document already holds, and the first edit in the editor would
 *        make the two disagree with no way to tell which was meant.
 *
 *        `topic` is kept alongside the questions although the questions are
 *        what gets rendered: the intro card names the topic, and "ask for five
 *        more like these" needs to know what the quiz was about. Optional,
 *        because a hand-typed table has no topic unless somebody wrote one.
 *
 *        Parsed on every read, never trusted — it is one key of a shared jsonb
 *        column that an older release may have written.
 * WHERE: Written by `quizzes.start` and by the quiz writer's settings patch;
 *        read by the generator and the wizard.
 */
export const quizSettingsSchema = z
  .object({
    topic: z.string().trim().max(QUIZ_TOPIC_MAX_CHARS).optional(),
    questions: z
      .array(quizQuestionSchema)
      .min(QUIZ_MIN_QUESTIONS)
      .max(QUIZ_MAX_QUESTIONS),
    countdownSec: z
      .number()
      .int()
      .min(QUIZ_COUNTDOWN_MIN_SECONDS)
      .max(QUIZ_COUNTDOWN_MAX_SECONDS),
    answerType: quizAnswerTypeSchema,
    difficulty: quizDifficultySchema,
    /**
     * SOURCE OF TRUTH KEYWORDS: countdownAssetId, COUNTDOWN_SFX_IS_OPTIONAL
     *
     * The `sfx` asset that ticks under the thinking beat, if the workspace
     * picked one. Absent means SILENCE under the countdown, which is a
     * complete video and not a missing choice — exactly the argument
     * MUSIC_IS_OPTIONAL makes for the music bed, and for the same reason: the
     * Phase 11 library ships empty until the licence position is settled, so
     * absent has to be the working default rather than the broken one.
     *
     * It is an Asset id and not a library key, so the only way one gets here
     * is a row the workspace can actually read.
     */
    countdownAssetId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type QuizSettings = z.infer<typeof quizSettingsSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: quizDraftSchema, QuizDraft, MODEL_OUTPUT_SCHEMA
 *
 * WHAT:  What a model returns when it writes a quiz.
 *
 * WHY:   MODEL_OUTPUT_SCHEMA, the same argument `scriptDraftSchema` and
 *        `redditDraftSchema` make: the model is asked for the CONTENT and
 *        nothing else. No countdown length (the customer chose it), no answer
 *        type (likewise), no ids and no positions — order is the array's. A
 *        model allowed to return a `countdownSec` would be a model that can
 *        overrule the customer's own setting, and the bug would look like a
 *        timer that ignores the slider.
 *
 *        It reuses `quizQuestionSchema` rather than declaring a looser twin.
 *        That is deliberate and is the strongest form of ONE_SHAPE_TWO_INPUTS:
 *        a generated question is constrained by exactly the bounds a typed one
 *        is, so there is no length a model can return that a person could not
 *        have typed. `title` is asked for because a quiz needs a name on the
 *        intro card and the topic alone is rarely it.
 * WHERE: Passed as `schema` to the LLM adapter by src/lib/script/quiz.ts.
 */
export const quizDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(QUIZ_QUESTION_MAX_CHARS),
    questions: z
      .array(quizQuestionSchema)
      .min(QUIZ_MIN_QUESTIONS)
      .max(QUIZ_MAX_QUESTIONS),
  })
  .strict();

export type QuizDraft = z.infer<typeof quizDraftSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_REJECTION_REASONS, QuizRejectionReason,
 *   QuizRejection, QUIZ_REJECTION_COPY, quizRejectionMessage,
 *   REJECTED_IS_NOT_BROKEN
 *
 * WHAT:  The five ways a question set is unusable, and what to say about each.
 *
 * WHY:   REJECTED_IS_NOT_BROKEN. Every one of these is a set that PARSES — the
 *        types are all correct and the data is all present — and is still not a
 *        quiz. That is why they are named individually rather than collapsed
 *        into "invalid question set": on the generated path the reason is fed
 *        back to the model as the thing to fix (which is the only feedback that
 *        makes a second attempt better than a coin flip), and on the manual
 *        path it is shown against the row the person is looking at.
 *
 *        Written as a full `Record` over the union, so adding a rule is a
 *        compile error here rather than a refusal that falls through to a
 *        generic sentence.
 *
 *        The copy addresses the AUTHOR, because both readers are authoring:
 *        the person typing a table, and the model being asked again.
 * WHERE: `checkQuizSet`'s results; the quiz router's refusals; the retry turn
 *        in src/lib/script/quiz.ts; the wizard's per-row errors.
 */
export const QUIZ_REJECTION_REASONS = [
  "correct_index_out_of_range",
  "duplicate_option",
  "duplicate_question",
  "length_tell",
  "empty_set",
] as const;

export const quizRejectionReasonSchema = z.enum(QUIZ_REJECTION_REASONS);

export type QuizRejectionReason = z.infer<typeof quizRejectionReasonSchema>;

export const QUIZ_REJECTION_COPY: Readonly<Record<QuizRejectionReason, string>> =
  {
    correct_index_out_of_range:
      "The correct answer points at an option that is not in the list. Pick one of the options shown.",
    duplicate_option:
      "Two of the options are the same, so the question has no single right answer. Make every option different.",
    duplicate_question:
      "This question already appears earlier in the quiz. Replace it with a different one.",
    length_tell:
      "The correct answer is much longer than every wrong one, so a viewer can pick it without knowing the subject. Make the wrong answers as specific and as long as the right one.",
    empty_set: "A quiz needs at least one question.",
  };

export function quizRejectionMessage(reason: QuizRejectionReason): string {
  return QUIZ_REJECTION_COPY[reason];
}

/**
 * SOURCE OF TRUTH KEYWORDS: QuizRejection
 *
 * WHAT:  One refusal, and which question earned it.
 * WHY:   `questionIndex` is on the refusal rather than the caller keeping track,
 *        because both consumers need it: the wizard attaches the message to a
 *        row, and the retry turn tells the model which question to fix. `-1`
 *        is deliberately not used for a set-wide problem — `empty_set` carries
 *        index 0, and there is no question there to confuse it with.
 * WHERE: Returned by `checkQuizSet`.
 */
export interface QuizRejection {
  reason: QuizRejectionReason;
  questionIndex: number;
  /** The already-written sentence for this reason. */
  message: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_LENGTH_TELL_RATIO, QUIZ_LENGTH_TELL_MIN_GAP,
 *   LENGTH_IS_THE_LLM_TELL
 *
 * WHAT:  When the correct answer is suspiciously the longest option.
 *
 * WHY:   LENGTH_IS_THE_LLM_TELL — see the file header for what the rule is
 *        catching. BOTH conditions have to hold, and the second one is what
 *        makes the rule usable rather than merely principled:
 *
 *          - the RATIO catches "a full clause against three single words",
 *            which is the shape the tell actually takes;
 *          - the ABSOLUTE GAP stops the ratio refusing short answers, where it
 *            fires constantly and is always wrong. "Jupiter" against "Mars" is
 *            1.75x and a perfectly fair question; the gap is three characters,
 *            and nobody picks an answer because it has three more letters.
 *
 *        Measured against the LONGEST distractor rather than the mean, because
 *        the mean is dragged down by one short option and would refuse a set
 *        with three plausible distractors and one throwaway.
 *
 *        Tuned to refuse little and catch the obvious. A tighter rule rejects
 *        legitimate sets, and every rejection on the generated path costs a
 *        second paid model request.
 * WHERE: `checkQuizSet`.
 */
export const QUIZ_LENGTH_TELL_RATIO = 1.8;
export const QUIZ_LENGTH_TELL_MIN_GAP = 12;

/**
 * SOURCE OF TRUTH KEYWORDS: checkQuizSet, THE_SCHEMA_IS_NOT_ENOUGH,
 *   REJECTED_IS_NOT_BROKEN
 *
 * WHAT:  Every reason this set of questions is not a quiz, or an empty list.
 *
 * WHY:   PURE, and that is the whole point of it being here rather than in a
 *        router: the same function checks the model's answer inside a workflow,
 *        the typed table inside a mutation, and the single-question preview —
 *        so a set that one surface accepts cannot be one another refuses. Three
 *        implementations of "no duplicate options" is three thresholds.
 *
 *        It takes the PARSED questions, so it never has to re-check anything
 *        the schema already guarantees. Everything below is genuinely
 *        cross-field or cross-question.
 *
 *        Comparison is case-insensitive and whitespace-collapsed, because
 *        "Pacific" and "pacific  " are the same answer to everyone except a
 *        string equality check — and a duplicate that slips through is a
 *        question with two right answers.
 * WHERE: src/lib/script/quiz.ts (the generated path and its one retry),
 *        src/trpc/routers/quizzes.ts (the manual path and the preview).
 */
export function checkQuizSet(
  questions: readonly QuizQuestion[],
): QuizRejection[] {
  const rejections: QuizRejection[] = [];
  const reject = (reason: QuizRejectionReason, questionIndex: number): void => {
    rejections.push({
      reason,
      questionIndex,
      message: quizRejectionMessage(reason),
    });
  };

  if (questions.length === 0) {
    reject("empty_set", 0);
    return rejections;
  }

  /* Normalised question text to the index that first used it, so the SECOND
   * occurrence is the one reported — the first one is not the mistake. */
  const seenQuestions = new Map<string, number>();

  for (const [index, question] of questions.entries()) {
    /* The index is the only thing standing between a reveal and highlighting
     * nothing, and it is the one rule the schema structurally cannot express:
     * the bound is a sibling field's length. */
    if (question.correctIndex >= question.options.length) {
      reject("correct_index_out_of_range", index);
    }

    const normalisedOptions = question.options.map(normaliseForComparison);
    if (new Set(normalisedOptions).size !== normalisedOptions.length) {
      reject("duplicate_option", index);
    }

    const key = normaliseForComparison(question.question);
    if (seenQuestions.has(key)) {
      reject("duplicate_question", index);
    } else {
      seenQuestions.set(key, index);
    }

    if (hasLengthTell(question)) {
      reject("length_tell", index);
    }
  }

  return rejections;
}

/**
 * SOURCE OF TRUTH KEYWORDS: hasLengthTell, LENGTH_IS_THE_LLM_TELL
 *
 * WHAT:  Whether the correct answer gives itself away by being much the
 *        longest.
 * WHY:   Skips a question whose `correctIndex` is out of range rather than
 *        guessing at which option was meant — that question is already being
 *        refused for a more specific reason, and a second refusal on the same
 *        row would send the author chasing the wrong fix.
 * WHERE: `checkQuizSet`.
 */
function hasLengthTell(question: QuizQuestion): boolean {
  const correct = question.options[question.correctIndex];
  if (correct === undefined) return false;

  let longestDistractor = 0;
  for (const [index, option] of question.options.entries()) {
    if (index === question.correctIndex) continue;
    longestDistractor = Math.max(longestDistractor, option.trim().length);
  }
  if (longestDistractor === 0) return false;

  const correctLength = correct.trim().length;
  return (
    correctLength >= longestDistractor * QUIZ_LENGTH_TELL_RATIO &&
    correctLength - longestDistractor >= QUIZ_LENGTH_TELL_MIN_GAP
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: normaliseForComparison, DUPLICATES_ARE_NOT_BYTES
 *
 * WHAT:  The form two strings are compared in when asking "are these the same
 *        answer".
 * WHY:   DUPLICATES_ARE_NOT_BYTES. Case, inner whitespace and trailing
 *        punctuation are invisible to a viewer, so two options differing only
 *        in those are the same option on screen — and a duplicate check on raw
 *        bytes passes a question with two right answers. Used for both the
 *        option check and the question check so the two cannot drift.
 * WHERE: `checkQuizSet`.
 */
function normaliseForComparison(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.?!]+$/, "");
}

/**
 * SOURCE OF TRUTH KEYWORDS: quizSourceSchema, QuizSource, ONE_SHAPE_TWO_INPUTS
 *
 * WHAT:  Where a question set comes from: a topic for the model, or a table
 *        somebody typed.
 *
 * WHY:   A DISCRIMINATED UNION rather than two optional fields, exactly as
 *        `scriptSourceSchema` and `redditSourceSchema` are, and for the
 *        identical reason: "a topic" and "a list of questions" are validated
 *        completely differently, and one object with both optional compiles
 *        happily with neither set. The union makes "which input path is this"
 *        a fact in the type system rather than a runtime guess, which is what
 *        lets the router branch once and everything after it branch never.
 * WHERE: `startQuizSchema`.
 */
export const quizSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("topic"),
    value: z.string().trim().min(3).max(QUIZ_TOPIC_MAX_CHARS),
    /* How many to ask for. Only meaningful for the model: a typed table has
     * exactly as many questions as it has rows. */
    questionCount: z
      .number()
      .int()
      .min(QUIZ_MIN_QUESTIONS)
      .max(QUIZ_MAX_QUESTIONS),
  }),
  z.object({
    kind: z.literal("manual"),
    questions: z
      .array(quizQuestionSchema)
      .min(QUIZ_MIN_QUESTIONS)
      .max(QUIZ_MAX_QUESTIONS),
  }),
]);

export type QuizSource = z.infer<typeof quizSourceSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: startQuizSchema, StartQuizValues,
 *   previewQuizQuestionSchema, PREVIEW_IS_ONE_QUESTION
 *
 * WHAT:  The input contract of the two `quizzes.*` procedures.
 *
 * WHY:   PREVIEW_IS_ONE_QUESTION is the phase's step 10, and the shape it
 *        takes is the point: the preview asks for ONE question on a topic, not
 *        a sample of the whole set. A customer discovering a bad distractor
 *        should cost one small model request, not a full generation they then
 *        throw away — and one question is enough to see whether the model
 *        understands the topic at the difficulty asked for.
 *
 *        It carries no `projectId`, because it writes nothing and belongs to
 *        no project: it is a question about a topic. That also means it works
 *        on the create screen, before a project exists.
 *
 *        `countdownSec`, `answerType` and `difficulty` are on `start` rather
 *        than defaulted server-side, because all three are visible choices in
 *        the wizard and a default applied in the handler is a default the
 *        customer cannot see.
 * WHERE: src/trpc/routers/quizzes.ts and the quiz input panel.
 */
export const previewQuizQuestionSchema = z.object({
  organizationId: z.string().min(1),
  topic: z.string().trim().min(3).max(QUIZ_TOPIC_MAX_CHARS),
  difficulty: quizDifficultySchema,
});

export type PreviewQuizQuestionValues = z.infer<
  typeof previewQuizQuestionSchema
>;

export const startQuizSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  source: quizSourceSchema,
  countdownSec: z
    .number()
    .int()
    .min(QUIZ_COUNTDOWN_MIN_SECONDS)
    .max(QUIZ_COUNTDOWN_MAX_SECONDS),
  answerType: quizAnswerTypeSchema,
  difficulty: quizDifficultySchema,
  countdownAssetId: z.string().trim().min(1).max(120).optional(),
});

export type StartQuizValues = z.infer<typeof startQuizSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: quizRequestSchema, QuizRequest,
 *   THE_REQUEST_IS_NOT_THE_RESULT, REQUEST_IS_DERIVED_FROM_THE_INPUT
 *
 * WHAT:  What the customer ASKED for, as it is stored on
 *        `Project.settings.script.quiz` for the workflow to read back.
 *
 * WHY:   THE_REQUEST_IS_NOT_THE_RESULT, and keeping the two apart is what makes
 *        the topic path and the manual path one path. `settings.script.quiz` is
 *        the request — a topic and a count, or a typed table — and
 *        `settings.quiz` is the RESOLVED set the generator draws
 *        (`quizSettingsSchema`). The writer reads the first and writes the
 *        second. One key holding both shapes would mean every reader had to ask
 *        which of two things it had found, and the generator would have to know
 *        how a quiz was authored in order to draw it.
 *
 *        It is DERIVED from `startQuizSchema` by dropping the two ids rather
 *        than written out again. The ids identify the CALL and are not facts
 *        about the quiz, and a second hand-written copy of these five fields is
 *        a copy that stops matching the first time one of them changes.
 *
 *        It mirrors exactly what `settings.script.thread` is for the Reddit
 *        format: the structured input the writer needs, stored by the request
 *        so the workflow does not have to recover it.
 * WHERE: Written by `quizzes.start`; read by the script workflow's
 *        `load-source` step and handed to the quiz writer.
 */
export const quizRequestSchema = startQuizSchema.omit({
  organizationId: true,
  projectId: true,
});

export type QuizRequest = z.infer<typeof quizRequestSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: quizSettingsToJson, OPTIONAL_IS_ABSENT_NOT_UNDEFINED,
 *   SERIALISED_ONCE
 *
 * WHAT:  A quiz as a plain JSON object, ready to be merged into
 *        `Project.settings`.
 *
 * WHY:   OPTIONAL_IS_ABSENT_NOT_UNDEFINED. `JsonValue` has no `undefined`
 *        member, deliberately — a JSON column cannot hold one and Prisma
 *        refuses it — so an optional field has to be OMITTED rather than set to
 *        undefined. Every optional here is therefore written with a conditional
 *        spread, which is the same construction the generators use for an
 *        asset ref's optional dimensions.
 *
 *        It is a function rather than a cast or a `JSON.parse(JSON.stringify())`
 *        round-trip. A cast would make the compiler agree with something that
 *        is not true, and a stringify round-trip would do the right thing for
 *        the wrong reason — it strips undefined as a side effect of the format
 *        rather than because anybody decided to.
 *
 *        SERIALISED_ONCE: this is the only place that knows how a quiz becomes
 *        settings, so the writer's patch and anything that later writes one
 *        cannot disagree about the shape `quizSettingsSchema` will parse back.
 * WHERE: `writeQuizScript`'s `settingsPatch`.
 */
export function quizSettingsToJson(settings: QuizSettings): JsonObject {
  return {
    ...(settings.topic === undefined ? {} : { topic: settings.topic }),
    questions: settings.questions.map(
      (question): JsonObject => ({
        question: question.question,
        options: [...question.options],
        correctIndex: question.correctIndex,
        ...(question.explanation === undefined
          ? {}
          : { explanation: question.explanation }),
        ...(question.phonetics === undefined
          ? {}
          : { phonetics: { ...question.phonetics } }),
      }),
    ),
    countdownSec: settings.countdownSec,
    answerType: settings.answerType,
    difficulty: settings.difficulty,
    ...(settings.countdownAssetId === undefined
      ? {}
      : { countdownAssetId: settings.countdownAssetId }),
  };
}
