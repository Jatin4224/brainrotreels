/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: parseQuizRows, QuizImportResult, QuizImportError,
 *   QUIZ_IMPORT_SEPARATOR, QUIZ_IMPORT_CORRECT_MARKER, IMPORT_IS_A_PARSER,
 *   PARTIAL_IMPORT_IS_REFUSED, ONE_SHAPE_TWO_INPUTS
 *
 * WHAT:  Turning pasted rows — one question per line, fields separated by a
 *        pipe, the correct answer marked with a trailing asterisk — into
 *        validated questions.
 *
 * WHY:   IMPORT_IS_A_PARSER, which is the phase's step 9 ("add, delete,
 *        reorder and import rows") answered in the cheapest honest way. Anybody
 *        with ten questions already has them in a spreadsheet, a doc or a
 *        notes app, and typing each option into a form field is the reason they
 *        would not use the feature. Paste is the one import that needs no file
 *        upload, no storage key, no ingest and no MIME sniffing — so it is also
 *        the one that can be a pure function with a unit test instead of a
 *        pipeline.
 *
 *        A PIPE rather than a comma, because an option legitimately contains a
 *        comma ("Paris, France") and a CSV that handles that properly needs
 *        quote-and-escape parsing — which is a parser nobody should hand-write
 *        for a paste box. A pipe in a trivia answer is vanishingly rare and the
 *        error message names it when it happens.
 *
 *        An ASTERISK marks the correct answer rather than a separate column of
 *        indices, because an index is the thing people get wrong when counting
 *        from zero, and a marker sits next to the answer it is talking about.
 *        A row with no marker defaults to the FIRST option — not an error,
 *        because the table it lands in shows the answer as a radio button the
 *        author will see immediately, and refusing the whole paste over a
 *        missing asterisk would be worse than the one correction.
 *
 *        PARTIAL_IMPORT_IS_REFUSED. A paste either becomes questions or it
 *        becomes errors — it never becomes "seven of your ten rows". A partial
 *        import is the shape that loses data silently: the author sees a table
 *        appear, assumes it worked, and discovers three missing questions in
 *        the finished video. Every problem row is reported WITH ITS LINE
 *        NUMBER, which is what makes the refusal actionable rather than a wall.
 *
 *        ONE_SHAPE_TWO_INPUTS — the output is `QuizQuestion[]`, parsed by the
 *        same `quizQuestionSchema` a typed row is, so an imported question is
 *        indistinguishable from one somebody keyed in. The cross-question rules
 *        are deliberately NOT run here: `checkQuizSet` is run against the whole
 *        TABLE after the import merges into it, and running it on the paste
 *        alone would miss a question that duplicates one already in the table.
 *
 *        PURE — no database, no provider, no clock, no React. Imported by a
 *        client component, so it may import none of those.
 * WHERE: The quiz input panel's import box.
 */

import {
  QUIZ_MAX_QUESTIONS,
  quizQuestionSchema,
  type QuizQuestion,
} from "@/lib/types/quiz";

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_IMPORT_SEPARATOR, QUIZ_IMPORT_CORRECT_MARKER
 *
 * The two characters the format is made of. Exported so the panel's own
 * instructions and placeholder are written from the parser's actual rules
 * rather than from a copy of them that can drift.
 */
export const QUIZ_IMPORT_SEPARATOR = "|";
export const QUIZ_IMPORT_CORRECT_MARKER = "*";

/**
 * SOURCE OF TRUTH KEYWORDS: QuizImportError
 *
 * WHAT:  One row that could not be read, and why.
 * WHY:   `line` is ONE-BASED and counts the lines of what was pasted, blank
 *        ones included, so it matches what the author sees in the box. A
 *        zero-based index, or one that counted only non-blank rows, would point
 *        at the wrong line in exactly the paste where the message matters most.
 * WHERE: `QuizImportResult.errors`.
 */
