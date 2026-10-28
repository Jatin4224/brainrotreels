/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: planQuizNarration, QuizSegment, QuizSegmentRole,
 *   applyPhonetics, QUIZ_NARRATION_IS_PLANNED_ONCE, COUNTDOWN_IS_A_LEAD_GAP,
 *   PHONETICS_ARE_SPOKEN_NOT_SHOWN, QUIZ_NARRATION_IS_PURE
 *
 * WHAT:  A question set as the ordered list of spoken beats a quiz video is
 *        made of — the intro, then a question and a reveal for each question,
 *        then the outro — with the countdown recorded as the silence BEFORE
 *        each reveal.
 *
 * WHY:   QUIZ_NARRATION_IS_PLANNED_ONCE is the decision this whole module
 *        exists for, and it is the answer to a problem the Reddit format never
 *        had. A quiz generator cannot look at `ctx.lines` and tell which line
 *        was a question and which was a reveal: a line carries its text, its
 *        speaker and its duration, and a quiz has ONE speaker
 *        (ONE_VOICE_IS_THE_HOST), so there is no tag to read it off. Guessing
 *        from the text — "does this line start with 'the answer is'" — would
 *        make the timeline depend on narration copy that somebody is free to
 *        edit.
 *
 *        So the plan is computed from `settings.quiz`, which both halves have:
 *        the WRITER turns these segments into script blocks, and the GENERATOR
 *        re-derives the identical list and walks `ctx.lines` against it. One
 *        function, two callers, and the mapping from a line back to its
 *        question is arithmetic rather than inference.
 *
 *        COUNTDOWN_IS_A_LEAD_GAP, and this is the part worth understanding
 *        before changing anything here. The phase requires a thinking beat
 *        with "music or ticking and NO SPEECH" between the question and the
 *        reveal — so the narration has to have a hole in it. Three places
 *        could have put one there and two of them are wrong:
 *
 *          - the TTS seam, with SSML. The adapter's contract says in so many
 *            words that it has no SSML and no streaming, deliberately, and
 *            widening it for one format would make every future provider owe
 *            an SSML implementation.
 *          - the narration and alignment stages, by storing a gap per line.
 *            `layNarration` and `concatAlignedLines` both accumulate measured
 *            durations with no gaps, and they have to AGREE about where line
 *            four starts (NARRATION_IS_SEQUENTIAL) — so a gap there is two
 *            shared pipeline edits plus a column, to express something only
 *            one format wants.
 *          - the GENERATOR, which is where it lives. A gap is a layout
 *            decision about a document, the generator is the thing that lays
 *            documents out, and it already shifts the word timings it emits by
 *            the same amount so the document stays internally consistent. The
 *            alignment stays gapless and stays correct for its own purpose.
 *
 *        So this module only says HOW LONG the silence is and WHERE; nothing
 *        here touches audio.
 *
 *        PHONETICS_ARE_SPOKEN_NOT_SHOWN. The spoken copy is respelled and the
 *        card is not, which is why `narrationText` here is derived from the
 *        question rather than being the question. See the same keyword in
 *        src/lib/types/quiz.ts for why that is the only arrangement that is
 *        right on both channels.
 *
 *        QUIZ_NARRATION_IS_PURE — no database, no provider, no clock, no
 *        Remotion. It is imported by a server-only writer AND by a pure
 *        generator (GENERATORS_STAY_PURE), so it may import neither.
 * WHERE: src/lib/script/quiz.ts (the writer) and
 *        src/lib/generators/quiz.ts (the document build).
 */

import {
  QUIZ_SPEAKER_TAG,
  type QuizQuestion,
  type QuizSettings,
} from "@/lib/types/quiz";

/**
 * SOURCE OF TRUTH KEYWORDS: QuizSegmentRole, SEGMENTS_ARE_THE_SHOTS
 *
 * WHAT:  What kind of beat a segment is.
 * WHY:   SEGMENTS_ARE_THE_SHOTS — this list IS the quiz's shot order, and it is
 *        a closed union so the generator's switch over it is exhaustive. A
 *        format that grew a fifth kind of card would add it here and the
 *        compiler would name every place that has to draw it.
 *
 *        There is deliberately no `countdown` role. The countdown is not a beat
 *        with narration of its own — it is the SILENCE before a reveal, and it
 *        is recorded as `leadSilenceSec` on the reveal segment
 *        (COUNTDOWN_IS_A_LEAD_GAP). A role with no text would be a script block
 *        with nothing to say, which the block schema rightly refuses.
 * WHERE: `QuizSegment.role`.
 */
export const QUIZ_SEGMENT_ROLES = [
  "intro",
  "question",
  "reveal",
  "outro",
] as const;

export type QuizSegmentRole = (typeof QUIZ_SEGMENT_ROLES)[number];

