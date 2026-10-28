/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: quiz import tests, parseQuizRows,
 *   PARTIAL_IMPORT_IS_REFUSED, IMPORT_IS_A_PARSER, ONE_SHAPE_TWO_INPUTS
 *
 * WHAT:  Proof that a paste either becomes questions or becomes numbered
 *        errors, and never becomes some of each.
 *
 * WHY:   PARTIAL_IMPORT_IS_REFUSED is the property worth testing rather than
 *        the happy path. A partial import is the shape that loses data
 *        silently: the author sees a table appear, assumes it worked, and
 *        discovers the missing questions in the finished video. The all-or-
 *        nothing rule is only as good as the one case that violates it, so the
 *        mixed-paste case is asserted directly.
 * WHERE: Run by `npm test`. Covers src/lib/quiz/import.ts.
 */

import { describe, expect, it } from "vitest";

import { QUIZ_MAX_QUESTIONS } from "@/lib/types/quiz";
import { parseQuizRows } from "./import";

const GOOD = "Which planet has the shortest day? | Mercury | Jupiter* | Earth | Mars";

describe("parseQuizRows", () => {
  it("reads a row and marks the starred option as correct", () => {
    const result = parseQuizRows(GOOD);

    expect(result.errors).toEqual([]);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toEqual({
      question: "Which planet has the shortest day?",
      options: ["Mercury", "Jupiter", "Earth", "Mars"],
      correctIndex: 1,
    });
  });

  it("reads several rows and keeps their order", () => {
    const result = parseQuizRows(
      [GOOD, "Which ocean is the deepest? | Atlantic | Pacific* | Arctic"].join(
        "\n",
      ),
    );

    expect(result.errors).toEqual([]);
    expect(result.questions.map((question) => question.correctIndex)).toEqual([
      1, 1,
    ]);
  });

  /* A paste out of a spreadsheet or a document routinely ends with one, and
   * refusing it would make the common case fail on something invisible. */
  it("skips blank lines", () => {
    const result = parseQuizRows(`\n${GOOD}\n\n`);
    expect(result.errors).toEqual([]);
    expect(result.questions).toHaveLength(1);
  });

  /* The line number counts the lines of what was pasted, blank ones included,
   * so it matches what the author is looking at. */
  it("numbers an error by the line in the box", () => {
    const result = parseQuizRows(`\n\nnot a question row`);
    expect(result.questions).toEqual([]);
    expect(result.errors[0]?.line).toBe(3);
  });

  it("refuses a row with fewer than two options", () => {
    const result = parseQuizRows("Only a question | One option");
    expect(result.questions).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/at least two options/i);
  });

  it("refuses a row with no question before the separator", () => {
    const result = parseQuizRows(" | Mercury | Jupiter*");
    expect(result.questions).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/no question/i);
  });

  /* A row marking two answers is a row whose author was unsure, and the last
   * marker winning silently would be the wrong kind of guess. */
  it("refuses a row that marks two correct answers", () => {
    const result = parseQuizRows("Pick one | A* | B* | C");
    expect(result.questions).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/marks 2 answers/i);
  });

  /* No marker defaults to the first option rather than refusing — the table it
   * lands in shows the answer as a radio button the author sees immediately. */
  it("defaults to the first option when nothing is marked", () => {
    const result = parseQuizRows("Pick one | A | B | C");
    expect(result.errors).toEqual([]);
    expect(result.questions[0]?.correctIndex).toBe(0);
  });

  /**
   * PARTIAL_IMPORT_IS_REFUSED — the case the rule exists for. One bad row in a
   * paste of three means NOTHING is imported, and the good rows are not
   * silently kept.
   */
  it("imports nothing when any row is bad", () => {
    const result = parseQuizRows(
      [GOOD, "broken row with no options", GOOD].join("\n"),
    );

    expect(result.questions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBe(2);
  });

  /* ONE_SHAPE_TWO_INPUTS — an imported question is parsed by the same schema a
   * typed one is, so a cap cannot be reached by pasting. */
  it("applies the schema's own caps", () => {
    const result = parseQuizRows(`${"x".repeat(201)} | A | B*`);
    expect(result.questions).toEqual([]);
    expect(result.errors[0]?.message).toContain("question");
  });

  it("refuses a fifth option", () => {
    const result = parseQuizRows("Too many | A | B | C | D | E*");
    expect(result.questions).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  /* The row cap is reported rather than the table silently keeping the first
   * ten — which would be the partial import this parser exists to avoid. */
  it("names the question limit instead of truncating", () => {
    const rows = Array.from({ length: QUIZ_MAX_QUESTIONS + 2 }, (_, index) =>
      `Question number ${index}? | A${index} | B${index}*`,
    ).join("\n");

    const result = parseQuizRows(rows);
    expect(result.questions).toEqual([]);
    expect(result.errors[0]?.message).toContain(String(QUIZ_MAX_QUESTIONS));
  });

  it("says there is nothing to import for an empty paste", () => {
    const result = parseQuizRows("   \n  ");
    expect(result.questions).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/nothing to import/i);
  });
});
