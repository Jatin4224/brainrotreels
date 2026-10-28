/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: quiz validation tests, checkQuizSet,
 *   THE_SCHEMA_IS_NOT_ENOUGH, LENGTH_IS_THE_LLM_TELL, ONE_SHAPE_TWO_INPUTS
 *
 * WHAT:  Proof that the four cross-field rules refuse exactly the sets the
 *        phase says must be refused, and accept the ones that merely look
 *        similar.
 *
 * WHY:   The phase's third "done when" check is "a generated set with two
 *        correct answers, a duplicate option, or a duplicate question is
 *        rejected and regenerated rather than saved", and this file is where
 *        the first half of that is proved — the regeneration itself is the
 *        writer's and needs a model.
 *
 *        The FALSE POSITIVES matter as much as the refusals here, which is why
 *        there are as many accepting cases as rejecting ones. A length rule
 *        that refuses "Jupiter" against "Mars" would make the product unable to
 *        ask a fair question about planets, and that failure is invisible in a
 *        test suite that only checks that bad sets are caught.
 * WHERE: Run by `npm test`. Covers src/lib/types/quiz.ts.
 */

import { describe, expect, it } from "vitest";

import {
  checkQuizSet,
  quizQuestionSchema,
  quizSettingsToJson,
  type QuizQuestion,
} from "./quiz";

function question(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    question: "Which planet has the shortest day?",
    options: ["Mercury", "Jupiter", "Earth", "Mars"],
    correctIndex: 1,
    ...overrides,
  };
}

describe("checkQuizSet", () => {
  it("accepts a fair multiple-choice set", () => {
    expect(checkQuizSet([question()])).toEqual([]);
  });

  it("refuses an empty set", () => {
    expect(checkQuizSet([]).map((rejection) => rejection.reason)).toEqual([
      "empty_set",
    ]);
  });

  /* The schema can say `correctIndex` is a non-negative integer; only this can
   * say it is inside THIS question's options. A reveal pointing past the end
   * highlights nothing, which is a quiz with no answer. */
  it("refuses a correct index past the end of the options", () => {
    const rejections = checkQuizSet([question({ correctIndex: 4 })]);
    expect(rejections.map((rejection) => rejection.reason)).toContain(
      "correct_index_out_of_range",
    );
    expect(rejections[0]?.questionIndex).toBe(0);
  });

  it("refuses two options that are the same answer", () => {
    const rejections = checkQuizSet([
      question({ options: ["Mercury", "Jupiter", "Earth", "mercury "] }),
    ]);
    expect(rejections.map((rejection) => rejection.reason)).toEqual([
      "duplicate_option",
    ]);
  });

  /* DUPLICATES_ARE_NOT_BYTES — case, inner whitespace and trailing punctuation
   * are invisible to a viewer, so a byte-equality check would pass a question
   * with two right answers. */
  it("refuses a repeated question however it is punctuated", () => {
    const rejections = checkQuizSet([
      question(),
      question({ question: "which   planet has the shortest DAY" }),
    ]);
    expect(rejections.map((rejection) => rejection.reason)).toEqual([
      "duplicate_question",
    ]);
    /* The SECOND occurrence is reported — the first one is not the mistake. */
    expect(rejections[0]?.questionIndex).toBe(1);
  });

  /* LENGTH_IS_THE_LLM_TELL — the shape the tell actually takes: a full clause
   * against three short words. */
  it("refuses a set where the correct answer is the only long option", () => {
    const rejections = checkQuizSet([
      question({
        question: "Why does Venus rotate so slowly?",
        options: [
          "Gravity",
          "Tidal forces from its dense atmosphere acting over billions of years",
          "Magnetism",
          "Solar wind",
        ],
        correctIndex: 1,
      }),
    ]);
    expect(rejections.map((rejection) => rejection.reason)).toEqual([
      "length_tell",
    ]);
  });

  /* The false positive the absolute gap exists to prevent. "Jupiter" against
   * "Mars" is a 1.75x ratio and a perfectly fair question — nobody picks an
   * answer because it has three more letters. */
  it("accepts a short correct answer that is merely the longest", () => {
    expect(checkQuizSet([question()])).toEqual([]);
  });

  /* A question already refused for a more specific reason must not collect a
   * second refusal that would send the author chasing the wrong fix. */
  it("does not add a length verdict to a question with a bad index", () => {
    const rejections = checkQuizSet([
      question({
        options: ["A", "B"],
        correctIndex: 9,
      }),
    ]);
    expect(rejections.map((rejection) => rejection.reason)).toEqual([
      "correct_index_out_of_range",
    ]);
  });

  it("reports every problem in a set rather than stopping at the first", () => {
    const rejections = checkQuizSet([
      question({ options: ["Same", "Same", "Earth", "Mars"] }),
      question(),
    ]);
    expect(rejections.map((rejection) => rejection.reason).sort()).toEqual([
      "duplicate_option",
      "duplicate_question",
    ]);
  });

  it("carries the already-written sentence on every rejection", () => {
    for (const rejection of checkQuizSet([question({ correctIndex: 7 })])) {
      expect(rejection.message.length).toBeGreaterThan(20);
    }
  });
});