/**
 * SOURCE OF TRUTH KEYWORDS: QuizSegment, SEGMENT_CARRIES_ITS_QUESTION
 *
 * WHAT:  One spoken beat of a quiz.
 *
 * WHY:   SEGMENT_CARRIES_ITS_QUESTION. `questionIndex` is null for the intro
 *        and the outro rather than `-1` or `0`, because the generator uses it
 *        to look the question up and a sentinel index would read a question
 *        that exists. Null is a value a type checker makes somebody handle.
 *
 *        `sectionType` is here so the writer does not have to map roles to
 *        script sections at its callsite: the hook, the body and the call to
 *        action are a property of the beat, and the mapping is a fact about the
 *        format rather than a decision the writer makes.
 * WHERE: Returned by `planQuizNarration`.
 */
export interface QuizSegment {
  role: QuizSegmentRole;
  /** Which question this beat belongs to; null for the intro and the outro. */
  questionIndex: number | null;
  /** What the host says, already respelled for pronunciation. */
  narrationText: string;
  /** The script section this beat belongs to. */
  sectionType: "hook" | "body" | "cta";
  /**
   * COUNTDOWN_IS_A_LEAD_GAP — the silence the generator leaves BEFORE this
   * beat's audio. Non-zero only on a reveal.
   */
  leadSilenceSec: number;
  /** Always the host — ONE_VOICE_IS_THE_HOST. */
  speakerTag: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_ORDINALS, ORDINALS_ARE_SPOKEN
 *
 * WHAT:  How a question number is said out loud.
 * WHY:   ORDINALS_ARE_SPOKEN. "Question 1." is read by some voices as
 *        "question one" and by others as "question first" or with an audible
 *        stumble, and the one thing a quiz's first three words cannot be is
 *        unclear. Spelling them means the narration text contains no digits at
 *        all, which is also what keeps the aligner's tokens matching the words
 *        the voice actually said.
 *
 *        It covers exactly `QUIZ_MAX_QUESTIONS` entries, and `questionLabel`
 *        falls back to the digits past the end rather than crashing — a cap
 *        raised without extending this list produces a slightly worse reading,
 *        not a failed generation.
 * WHERE: `questionLabel`.
 */
const QUIZ_ORDINALS: readonly string[] = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

function questionLabel(index: number): string {
  return QUIZ_ORDINALS[index] ?? String(index + 1);
}

/**
 * SOURCE OF TRUTH KEYWORDS: applyPhonetics, PHONETICS_ARE_SPOKEN_NOT_SHOWN,
 *   LONGEST_TERM_FIRST
 *
 * WHAT:  The same sentence with each overridden term respelled the way it
 *        should be said.
 *
 * WHY:   LONGEST_TERM_FIRST is the only subtle thing here, and getting it
 *        wrong is silent. With `{ "SQL": "sequel", "SQL Server": "sequel
 *        server" }`, replacing the short term first turns "SQL Server" into
 *        "sequel Server" and the longer override never matches anything. So
 *        the terms are sorted by length descending and applied in that order.
 *
 *        Matching is WHOLE-WORD and case-insensitive. Case-insensitive because
 *        somebody writing an override types the term as it appears on the card
 *        and the narration may have sentence-cased it; whole-word because a
 *        substring override is how "GIF" inside "GIFT" becomes "jift". The
 *        boundaries are explicit rather than `\b`, since `\b` treats a hyphen
 *        and a period as word boundaries and a term like "Node.js" would then
 *        match only its first half.
 *
 *        Every term is regex-escaped. An override is customer input, and a term
 *        containing `(` is a thrown exception inside a generation otherwise.
 *
 *        Returns the text unchanged when there are no overrides, which is the
 *        overwhelmingly common case — a quiz about football needs none.
 * WHERE: Every `narrationText` this module produces.
 */
export function applyPhonetics(
  text: string,
  phonetics: Readonly<Record<string, string>> | undefined,
): string {
  if (phonetics === undefined) return text;

  const terms = Object.keys(phonetics)
    .filter((term) => term.trim().length > 0)
    /* LONGEST_TERM_FIRST — see the header. */
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0) return text;

