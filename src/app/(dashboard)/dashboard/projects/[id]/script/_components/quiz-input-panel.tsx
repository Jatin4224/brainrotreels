/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: QuizInputPanel, ONE_SHAPE_TWO_INPUTS,
 *   PREVIEW_IS_ONE_QUESTION, RHF_SHARED_SCHEMA, THE_TABLE_IS_A_FORM,
 *   PROJECTED_LENGTH_INCLUDES_THE_COUNTDOWNS, ROWS_ARE_REORDERABLE
 *
 * WHAT:  The quiz input: a topic with a question count, or a question table
 *        with add, delete, reorder and import — plus the countdown length, the
 *        answer type, the difficulty, and a free single-question preview.
 *
 * WHY:   THE_TABLE_IS_A_FORM is the phase's step 9 and it is spelled out there:
 *        "the table is a form, so it follows the house pattern — Zod schema in
 *        src/lib/types/quiz.ts, RHF with `useFieldArray`, `mode: 'onTouched'`".
 *        So the rows are form fields rather than component state, which is what
 *        gives every option its own error message in the right place and makes
 *        the submit value the same object the server validates.
 *
 *        RHF_SHARED_SCHEMA — the form resolves against `startQuizSchema`, the
 *        exact schema the mutation validates with, so a value the client
 *        accepts cannot be one the server refuses. The CROSS-question rules
 *        (`checkQuizSet`) are the exception and deliberately so: they are run
 *        here too, on every change, because "the correct answer is the only
 *        long option" is advice somebody wants while typing — and run again
 *        server-side, because advice is not a guarantee.
 *
 *        ONE_SHAPE_TWO_INPUTS: the two modes are peers, like the Reddit panel's
 *        link and paste tabs, rather than one being hidden behind the other.
 *        A topic is faster and a table is exact, and both produce a quiz that
 *        renders identically.
 *
 *        PREVIEW_IS_ONE_QUESTION — the phase's step 10. The preview button asks
 *        for ONE question on the topic and shows it with any problems named, so
 *        a bad distractor is discovered before a generation is paid for. It
 *        costs no credits and it is a deliberate button press rather than a
 *        debounce on the topic field, for the same reason the Reddit lookup is:
 *        every press is a model request, and a debounce would spend them on
 *        half-typed topics.
 *
 *        Its result can be IMPORTED into the table, which is what makes the
 *        preview worth more than a glance — the question somebody just
 *        approved becomes row one instead of being typed again.
 *
 *        ROWS_ARE_REORDERABLE with buttons rather than drag-and-drop. The phase
 *        asks for reorder; buttons are keyboard-reachable and screen-reader
 *        announceable for free, and a drag handle is neither without a great
 *        deal of work. The projects table's own ordering uses the same
 *        approach.
 *
 *        PROJECTED_LENGTH_INCLUDES_THE_COUNTDOWNS: the panel shows the
 *        narration length AND the finished video length, because they are
 *        different numbers and the customer cares about both — the warning is
 *        about the script's length (the same arithmetic every format uses), and
 *        the video is longer by one countdown per question.
 *
 *        Theme tokens only, no literal colours — the one place this app allows
 *        them is a caption burned into a video (COLOURS_ARE_CONTENT), and this
 *        is a dashboard panel.
 * WHERE: Rendered by the script screen for `quiz` projects, in place of the
 *        article/PDF form.
 */

import * as React from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import {
  QUIZ_IMPORT_CORRECT_MARKER,
  QUIZ_IMPORT_SEPARATOR,
  parseQuizRows,
  type QuizImportError,
} from "@/lib/quiz";
import {
  QUIZ_ANSWER_TYPES,
  QUIZ_COUNTDOWN_DEFAULT_SECONDS,
  QUIZ_COUNTDOWN_MAX_SECONDS,
  QUIZ_COUNTDOWN_MIN_SECONDS,
  QUIZ_DIFFICULTIES,
  QUIZ_MAX_OPTIONS,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_OPTIONS,
  QUIZ_OPTION_MAX_CHARS,
  QUIZ_QUESTION_MAX_CHARS,
  QUIZ_TOPIC_MAX_CHARS,
  checkQuizSet,
  startQuizSchema,
  type QuizQuestion,
  type StartQuizValues,
} from "@/lib/types/quiz";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * SOURCE OF TRUTH KEYWORDS: EMPTY_ROW, A_NEW_ROW_IS_FOUR_OPTIONS
 *
 * A fresh table row. Four blank options, because four is what the card lays
 * out and deleting two is faster than adding two — and `correctIndex` starts at
 * zero so the row is never in the invalid state of having no answer marked.
 */
