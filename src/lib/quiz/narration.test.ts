/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: quiz narration tests, planQuizNarration,
 *   applyPhonetics, COUNTDOWN_IS_A_LEAD_GAP, PHONETICS_ARE_SPOKEN_NOT_SHOWN,
 *   QUIZ_NARRATION_IS_PLANNED_ONCE, LONGEST_TERM_FIRST
 *
 * WHAT:  Proof that the plan is deterministic, that the countdown is recorded
 *        as silence before each reveal and nowhere else, and that a
 *        pronunciation override changes the spoken copy without touching
 *        anything that gets drawn.
 *
 * WHY:   The plan is the hinge of the whole format: the WRITER turns it into
 *        script blocks and the GENERATOR re-derives it to work out which
 *        narration line belongs to which card
 *        (QUIZ_NARRATION_IS_PLANNED_ONCE). If the two calls could ever differ,
 *        every card after the difference would be attributed to the wrong
 *        question — and the symptom would be a finished, paid-for video with
 *        the answers one question out of step, which no type checks and no
 *        schema would have caught. So determinism is asserted directly rather
 *        than assumed.
 *
 *        It needs no model, no database and no key, which is the point of this
 *        module being pure.
 * WHERE: Run by `npm test`. Covers src/lib/quiz/narration.ts.
 */

import { describe, expect, it } from "vitest";

import { QUIZ_SPEAKER_TAG, type QuizQuestion } from "@/lib/types/quiz";
import { applyPhonetics, planQuizNarration } from "./narration";

const QUESTIONS: QuizQuestion[] = [
  {
    question: "Which planet has the shortest day?",
    options: ["Mercury", "Jupiter", "Earth", "Mars"],
    correctIndex: 1,
  },
  {
    question: "Which ocean is the deepest?",
    options: ["Atlantic", "Indian", "Pacific", "Arctic"],
    correctIndex: 2,
    explanation: "The Mariana Trench is in it.",
  },
];

describe("planQuizNarration", () => {
  it("is an intro, then a question and a reveal each, then an outro", () => {
    const segments = planQuizNarration({
      questions: QUESTIONS,
      countdownSec: 5,
      topic: "Planets and oceans",
    });

    expect(segments.map((segment) => segment.role)).toEqual([
      "intro",
      "question",
      "reveal",
      "question",
      "reveal",
      "outro",
    ]);
    expect(segments.map((segment) => segment.questionIndex)).toEqual([
      null,
      0,
      0,
      1,
      1,
      null,
    ]);
  });

  /* COUNTDOWN_IS_A_LEAD_GAP — the thinking beat is silence before the ANSWER,
   * and nothing else asks for one. The sixth "done when" check of the phase
   * ("the countdown contains no speech") is satisfied by there being a hole in
   * the narration rather than by anything muting a voice. */
  it("puts the countdown before every reveal and nowhere else", () => {
    const segments = planQuizNarration({ questions: QUESTIONS, countdownSec: 4 });

    for (const segment of segments) {
      expect(segment.leadSilenceSec).toBe(segment.role === "reveal" ? 4 : 0);
    }
  });

  /* ONE_VOICE_IS_THE_HOST — a second tag would demand a second voice
   * assignment before the project could generate at all. */
  it("narrates everything as the host", () => {
    for (const segment of planQuizNarration({
      questions: QUESTIONS,
      countdownSec: 5,
    })) {
      expect(segment.speakerTag).toBe(QUIZ_SPEAKER_TAG);
    }
  });

  it("maps the beats onto script sections", () => {
    const segments = planQuizNarration({ questions: QUESTIONS, countdownSec: 5 });
    expect(segments[0]?.sectionType).toBe("hook");
    expect(segments[1]?.sectionType).toBe("body");
    expect(segments.at(-1)?.sectionType).toBe("cta");
  });

  /* QUIZ_NARRATION_IS_PLANNED_ONCE — the writer and the generator both call
   * this, so two calls on the same settings have to be identical text for
   * identical text. */
  it("is deterministic", () => {
    const settings = {
      questions: QUESTIONS,
      countdownSec: 5,
      topic: "Planets and oceans",
    };
    expect(planQuizNarration(settings)).toEqual(planQuizNarration(settings));
  });

  it("names the question number in words and never in digits", () => {
    const segments = planQuizNarration({ questions: QUESTIONS, countdownSec: 5 });
    const questions = segments.filter((segment) => segment.role === "question");

    expect(questions[0]?.narrationText).toBe(
      "Question one. Which planet has the shortest day?",
    );
    /* ORDINALS_ARE_SPOKEN — a digit is read differently by different voices,
     * and it is also a token the aligner has to match against what was said. */
    for (const segment of segments) {
      expect(segment.narrationText).not.toMatch(/\d/);
    }
  });

  it("states the answer before any explanation", () => {
    const reveals = planQuizNarration({
      questions: QUESTIONS,
      countdownSec: 5,
    }).filter((segment) => segment.role === "reveal");

    expect(reveals[0]?.narrationText).toBe("The answer is Jupiter.");
    expect(reveals[1]?.narrationText).toBe(
      "The answer is Pacific. The Mariana Trench is in it.",
    );
  });

  it("opens with the question count and the topic when there is one", () => {
    expect(
      planQuizNarration({
        questions: QUESTIONS,
        countdownSec: 5,
        topic: "Planets and oceans",
      })[0]?.narrationText,
    ).toBe("Two questions on Planets and oceans. How many can you get?");

    expect(
      planQuizNarration({ questions: QUESTIONS, countdownSec: 5 })[0]
        ?.narrationText,
    ).toBe("Two questions. How many can you get?");
  });

  it("plans nothing for an empty set", () => {
    expect(planQuizNarration({ questions: [], countdownSec: 5 })).toEqual([]);
  });

  /* PHONETICS_ARE_SPOKEN_NOT_SHOWN — the phase's fifth "done when" check, and
   * the half of it this module owns: the narration says "sequel" while the
   * question the card draws is untouched. */
  it("respells an overridden term in the spoken copy only", () => {
    const [, question] = planQuizNarration({
      questions: [
        {
          question: "Which SQL keyword removes a table?",
          options: ["DROP", "DELETE", "TRUNCATE", "REMOVE"],
          correctIndex: 0,
          phonetics: { SQL: "sequel" },
        },
      ],
      countdownSec: 5,
    });

    expect(question?.narrationText).toBe(
      "Question one. Which sequel keyword removes a table?",
    );
  });
});