  let result = text;
  for (const term of terms) {
    const spoken = phonetics[term];
    if (spoken === undefined || spoken.trim().length === 0) continue;

    /* Explicit boundaries rather than `\b`: a term may legitimately contain a
     * period, a hyphen or a plus, and `\b` would cut it in half. */
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9])(${escapeForRegExp(term)})(?=$|[^A-Za-z0-9])`,
      "gi",
    );
    result = result.replace(pattern, (_match, prefix: string) =>
      `${prefix}${spoken}`,
    );
  }

  return result;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * SOURCE OF TRUTH KEYWORDS: planQuizNarration, QUIZ_NARRATION_IS_PLANNED_ONCE
 *
 * WHAT:  The whole quiz as an ordered list of spoken beats.
 *
 * WHY:   DETERMINISTIC in the strongest sense: the same settings produce the
 *        same segments, in the same order, with the same text, every time it is
 *        called. That is not a nicety — the generator calls this to work out
 *        which narration LINE belongs to which question, and a plan that
 *        differed between the writer's call and the generator's call would
 *        attribute every line to the wrong card.
 *
 *        The intro NAMES THE COUNT, which is the one thing an intro card is for
 *        — "ten questions" sets the length expectation that decides whether
 *        somebody stays. The topic is used when there is one and omitted
 *        cleanly when there is not, rather than narrating an empty string.
 *
 *        The question beat reads the question and NOT the options, even for a
 *        multiple-choice quiz. Reading four options aloud costs eight or ten
 *        seconds of the fifteen a question gets, and the options are ON THE
 *        CARD where they can be read far faster than they can be heard
 *        (QUIZ_TEXT_IS_ON_THE_CARD in the generator). An `open` quiz has
 *        nothing to read either way.
 *
 *        The reveal states the answer and then the explanation, in that order,
 *        because the answer is what the viewer is waiting for and an
 *        explanation first is a spoiler with extra steps.
 *
 *        The outro is a CTA and is deliberately NOT branded. It says what this
 *        video wants, which is engagement, and a product name in narration
 *        would be a watermark the customer did not ask for.
 * WHERE: SCRIPT_WRITERS['quiz'] and buildQuizDocument.
 */
export function planQuizNarration(
  settings: Pick<
    QuizSettings,
    "questions" | "countdownSec" | "topic"
  >,
): QuizSegment[] {
  const segments: QuizSegment[] = [];
  const total = settings.questions.length;
  if (total === 0) return segments;

  const topic = settings.topic?.trim() ?? "";

  segments.push({
    role: "intro",
    questionIndex: null,
    sectionType: "hook",
    narrationText:
      topic.length > 0
        ? `${countLabel(total)} on ${topic}. How many can you get?`
        : `${countLabel(total)}. How many can you get?`,
    leadSilenceSec: 0,
    speakerTag: QUIZ_SPEAKER_TAG,
  });

  for (const [index, question] of settings.questions.entries()) {
    segments.push({
      role: "question",
      questionIndex: index,
      sectionType: "body",
      narrationText: applyPhonetics(
        `Question ${questionLabel(index)}. ${question.question}`,
        question.phonetics,
      ),
      leadSilenceSec: 0,
      speakerTag: QUIZ_SPEAKER_TAG,
    });

    segments.push({
      role: "reveal",
      questionIndex: index,
      sectionType: "body",
      narrationText: applyPhonetics(
        revealText(question),
        question.phonetics,
      ),
      /* COUNTDOWN_IS_A_LEAD_GAP — the thinking beat sits here, before the
       * answer is spoken, and carries no narration of its own. */
      leadSilenceSec: settings.countdownSec,
      speakerTag: QUIZ_SPEAKER_TAG,
    });
  }

  segments.push({
    role: "outro",
    questionIndex: null,
    sectionType: "cta",
    narrationText: "How many did you get? Follow for more.",
    leadSilenceSec: 0,
    speakerTag: QUIZ_SPEAKER_TAG,
  });

  return segments;
}

/**
 * SOURCE OF TRUTH KEYWORDS: revealText, ANSWER_BEFORE_EXPLANATION
 *
 * WHAT:  What the host says when the answer appears.
 * WHY:   ANSWER_BEFORE_EXPLANATION — see `planQuizNarration`. A question whose
 *        `correctIndex` does not name an option is already refused by
 *        `checkQuizSet`, so the fallback here is for a settings blob written by
 *        an older release: it says the answer is on screen rather than naming
 *        `undefined`, which is the honest degradation of a video that is
 *        otherwise fine.
 * WHERE: `planQuizNarration`.
 */
function revealText(question: QuizQuestion): string {
  const correct = question.options[question.correctIndex];
  const answer =
    correct === undefined
      ? "Here is the answer."
      : `The answer is ${correct}.`;
  const explanation = question.explanation?.trim() ?? "";
  return explanation.length > 0 ? `${answer} ${explanation}` : answer;
}

/**
 * SOURCE OF TRUTH KEYWORDS: countLabel, THE_INTRO_OPENS_A_SENTENCE
 *
 * WHAT:  "Ten questions", for the front of the intro line.
 * WHY:   THE_INTRO_OPENS_A_SENTENCE — this is the first thing said in the
 *        video, so it is capitalised here rather than at the callsite. A
 *        lower-case opening is invisible in audio but wrong in the script
 *        editor, where the customer reads the same text back.
 * WHERE: `planQuizNarration`'s intro segment.
 */
function countLabel(total: number): string {
  const spelled = QUIZ_ORDINALS[total - 1] ?? String(total);
  const capitalised = `${spelled.slice(0, 1).toUpperCase()}${spelled.slice(1)}`;
  return total === 1 ? `${capitalised} question` : `${capitalised} questions`;
}