const EMPTY_ROW: QuizQuestion = {
  question: "",
  options: ["", "", "", ""],
  correctIndex: 0,
};

const DEFAULT_TOPIC_QUESTION_COUNT = 5;

export interface QuizInputPanelProps {
  organizationId: string;
  projectId: string;
  hasExistingScript: boolean;
  generating: boolean;
}

export function QuizInputPanel({
  organizationId,
  projectId,
  hasExistingScript,
  generating,
}: QuizInputPanelProps) {
  const utils = trpc.useUtils();
  const [confirming, setConfirming] = React.useState(false);

  const form = useForm<StartQuizValues>({
    resolver: zodResolver(startQuizSchema),
    /* The house pattern — errors appear once somebody has left a field, not
     * while they are still filling in the first one. */
    mode: "onTouched",
    defaultValues: {
      organizationId,
      projectId,
      source: {
        kind: "topic",
        value: "",
        questionCount: DEFAULT_TOPIC_QUESTION_COUNT,
      },
      countdownSec: QUIZ_COUNTDOWN_DEFAULT_SECONDS,
      answerType: "multiple-choice",
      difficulty: "medium",
    },
  });

  /* useWatch, not form.watch(): the React Compiler refuses to memoize a
   * component that calls `watch()`, because it returns a function whose
   * identity it cannot reason about. The same choice, for the same reason, as
   * the generate form and the create-project sheet. */
  const mode = useWatch({ control: form.control, name: "source.kind" });
  const countdownSec = useWatch({ control: form.control, name: "countdownSec" });

  const start = trpc.quizzes.start.useMutation({
    onSuccess: (result) => {
      toast.success("Writing your quiz", {
        description:
          result.projectedSeconds === null
            ? "This takes up to a minute. You can leave this page."
            : `About ${Math.round(result.projectedSeconds)} seconds of video. This takes up to a minute.`,
      });
      setConfirming(false);
      void utils.scripts.invalidate();
      void utils.projects.invalidate();
      void utils.credits.invalidate();
    },
    onError: (error) => {
      /* The server's copy already names the question and the fix, so it is
       * rendered as given rather than rewritten here. */
      toast.error("That quiz could not be started", {
        description: error.message,
      });
      setConfirming(false);
    },
  });

  const busy = start.isPending || generating;

  function onSubmit(values: StartQuizValues) {
    /* GENERATION_REPLACES_EVERYTHING — the same second-press confirmation the
     * other two panels use, for the same reason: this discards hand edits, and
     * a modal over a form somebody is already looking at is one more thing to
     * dismiss. */
    if (hasExistingScript && !confirming) {
      setConfirming(true);
      return;
    }
    start.mutate(values);
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">
          {hasExistingScript ? "Build a different quiz" : "Build a quiz"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Give us a topic and we will write the questions, or type them yourself.
          Either way you get the same video.
        </p>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-5"
          >
            {/* ONE_SHAPE_TWO_INPUTS — the two inputs are peers. */}
            <div
              className="flex gap-2"
              role="group"
              aria-label="Where the questions come from"
            >
              <Button
                type="button"
                size="sm"
                variant={mode === "topic" ? "secondary" : "ghost"}
                aria-pressed={mode === "topic"}
                onClick={() =>
                  form.setValue(
                    "source",
                    {
                      kind: "topic",
                      value: "",
                      questionCount: DEFAULT_TOPIC_QUESTION_COUNT,
                    },
                    { shouldValidate: false },
                  )
                }
              >
                Write them for me
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "manual" ? "secondary" : "ghost"}
                aria-pressed={mode === "manual"}
                onClick={() =>
                  form.setValue(
                    "source",
                    { kind: "manual", questions: [{ ...EMPTY_ROW }] },
                    { shouldValidate: false },
                  )
                }
              >
                Type my own
              </Button>
            </div>

            {mode === "topic" ? (
              <TopicFields form={form} organizationId={organizationId} />
            ) : (
              <QuestionTable form={form} />
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="countdownSec"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Thinking time</FormLabel>
                    <Select
                      value={String(field.value)}
                      onValueChange={(value) => field.onChange(Number(value))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {countdownChoices().map((seconds) => (
                          <SelectItem key={seconds} value={String(seconds)}>
                            {seconds} seconds
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="answerType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Answers</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {QUIZ_ANSWER_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type === "multiple-choice"
                              ? "Show the options"
                              : "Question only"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="difficulty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Difficulty</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {QUIZ_DIFFICULTIES.map((level) => (
                          <SelectItem key={level} value={level}>
                            {level.slice(0, 1).toUpperCase() + level.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* ANSWER_TYPE_IS_PRESENTATION — worth saying, because somebody
                picking "question only" has not necessarily realised the
                options are still used by the reveal. */}
            <p className="text-xs text-muted-foreground">
              Each question is read aloud, then there is {countdownSec ?? QUIZ_COUNTDOWN_DEFAULT_SECONDS}{" "}
              seconds of silence for the answer, then the reveal.
            </p>

            <Button type="submit" disabled={busy}>
              {start.isPending
                ? "Starting…"
                : confirming
                  ? "Replace the quiz"
                  : hasExistingScript
                    ? "Use these questions"
                    : "Make the video"}
            </Button>

            {confirming ? (
              <p className="text-xs text-muted-foreground">
                This replaces the script on this project, including any edits.
                Press again to confirm.
              </p>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: TopicFields, PREVIEW_IS_ONE_QUESTION,
 *   IMPORT_THE_PREVIEW
 *
 * WHAT:  The topic arm: a subject, how many questions, and the free preview.
 * WHY:   IMPORT_THE_PREVIEW. A previewed question somebody approved can be
 *        moved into the table with one press, which switches the form to the
 *        manual arm — so "write one for me, then let me fix it" is a supported
 *        path rather than a retype. That is the one interaction that makes the
 *        two input modes feel like one feature instead of two.
 * WHERE: `QuizInputPanel`, when the mode is `topic`.
 */
function TopicFields({
  form,
  organizationId,
}: {
  form: ReturnType<typeof useForm<StartQuizValues>>;
  organizationId: string;
}) {
  const topic = useWatch({ control: form.control, name: "source.value" });
  const difficulty = useWatch({ control: form.control, name: "difficulty" });

  const preview = trpc.quizzes.previewQuestion.useMutation({
    onError: (error) => {
      toast.error("We could not write a question on that", {
        description: error.message,
      });
    },
  });

  const trimmed = typeof topic === "string" ? topic.trim() : "";
  const ready = trimmed.length >= 3;
  const sample = preview.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          control={form.control}
          name="source.value"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Topic</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  value={typeof field.value === "string" ? field.value : ""}
                  maxLength={QUIZ_TOPIC_MAX_CHARS}
                  placeholder="The solar system, 90s football, Roman emperors…"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="source.questionCount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Questions</FormLabel>
              <Select
                value={String(field.value ?? DEFAULT_TOPIC_QUESTION_COUNT)}
                onValueChange={(value) => field.onChange(Number(value))}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {questionCountChoices().map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* PREVIEW_IS_ONE_QUESTION — a deliberate press, not a debounce. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!ready || preview.isPending}
          onClick={() =>
            preview.mutate({
              organizationId,
              topic: trimmed,
              difficulty: difficulty ?? "medium",
            })
          }
        >
          {preview.isPending ? "Writing one…" : "Try one question"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Free. See what the questions will look like before you spend anything.
        </span>
      </div>

      {sample === undefined ? null : (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
          <p className="text-sm font-medium text-foreground">
            {sample.question.question}
          </p>
          <ul className="flex flex-col gap-1">
            {sample.question.options.map((option, index) => (
              <li
                key={`${index}-${option}`}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Badge
                  variant={
                    index === sample.question.correctIndex
                      ? "default"
                      : "outline"
                  }
                  className="shrink-0"
                >
                  {String.fromCharCode(65 + index)}
                </Badge>
                <span>{option}</span>
                {index === sample.question.correctIndex ? (
                  /* CORRECT_IS_NEVER_ONLY_COLOUR, here too: the word, not the
                     badge's fill, is what says which one is right. */
                  <span className="text-xs font-medium text-foreground">
                    correct
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          {sample.rejections.length === 0 ? null : (
            <Alert variant="destructive">
              <AlertTitle>This one would be rejected</AlertTitle>
              <AlertDescription>
                {sample.rejections.map((rejection) => (
                  <span key={rejection.reason}>{rejection.message}</span>
                ))}
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                form.setValue(
                  "source",
                  { kind: "manual", questions: [sample.question] },
                  { shouldValidate: false },
                )
              }
            >
              Start a table from this question
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: QuestionTable, THE_TABLE_IS_A_FORM,
 *   ROWS_ARE_REORDERABLE, ADVICE_BEFORE_REFUSAL
 *
 * WHAT:  The typed question table: rows with options, a marked answer, add,
 *        delete and reorder.
 *
 * WHY:   `useFieldArray` keyed on `source.questions`, which is the phase's own
 *        requirement — and it is what makes `remove`, `move` and `append`
 *        preserve each row's validation state instead of re-keying the list and
 *        clearing it.
 *
 *        ADVICE_BEFORE_REFUSAL: `checkQuizSet` runs here on every change and
 *        its findings are shown as ADVICE under the table, not as a block on
 *        the submit button. The server refuses the same set
 *        (VALIDATE_IN_THE_REQUEST), so nothing unsafe gets through — and
 *        letting somebody press the button and read a specific sentence is
 *        kinder than a disabled control with no explanation. The length tell in
 *        particular is a judgement call that a careful author may want to
 *        overrule by rewording rather than by being stopped.
 *
 *        The answer is marked with a radio-style control per row rather than a
 *        number field: `correctIndex` is "which of these", and a number input
 *        lets somebody type 7 for a four-option question.
 * WHERE: `QuizInputPanel`, when the mode is `manual`.
 */
function QuestionTable({
  form,
}: {
  form: ReturnType<typeof useForm<StartQuizValues>>;
}) {
  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: "source.questions",
  });
  const [importing, setImporting] = React.useState(false);

  const questions = useWatch({
    control: form.control,
    name: "source.questions",
  });

  /* ADVICE_BEFORE_REFUSAL — the same pure function the server runs, so the
   * advice and the refusal cannot disagree. Guarded because a half-typed row
   * is not yet a question. */
  const advice = React.useMemo(() => {
    if (!Array.isArray(questions)) return [];
    const complete = questions.filter(
      (question): question is QuizQuestion =>
        typeof question?.question === "string" &&
        question.question.trim().length > 0 &&
        Array.isArray(question.options) &&
        question.options.every(
          (option) => typeof option === "string" && option.trim().length > 0,
        ),
    );
    return complete.length === 0 ? [] : checkQuizSet(complete);
  }, [questions]);

  return (
    <div className="flex flex-col gap-4">
      {fields.map((field, index) => (
        <div
          key={field.id}
          className="flex flex-col gap-3 rounded-lg border border-border p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">
              Question {index + 1}
            </span>
            {/* ROWS_ARE_REORDERABLE — buttons, so this works from a keyboard
                and announces itself. */}
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Move question ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                Up
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Move question ${index + 1} down`}
                disabled={index === fields.length - 1}
                onClick={() => move(index, index + 1)}
              >
                Down
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Delete question ${index + 1}`}
                disabled={fields.length === 1}
                onClick={() => remove(index)}
              >
                Delete
              </Button>
            </div>
          </div>

          <FormField
            control={form.control}
            name={`source.questions.${index}.question`}
            render={({ field: questionField }) => (
              <FormItem>
                <FormLabel>Question</FormLabel>
                <FormControl>
                  <Input
                    {...questionField}
                    value={
                      typeof questionField.value === "string"
                        ? questionField.value
                        : ""
                    }
                    maxLength={QUIZ_QUESTION_MAX_CHARS}
                    placeholder="Which planet has the shortest day?"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <OptionRows form={form} questionIndex={index} />
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length >= QUIZ_MAX_QUESTIONS}
          onClick={() => append({ ...EMPTY_ROW })}
        >
          Add a question
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={importing}
          onClick={() => setImporting((open) => !open)}
        >
          {importing ? "Hide import" : "Import rows"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {fields.length} of {QUIZ_MAX_QUESTIONS}
        </span>
      </div>

      {importing ? (
        <ImportRows
          onImport={(questions, replace) => {
            if (replace) {
              form.setValue(
                "source",
                { kind: "manual", questions },
                { shouldValidate: false },
              );
            } else {
              for (const question of questions) append(question);
            }
            setImporting(false);
          }}
          remaining={QUIZ_MAX_QUESTIONS - fields.length}
          canAppend={fields.length > 0}
        />
      ) : null}

      {advice.length === 0 ? null : (
        <Alert>
          <AlertTitle>Worth fixing before you generate</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {advice.map((rejection) => (
                <li key={`${rejection.questionIndex}-${rejection.reason}`}>
                  Question {rejection.questionIndex + 1}: {rejection.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: OptionRows, CORRECT_IS_A_CHOICE_NOT_A_NUMBER
 *
 * WHAT:  One question's options, with the correct one chosen.
 * WHY:   CORRECT_IS_A_CHOICE_NOT_A_NUMBER. The answer is picked with a radio
 *        per option rather than typed as an index, so `correctIndex` can only
 *        ever name an option that exists — the invalid state the server's
 *        `correct_index_out_of_range` rule exists to catch is unreachable from
 *        this form, which is how a validation rule and a form should relate.
 *
 *        Deleting an option RE-POINTS the answer when the deleted row was at or
 *        before it, rather than leaving the index where it was: deleting option
 *        A would otherwise silently make B the answer, which is the one edit
 *        that changes a question's meaning without touching its text.
 *
 *        It drives the array with `setValue` rather than with `useFieldArray`,
 *        unlike the question rows above, and the reason is a real constraint
 *        rather than a preference: `useFieldArray` requires an array of
 *        OBJECTS — it keys each row by an injected `id` — and `options` is an
 *        array of STRINGS, which is the shape the phase's own contract
 *        specifies (`options: z.array(z.string())`). Wrapping each option in
 *        `{ value: string }` to satisfy the hook would change the stored
 *        document shape to suit a form library, so the form bends instead.
 * WHERE: `QuestionTable`, once per row.
 */
function OptionRows({
  form,
  questionIndex,
}: {
  form: ReturnType<typeof useForm<StartQuizValues>>;
  questionIndex: number;
}) {
  const options = useWatch({
    control: form.control,
    name: `source.questions.${questionIndex}.options`,
  });
  const list = Array.isArray(options) ? options : [];

  const correctIndex = useWatch({
    control: form.control,
    name: `source.questions.${questionIndex}.correctIndex`,
  });
  const current = typeof correctIndex === "number" ? correctIndex : 0;

  function removeOption(index: number): void {
    form.setValue(
      `source.questions.${questionIndex}.options`,
      list.filter((_option, candidate) => candidate !== index),
      { shouldValidate: true },
    );
    /* See CORRECT_IS_A_CHOICE_NOT_A_NUMBER — keep the answer pointing at the
     * option the author chose. */
    if (index < current) {
      form.setValue(
        `source.questions.${questionIndex}.correctIndex`,
        Math.max(0, current - 1),
      );
    } else if (index === current) {
      form.setValue(`source.questions.${questionIndex}.correctIndex`, 0);
    }
  }

  function addOption(): void {
    form.setValue(`source.questions.${questionIndex}.options`, [...list, ""], {
      shouldValidate: false,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Options — pick the correct one</Label>
      {list.map((_option, index) => (
        <div
          /* The INDEX is the key, because an option has no stable identity of
             its own and the rows are only ever added or removed at the end or
             by the delete button next to them. */
          key={`option-${index}`}
          className="flex items-center gap-2"
        >
          <input
            type="radio"
            name={`correct-${questionIndex}`}
            checked={current === index}
            aria-label={`Option ${String.fromCharCode(65 + index)} is correct`}
            onChange={() =>
              form.setValue(
                `source.questions.${questionIndex}.correctIndex`,
                index,
              )
            }
            className="size-4 shrink-0 accent-primary"
          />
          <FormField
            control={form.control}
            name={`source.questions.${questionIndex}.options.${index}`}
            render={({ field: optionField }) => (
              <FormItem className="min-w-0 flex-1">
                <FormControl>
                  <Input
                    {...optionField}
                    value={
                      typeof optionField.value === "string"
                        ? optionField.value
                        : ""
                    }
                    maxLength={QUIZ_OPTION_MAX_CHARS}
                    placeholder={`Option ${String.fromCharCode(65 + index)}`}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Delete option ${String.fromCharCode(65 + index)}`}
            disabled={list.length <= QUIZ_MIN_OPTIONS}
            onClick={() => removeOption(index)}
          >
            Remove
          </Button>
        </div>
      ))}

      <div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={list.length >= QUIZ_MAX_OPTIONS}
          onClick={addOption}
        >
          Add an option
        </Button>
      </div>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: ImportRows, IMPORT_IS_A_PARSER,
 *   PARTIAL_IMPORT_IS_REFUSED
 *
 * WHAT:  A paste box that turns pasted rows into table rows.
 *
 * WHY:   Anybody with ten questions already has them somewhere — a
 *        spreadsheet, a doc, a notes app — and keying each option into a form
 *        field is the reason they would not use the table at all. Paste is the
 *        only import that needs no upload, no storage key and no ingest, which
 *        is what lets the whole of it be a pure function with a unit test
 *        (src/lib/quiz/import.ts).
 *
 *        The format is described from the parser's OWN constants rather than
 *        from a copy of them, so the instructions cannot drift from what the
 *        parser accepts.
 *
 *        PARTIAL_IMPORT_IS_REFUSED — the parser returns questions or errors and
 *        never both, so this component has no "7 of 10 imported" state to
 *        render. Errors are listed with their line numbers, which is what makes
 *        a refusal something to act on.
 *
 *        It offers APPEND and REPLACE as separate buttons rather than guessing.
 *        Somebody importing into an empty table means replace and somebody
 *        importing into a filled one could mean either, and silently appending
 *        to a table they meant to replace leaves duplicates that
 *        `checkQuizSet` then refuses — a confusing outcome for a reasonable
 *        action.
 * WHERE: `QuestionTable`, behind the "Import rows" button.
 */
function ImportRows({
  onImport,
  remaining,
  canAppend,
}: {
  onImport: (questions: QuizQuestion[], replace: boolean) => void;
  remaining: number;
  canAppend: boolean;
}) {
  const [text, setText] = React.useState("");
  const [errors, setErrors] = React.useState<QuizImportError[]>([]);

  function run(replace: boolean): void {
    const result = parseQuizRows(text);
    if (result.errors.length > 0) {
      setErrors(result.errors);
      return;
    }
    if (!replace && result.questions.length > remaining) {
      setErrors([
        {
          line: 1,
          message: `There is room for ${remaining} more ${remaining === 1 ? "question" : "questions"}. Replace the table instead, or remove some rows.`,
        },
      ]);
      return;
    }
    setErrors([]);
    setText("");
    onImport(result.questions, replace);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="quiz-import">Paste your questions</Label>
        <p className="text-xs text-muted-foreground">
          One question per line. Separate the question and its options with{" "}
          <span className="font-mono">{QUIZ_IMPORT_SEPARATOR}</span>, and put{" "}
          <span className="font-mono">{QUIZ_IMPORT_CORRECT_MARKER}</span> after
          the correct answer.
        </p>
      </div>

      <Textarea
        id="quiz-import"
        value={text}
        rows={5}
        spellCheck={false}
        placeholder={`Which planet has the shortest day? ${QUIZ_IMPORT_SEPARATOR} Mercury ${QUIZ_IMPORT_SEPARATOR} Jupiter${QUIZ_IMPORT_CORRECT_MARKER} ${QUIZ_IMPORT_SEPARATOR} Earth ${QUIZ_IMPORT_SEPARATOR} Mars`}
        onChange={(event) => {
          setText(event.target.value);
          setErrors([]);
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={text.trim().length === 0}
          onClick={() => run(true)}
        >
          Replace the table
        </Button>
        {canAppend ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={text.trim().length === 0 || remaining <= 0}
            onClick={() => run(false)}
          >
            Add to the table
          </Button>
        ) : null}
      </div>

      {errors.length === 0 ? null : (
        <Alert variant="destructive">
          <AlertTitle>Nothing was imported</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {errors.map((error) => (
                <li key={`${error.line}-${error.message}`}>
                  Line {error.line}: {error.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/* The bounds come from the schema, so the dropdown cannot offer a value the
 * server refuses — the same reason the form resolves against it. */
function countdownChoices(): number[] {
  const choices: number[] = [];
  for (
    let seconds = QUIZ_COUNTDOWN_MIN_SECONDS;
    seconds <= QUIZ_COUNTDOWN_MAX_SECONDS;
    seconds += 1
  ) {
    choices.push(seconds);
  }
  return choices;
}

function questionCountChoices(): number[] {
  const choices: number[] = [];
  for (let count = 1; count <= QUIZ_MAX_QUESTIONS; count += 1) {
    choices.push(count);
  }
  return choices;
}