export interface QuizImportError {
  line: number;
  message: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: QuizImportResult, PARTIAL_IMPORT_IS_REFUSED
 *
 * WHAT:  Either the questions or the reasons there are none.
 * WHY:   Both fields are always present and exactly one is non-empty, which is
 *        what makes PARTIAL_IMPORT_IS_REFUSED structural: there is no state
 *        this type can hold that means "some of them worked".
 * WHERE: Returned by `parseQuizRows`.
 */
export interface QuizImportResult {
  questions: QuizQuestion[];
  errors: QuizImportError[];
}

/**
 * SOURCE OF TRUTH KEYWORDS: parseQuizRows, IMPORT_IS_A_PARSER
 *
 * WHAT:  Pasted rows as questions, or as the list of rows to fix.
 *
 * WHY:   Blank lines are SKIPPED rather than refused: a paste out of a
 *         spreadsheet or a document routinely ends with one, and refusing it
 *         would make the common case fail on something invisible.
 *
 *        The row cap is checked against `QUIZ_MAX_QUESTIONS` here as well as by
 *        the schema downstream, so somebody pasting thirty rows is told the
 *        limit instead of having the table silently keep ten — which is the
 *        partial import this function exists to avoid.
 *
 *        Each row is parsed by `quizQuestionSchema`, so the length caps, the
 *        option count and the trimming are the schema's and not a second
 *        implementation. What this function does is turn one line of text into
 *        the schema's INPUT and turn a parse failure into a sentence with a
 *        line number on it.
 * WHERE: The panel's import box.
 */
export function parseQuizRows(input: string): QuizImportResult {
  const questions: QuizQuestion[] = [];
  const errors: QuizImportError[] = [];

  const lines = input.split(/\r?\n/);
  let rows = 0;

  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const trimmed = raw.trim();
    /* A paste out of a spreadsheet routinely ends with one. */
    if (trimmed.length === 0) continue;

    rows += 1;
    if (rows > QUIZ_MAX_QUESTIONS) {
      errors.push({
        line,
        message: `A quiz can hold at most ${QUIZ_MAX_QUESTIONS} questions. Remove the rows after this one.`,
      });
      continue;
    }

    const fields = trimmed
      .split(QUIZ_IMPORT_SEPARATOR)
      .map((field) => field.trim());
    const question = fields[0] ?? "";
    const rest = fields.slice(1);

    if (question.length === 0) {
      errors.push({
        line,
        message: `This row has no question before the first "${QUIZ_IMPORT_SEPARATOR}".`,
      });
      continue;
    }

    if (rest.length < 2) {
      errors.push({
        line,
        message: `This row needs a question and at least two options, separated by "${QUIZ_IMPORT_SEPARATOR}".`,
      });
      continue;
    }

    /* The marker is stripped from the option it marks, so "Jupiter*" becomes
     * the option "Jupiter" at that index. */
    let correctIndex = -1;
    const options = rest.map((option, optionIndex) => {
      if (!option.endsWith(QUIZ_IMPORT_CORRECT_MARKER)) return option;
      /* A row marking two answers is a row whose author was unsure, and the
       * LAST marker winning silently would be the wrong kind of guess — so the
       * first one is kept and the duplicate is reported below. */
      if (correctIndex === -1) correctIndex = optionIndex;
      return option.slice(0, -QUIZ_IMPORT_CORRECT_MARKER.length).trim();
    });

    const markers = rest.filter((option) =>
      option.endsWith(QUIZ_IMPORT_CORRECT_MARKER),
    ).length;
    if (markers > 1) {
      errors.push({
        line,
        message: `This row marks ${markers} answers as correct with "${QUIZ_IMPORT_CORRECT_MARKER}". Mark exactly one.`,
      });
      continue;
    }

    const parsed = quizQuestionSchema.safeParse({
      question,
      options,
      /* No marker defaults to the first option — see the file header for why
       * that is a default rather than a refusal. */
      correctIndex: correctIndex === -1 ? 0 : correctIndex,
    });

    if (!parsed.success) {
      errors.push({ line, message: firstIssue(parsed.error) });
      continue;
    }

    questions.push(parsed.data);
  }

  if (questions.length === 0 && errors.length === 0) {
    errors.push({ line: 1, message: "There is nothing to import." });
  }

  /* PARTIAL_IMPORT_IS_REFUSED — all or nothing, so a paste cannot half-land. */
  return errors.length > 0 ? { questions: [], errors } : { questions, errors };
}

/**
 * SOURCE OF TRUTH KEYWORDS: firstIssue, ONE_PROBLEM_PER_ROW
 *
 * WHAT:  The first thing the schema objected to, as a sentence.
 * WHY:   ONE_PROBLEM_PER_ROW. A zod error over one row can carry five issues
 *        and listing them all makes a ten-row paste unreadable — and the
 *        second issue is usually a consequence of the first. The row is named,
 *        so an author who fixes one and re-pastes sees the next.
 *
 *        The field path is included because "too long" means different things
 *        for a question and for an option, and the author needs to know which.
 * WHERE: `parseQuizRows`.
 */
function firstIssue(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (issue === undefined) return "This row could not be read.";

  const field = issue.path
    .map((segment) => String(segment))
    .filter((segment) => segment !== "")
    .join(".");

  return field.length > 0 ? `${field}: ${issue.message}` : issue.message;
}