describe("applyPhonetics", () => {
  it("returns the text untouched when there are no overrides", () => {
    expect(applyPhonetics("Plain text.", undefined)).toBe("Plain text.");
    expect(applyPhonetics("Plain text.", {})).toBe("Plain text.");
  });

  /* LONGEST_TERM_FIRST. Replacing the short term first would turn "SQL Server"
   * into "sequel Server" and the longer override would never match anything —
   * a failure that is completely silent. */
  it("applies the longest matching term first", () => {
    expect(
      applyPhonetics("Is SQL Server the same as SQL?", {
        SQL: "sequel",
        "SQL Server": "sequel server",
      }),
    ).toBe("Is sequel server the same as sequel?");
  });

  /* A substring override is how "GIF" inside "GIFT" becomes "jift". */
  it("matches whole words only", () => {
    expect(applyPhonetics("A GIFT, not a GIF.", { GIF: "jif" })).toBe(
      "A GIFT, not a jif.",
    );
  });

  it("matches regardless of case", () => {
    expect(applyPhonetics("sql and Sql", { SQL: "sequel" })).toBe(
      "sequel and sequel",
    );
  });

  /* An override is customer input, so a term containing a regex metacharacter
   * must be a replacement rather than a thrown exception inside a generation.
   * The explicit boundaries are also what keep a dotted term whole. */
  it("treats a term with punctuation as literal text", () => {
    expect(applyPhonetics("Built on Node.js today", { "Node.js": "node jay ess" })).toBe(
      "Built on node jay ess today",
    );
    expect(() => applyPhonetics("C++ (fast)", { "C++": "see plus plus" })).not.toThrow();
    expect(applyPhonetics("C++ is fast", { "C++": "see plus plus" })).toBe(
      "see plus plus is fast",
    );
  });

  it("ignores an override with an empty spoken form", () => {
    expect(applyPhonetics("Keep SQL", { SQL: "   " })).toBe("Keep SQL");
  });
});