describe("quizQuestionSchema", () => {
  /* ONE_SHAPE_TWO_INPUTS — a generated question is constrained by exactly the
   * bounds a typed one is, so there is no length a model can return that a
   * person could not have typed. */
  it("trims and refuses a question past the card's cap", () => {
    expect(
      quizQuestionSchema.parse(question({ question: "  Trimmed?  " })).question,
    ).toBe("Trimmed?");
    expect(
      quizQuestionSchema.safeParse(question({ question: "x".repeat(201) }))
        .success,
    ).toBe(false);
  });

  it("refuses a fifth option and a lone option", () => {
    expect(
      quizQuestionSchema.safeParse(question({ options: ["a", "b", "c", "d", "e"] }))
        .success,
    ).toBe(false);
    expect(
      quizQuestionSchema.safeParse(question({ options: ["a"] })).success,
    ).toBe(false);
  });

  /* `.strict()`, so a model that invents a field fails the parse and burns the
   * adapter's one retry rather than having it silently dropped. */
  it("refuses a field nobody declared", () => {
    expect(
      quizQuestionSchema.safeParse({ ...question(), category: "space" }).success,
    ).toBe(false);
  });

  it("caps the number of pronunciation overrides", () => {
    const phonetics: Record<string, string> = {};
    for (let index = 0; index < 13; index += 1) {
      phonetics[`term${index}`] = "spoken";
    }
    expect(
      quizQuestionSchema.safeParse(question({ phonetics })).success,
    ).toBe(false);
  });
});

describe("quizSettingsToJson", () => {
  /* OPTIONAL_IS_ABSENT_NOT_UNDEFINED — `JsonValue` has no `undefined` member
   * because a JSON column cannot hold one, so an optional field has to be
   * omitted rather than set to undefined. */
  it("omits every absent optional rather than writing undefined", () => {
    const json = quizSettingsToJson({
      questions: [question()],
      countdownSec: 5,
      answerType: "multiple-choice",
      difficulty: "medium",
    });

    expect(Object.keys(json).sort()).toEqual([
      "answerType",
      "countdownSec",
      "difficulty",
      "questions",
    ]);
    expect(JSON.stringify(json)).not.toContain("undefined");
  });

  it("keeps the optionals that are present", () => {
    const json = quizSettingsToJson({
      topic: "The solar system",
      questions: [
        question({ explanation: "It spins fast.", phonetics: { SQL: "sequel" } }),
      ],
      countdownSec: 3,
      answerType: "open",
      difficulty: "hard",
      countdownAssetId: "ast_tick",
    });

    expect(json["topic"]).toBe("The solar system");
    expect(json["countdownAssetId"]).toBe("ast_tick");
    expect(JSON.stringify(json)).toContain("sequel");
  });
});
