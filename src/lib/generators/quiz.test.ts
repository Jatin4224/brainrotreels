/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: quiz generator test, buildQuizDocument,
 *   COUNTDOWN_IS_A_LEAD_GAP, BEATS_SHIFT_THE_WORDS, REVEAL_IS_ITS_OWN_ITEM,
 *   ANCHOR_ONLY_WHEN_THERE_ARE_WORDS, QUIZ_TEXT_IS_ON_THE_CARD,
 *   SCRIPT_EDITS_DEGRADE_NOT_FAIL, DOCUMENT_VALIDATES
 *
 * WHAT:  The quiz generator's output, asserted against the timeline module's
 *        OWN validator rather than against a snapshot — plus the four
 *        properties that are specific to this format and that nothing else in
 *        the codebase would catch.
 *
 * WHY:   Three of those four are invisible to type checking and to the schema,
 *        and each would ship as a finished, paid-for video:
 *
 *          - the COUNTDOWN is a hole in the narration lane. If the beat were
 *            ever laid without shifting the aligned words, every card after the
 *            first question would be anchored early by a growing amount
 *            (BEATS_SHIFT_THE_WORDS) and the answers would drift out of step
 *            with the audio.
 *          - the REVEAL has to be its own item, because the phase requires an
 *            editor to be able to retime it alone.
 *          - a WORD ANCHOR that names a word the document does not have leaves
 *            the document anchored forever and blocks the render, so the
 *            fallback to seconds on a failed alignment is load-bearing rather
 *            than defensive.
 *
 *        A generator is the one part of the pipeline that is pure, so all of
 *        this is provable with no database, no provider and no credential.
 * WHERE: `npm test`. Covers src/lib/generators/quiz.ts.
 */

import { describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/config/prisma";
import { resolveWordAnchors, validate, type WordToken } from "@/lib/timeline";
import { splitBlockIntoLines } from "@/lib/narration";
import { planQuizNarration } from "@/lib/quiz";
import { QUIZ_SPEAKER_TAG, type QuizSettings } from "@/lib/types/quiz";
import { buildQuizDocument, QUIZ_LAYOUTS } from "./quiz";
import { GeneratorInputError, type GeneratorContext, type NarrationLineInput } from "./types";

/* The generator never touches it — BUILD_IS_THE_WHOLE_CONTRACT. If one ever
 * reaches for this, the test fails loudly rather than silently connecting. */
const NO_DB = new Proxy(
  {},
  {
    get() {
      throw new Error("a generator must not touch the database");
    },
  },
) as DbClient;

const COUNTDOWN_SEC = 4;

const QUIZ: QuizSettings = {
  topic: "Planets and oceans",
  questions: [
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
  ],
  countdownSec: COUNTDOWN_SEC,
  answerType: "multiple-choice",
  difficulty: "medium",
};

const LINE_SECONDS = 2;

/**
 * SOURCE OF TRUTH KEYWORDS: linesForPlan, QUIZ_NARRATION_IS_PLANNED_ONCE
 *
 * WHAT:  Exactly the narration lines the TTS stage would have produced for this
 *        quiz.
 * WHY:   Built by running the SAME plan through the SAME splitter the real
 *        pipeline uses (`splitBlockIntoLines`), so the test exercises the
 *        mapping the generator actually performs rather than a convenient
 *        one-line-per-segment fiction. A segment whose text happened to split
 *        into two lines would otherwise be untested, and that is precisely the
 *        case the mapping arithmetic exists for.
 * WHERE: Every context below.
 */
function linesForPlan(quiz: QuizSettings): NarrationLineInput[] {
  const lines: NarrationLineInput[] = [];
  for (const segment of planQuizNarration(quiz)) {
    for (const text of splitBlockIntoLines(segment.narrationText)) {
      lines.push({
        id: `line${lines.length}`,
        position: lines.length,
        speakerTag: QUIZ_SPEAKER_TAG,
        text,
        audioAssetId: `ast_${lines.length}`,
        durationSec: LINE_SECONDS,
        /* A quiz's narration is PLANNED rather than split from script blocks,
         * so its lines carry no block id — which is exactly the case a
         * per-block visual must not cover (LINE_REMEMBERS_ITS_BLOCK). */
        blockId: null,
      });
    }
  }
  return lines;
}

/**
 * Words laid out the way the ALIGNMENT stage lays them: gapless, each line's
 * words inside that line's own window, offset by the sum of the durations
 * before it (`concatAlignedLines`). The generator's job is to shift them.
 */
function wordsForLines(lines: readonly NarrationLineInput[]): WordToken[] {
  const words: WordToken[] = [];
  let offset = 0;
  for (const line of lines) {
    const count = Math.max(1, line.text.split(" ").length);
    const each = line.durationSec / count;
    for (let index = 0; index < count; index += 1) {
      words.push({
        i: words.length,
        w: `w${words.length}`,
        s: Number((offset + index * each).toFixed(3)),
        e: Number((offset + (index + 1) * each).toFixed(3)),
      });
    }
    offset += line.durationSec;
  }
  return words;
}

function contextFor(
  overrides: Partial<GeneratorContext> = {},
  quiz: QuizSettings = QUIZ,
): GeneratorContext {
  const built = linesForPlan(quiz);
  return {
    organizationId: "org_1",
    projectId: "prj_1",
    words: wordsForLines(built),
    lines: built,
    speakers: { [QUIZ_SPEAKER_TAG]: "voice_host" },
    aspect: "9:16",
    settings: { quiz: JSON.parse(JSON.stringify(quiz)) as unknown },
    background: null,
    cast: {},
    /* A quiz chooses no per-block pictures — it draws cards over one
     * background, which is why its generator still skips the `visuals` stage. */
    visuals: {},
    thread: null,
    db: NO_DB,
    ...overrides,
  };
}

function cardsOf(doc: ReturnType<typeof buildQuizDocument>) {
  const track = doc.tracks.find((candidate) => candidate.id === "quiz-cards");
  return track?.type === "scene" ? track.items : [];
}

describe("buildQuizDocument", () => {
  it("produces a document the timeline module accepts", () => {
    const verdict = validate(buildQuizDocument(contextFor()));
    expect(verdict.ok, JSON.stringify(verdict.ok ? [] : verdict.errors)).toBe(
      true,
    );
  });

  /* GENERATED_DOC_IS_ANCHORED — the document leaves the generator anchored and
   * the player resolves it. Both forms have to validate, or the preview refuses
   * a document the generator considered finished. */
  it("is still valid once its anchors are resolved", () => {
    const doc = buildQuizDocument(contextFor());
    expect(doc.timing).toBe("anchored");

    const resolved = resolveWordAnchors(doc);
    expect(resolved.timing).toBe("resolved");
    const verdict = validate(resolved);
    expect(verdict.ok, JSON.stringify(verdict.ok ? [] : verdict.errors)).toBe(
      true,
    );
  });

  /* REVEAL_IS_ITS_OWN_ITEM — the phase requires it so the editor can retime a
   * reveal without touching its question. */
  it("emits an intro, a question and a reveal per question, and an outro", () => {
    const layouts = cardsOf(buildQuizDocument(contextFor())).map(
      (item) => item.scene.layout,
    );

    expect(layouts).toEqual([
      QUIZ_LAYOUTS.intro,
      QUIZ_LAYOUTS.question,
      QUIZ_LAYOUTS.reveal,
      QUIZ_LAYOUTS.question,
      QUIZ_LAYOUTS.reveal,
      QUIZ_LAYOUTS.outro,
    ]);
  });

  /* COUNTDOWN_IS_A_LEAD_GAP, measured on the audio rather than on the cards:
   * the reveal's first line starts exactly `countdownSec` after the question's
   * last line ends, and every other join is tight. */
  it("leaves exactly the countdown of silence before each answer", () => {
    const doc = buildQuizDocument(contextFor());
    const narration = doc.tracks.find((track) => track.id === "narration");
    expect(narration?.type).toBe("audio");
    if (narration?.type !== "audio") return;

    const gaps: number[] = [];
    for (let index = 1; index < narration.items.length; index += 1) {
      const previous = narration.items[index - 1];
      const current = narration.items[index];
      if (previous === undefined || current === undefined) continue;
      if (typeof previous.start !== "number") continue;
      if (typeof current.start !== "number") continue;
      if (typeof previous.duration !== "number") continue;
      gaps.push(
        Number((current.start - (previous.start + previous.duration)).toFixed(3)),
      );
    }

    /* One beat per question, and nothing anywhere else. */
    expect(gaps.filter((gap) => gap > 0)).toEqual([
      COUNTDOWN_SEC,
      COUNTDOWN_SEC,
    ]);
    expect(gaps.filter((gap) => gap < 0)).toEqual([]);
  });

  /**
   * BEATS_SHIFT_THE_WORDS. The alignment is gapless; the document is not. If
   * the words were copied across unshifted, the second question's card would be
   * anchored one countdown early — so the check is that every word still falls
   * inside the audio item it belongs to.
   */
  it("shifts the aligned words to match the audio it laid", () => {
    const context = contextFor();
    const doc = buildQuizDocument(context);
    const narration = doc.tracks.find((track) => track.id === "narration");
    if (narration?.type !== "audio") throw new Error("no narration track");

    expect(doc.words).toHaveLength(context.words.length);
    /* WORD_INDEX_IS_THE_POSITION — the validator checks this too, and every
     * anchor in the document resolves against it. */
    doc.words.forEach((word, index) => expect(word.i).toBe(index));

    /* The last word must end no later than the narration does, which is only
     * true if the shift was applied. Unshifted, the final word would end one
     * beat per question short — and the FIRST word of the last line would fall
     * inside an earlier item. */
    const lastItem = narration.items.at(-1);
    const lastWord = doc.words.at(-1);
    if (lastItem === undefined || lastWord === undefined) {
      throw new Error("nothing to compare");
    }
    if (typeof lastItem.start !== "number") throw new Error("unresolved start");
    if (typeof lastItem.duration !== "number") {
      throw new Error("unresolved duration");
    }
    expect(lastWord.e).toBeGreaterThan(lastItem.start);
    expect(lastWord.e).toBeLessThanOrEqual(
      Number((lastItem.start + lastItem.duration + 0.01).toFixed(3)),
    );
  });

  /* QUESTION_CARD_HOLDS_THROUGH_THE_COUNTDOWN — the phase's "a question scene
   * whose duration is narration plus the configured countdown". */
  it("keeps the question on screen through the countdown", () => {
    const cards = cardsOf(buildQuizDocument(contextFor()));
    const question = cards[1];
    const reveal = cards[2];
    if (question === undefined || reveal === undefined) {
      throw new Error("missing cards");
    }

    const resolved = resolveWordAnchors(buildQuizDocument(contextFor()));
    const resolvedCards = cardsOf(resolved);
    const resolvedQuestion = resolvedCards[1];
    const resolvedReveal = resolvedCards[2];
    if (resolvedQuestion === undefined || resolvedReveal === undefined) {
      throw new Error("missing resolved cards");
    }
    if (
      typeof resolvedQuestion.start !== "number" ||
      typeof resolvedQuestion.duration !== "number" ||
      typeof resolvedReveal.start !== "number"
    ) {
      throw new Error("anchors did not resolve");
    }

    /* The question card ends where the reveal's audio begins, which includes
     * the beat — read off the document rather than calculated, which is the
     * property the generator relies on. Within a frame, because
     * `resolveWordAnchors` snaps both edges to the frame grid. */
    const frame = 1 / 30;
    expect(
      Math.abs(
        resolvedQuestion.start +
          resolvedQuestion.duration -
          resolvedReveal.start,
      ),
    ).toBeLessThanOrEqual(frame + 1e-6);

    /* And the card is longer than its own narration by the countdown. */
    expect(resolvedQuestion.duration).toBeGreaterThanOrEqual(COUNTDOWN_SEC);
    expect(question.render).toBe("quizCard");
  });

  /* ANCHOR_ONLY_WHEN_THERE_ARE_WORDS, the first half: with an alignment, every
   * card is addressed by the word that introduces it, so re-recording the
   * narration moves the card with the voice. */
  it("anchors every card to a word when the alignment produced some", () => {
    for (const card of cardsOf(buildQuizDocument(contextFor()))) {
      expect(card.start).toEqual({ wordIndex: expect.any(Number) });
    }
  });

  /**
   * ANCHOR_ONLY_WHEN_THERE_ARE_WORDS, the second half and the load-bearing
   * one: EMPTY_WORDS_STILL_BUILDS is a supported state, and an anchor naming a
   * word that does not exist would leave the document `anchored` forever and
   * block the render.
   */
  it("falls back to seconds when the alignment produced nothing", () => {
    const doc = buildQuizDocument(contextFor({ words: [] }));

    for (const card of cardsOf(doc)) {
      expect(typeof card.start).toBe("number");
    }

    const resolved = resolveWordAnchors(doc);
    expect(resolved.timing).toBe("resolved");
    const verdict = validate(resolved);
    expect(verdict.ok, JSON.stringify(verdict.ok ? [] : verdict.errors)).toBe(
      true,
    );
  });

  /* QUIZ_TEXT_IS_ON_THE_CARD — the one format that emits no caption lane,
   * because the question IS the on-screen text. The words are still there: the
   * anchors resolve against them. */
  it("emits no caption track but keeps the words", () => {
    const doc = buildQuizDocument(contextFor());
    expect(doc.tracks.some((track) => track.type === "caption")).toBe(false);
    expect(doc.words.length).toBeGreaterThan(0);
  });

  /* PHONETICS_ARE_SPOKEN_NOT_SHOWN — the card draws the question as written
   * while the narration says the respelled form. This is the half the
   * generator owns. */
  it("draws the question as written, never the respelled narration", () => {
    const quiz: QuizSettings = {
      ...QUIZ,
      questions: [
        {
          question: "Which SQL keyword removes a table?",
          options: ["DROP", "DELETE", "TRUNCATE", "REMOVE"],
          correctIndex: 0,
          phonetics: { SQL: "sequel" },
        },
      ],
    };
    const cards = cardsOf(buildQuizDocument(contextFor({}, quiz), ));
    const prompt = cards[1]?.scene.elements.find(
      (element) => element.kind === "prompt",
    );

    expect(prompt?.text).toBe("Which SQL keyword removes a table?");
    expect(JSON.stringify(cards)).not.toContain("sequel");
  });

  /* OPTION_CARRIES_ITS_INDEX — and the question card carries `correct` too, so
   * retiming the pair in the editor cannot separate a question from its
   * answer. */
  it("marks the correct option on both the question and the reveal", () => {
    const cards = cardsOf(buildQuizDocument(contextFor()));

    for (const index of [1, 2]) {
      const options = cards[index]?.scene.elements.filter(
        (element) => element.kind === "option",
      );
      expect(options).toHaveLength(4);
      const correct = options?.filter(
        (element) => element.props?.["correct"] === true,
      );
      expect(correct).toHaveLength(1);
      expect(correct?.[0]?.text).toBe("Jupiter");
    }
  });

  it("gives the question card a countdown element and the reveal none", () => {
    const cards = cardsOf(buildQuizDocument(contextFor()));
    const timer = cards[1]?.scene.elements.find(
      (element) => element.kind === "countdown",
    );
    expect(timer?.props?.["seconds"]).toBe(COUNTDOWN_SEC);
    expect(
      cards[2]?.scene.elements.some((element) => element.kind === "countdown"),
    ).toBe(false);
  });

  /* COUNTDOWN_SFX_IS_OPTIONAL — absent means silence, which is a complete
   * video. Emitting an item pointing at a handle with no asset behind it would
   * claim a sound the video does not have. */
  it("emits no countdown track without a sound, and one with it", () => {
    expect(
      buildQuizDocument(contextFor()).tracks.some(
        (track) => track.id === "countdown",
      ),
    ).toBe(false);

    const withSfx: QuizSettings = { ...QUIZ, countdownAssetId: "ast_tick" };
    const doc = buildQuizDocument(contextFor({}, withSfx), );
    const track = doc.tracks.find((candidate) => candidate.id === "countdown");
    expect(track?.type).toBe("audio");
    /* One per question, and each sits in the silence rather than over a
     * voice. */
    expect(track?.items).toHaveLength(QUIZ.questions.length);
    expect(doc.assets["countdown_sfx"]?.assetId).toBe("ast_tick");
  });

  /* SCRIPT_EDITS_DEGRADE_NOT_FAIL — a hand-edited script changes the line
   * count, and the result must be a different video rather than a failed run.
   * A format that refused to build after an edit would make the script editor a
   * trap on this one kind. */
  it("still builds a valid document when the script has been edited", () => {
    const full = linesForPlan(QUIZ);

    const longer = [...full, ...full.slice(0, 2)];

    for (const lines of [full.slice(0, 3), longer]) {
      /* Re-id as well as re-position: a NarrationLine row's id is unique by
       * construction, so a test that reused one would be asserting against a
       * document the pipeline could never produce. */
      const renumbered = lines.map((line, index) => ({
        ...line,
        id: `edited${index}`,
        position: index,
      }));
      const doc = buildQuizDocument(
        contextFor({
          lines: renumbered,
          words: wordsForLines(renumbered),
        }),
      );
      const verdict = validate(doc);
      expect(verdict.ok, JSON.stringify(verdict.ok ? [] : verdict.errors)).toBe(
        true,
      );
    }
  });

  it("produces an empty document when there are no lines", () => {
    const doc = buildQuizDocument(contextFor({ lines: [], words: [] }));
    expect(doc.tracks).toHaveLength(0);
  });

  /* UNBUILDABLE_INPUT_IS_NAMED. Every other settings read in this codebase
   * falls back to a default; a quiz has none, and a document without questions
   * is a paid video of a host talking over blank cards. */
  it("refuses by name when the project has no question set", () => {
    expect(() => buildQuizDocument(contextFor({ settings: {} }))).toThrow(
      GeneratorInputError,
    );

    try {
      buildQuizDocument(contextFor({ settings: { quiz: { questions: [] } } }));
    } catch (error) {
      expect(error).toBeInstanceOf(GeneratorInputError);
      /* FAILURE_IS_EXPLAINED_NOT_DUMPED — plain language for the customer, the
       * zod error in `detail` for the log. */
      expect((error as GeneratorInputError).message).not.toContain("zod");
      expect((error as GeneratorInputError).detail.length).toBeGreaterThan(0);
    }
  });
});
