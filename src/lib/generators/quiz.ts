/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: quizGenerator, buildQuizDocument, QUIZ_ELEMENT_KINDS,
 *   QUIZ_LAYOUTS, QUIZ_SKIPS, REVEAL_IS_ITS_OWN_ITEM, ANCHOR_ONLY_WHEN_THERE_ARE_WORDS,
 *   QUIZ_TEXT_IS_ON_THE_CARD, COUNTDOWN_IS_A_LEAD_GAP, SCRIPT_EDITS_DEGRADE_NOT_FAIL,
 *   COMPOSED_FROM_COMMON
 *
 * WHAT:  The quiz format: an intro card, then a question card and a separate
 *        reveal card for each question, then an outro, over a looping
 *        background with the host narrating and a silent countdown between
 *        each question and its answer.
 *
 * WHY:   COMPOSED_FROM_COMMON, as the Reddit story is. The narration lane, the
 *        background, the music bed, the cast record and the settings read are
 *        ./common.ts and each decision is documented where its code is. What
 *        makes this format itself is four things: the CARDS, the silent
 *        COUNTDOWN, the WORD ANCHORS that fire the reveal, and the absence of a
 *        caption lane.
 *
 *        REVEAL_IS_ITS_OWN_ITEM is the phase's step 3, stated as a
 *        requirement — "keeping the reveal as its own item is what lets the
 *        editor retime a reveal without touching the question" — and it is the
 *        decision that shapes everything else here. The obvious build is one
 *        card per question that changes what it draws partway through, and it
 *        is wrong for a reason that only shows up in Phase 15: an editor can
 *        only move what the document names, and a reveal buried inside a
 *        question item is not addressable. Two items, back to back, on one
 *        scene track.
 *
 *        COUNTDOWN_IS_A_LEAD_GAP. The thinking beat is silence BEFORE the
 *        reveal's audio, asked for through `layNarration`'s `beatBeforeLine`.
 *        The question CARD spans its own narration plus that silence — which
 *        is the phase's "a question scene whose duration is narration plus the
 *        configured countdown", arrived at without the generator computing any
 *        durations of its own: it reads where the reveal's audio actually
 *        landed and ends the question card there. The full argument for the
 *        beat living in the generator rather than in the TTS seam or the
 *        alignment stage is under the same keyword in src/lib/quiz/narration.ts.
 *
 *        ANCHOR_ONLY_WHEN_THERE_ARE_WORDS is the phase's step 4: "the reveal
 *        fires on the word that announces it, not on a hard-coded offset, so
 *        re-recording narration keeps it in sync". Each card's `start` is a
 *        `{ wordIndex }` anchor naming the first word of its own narration, and
 *        the index is stable under re-recording because it is a position in the
 *        SCRIPT, not a time — re-aligning moves the word's seconds and the
 *        anchor follows.
 *
 *        But an anchor that names a word the document does not have leaves the
 *        document `anchored` forever (PARTIAL_RESOLUTION in
 *        src/lib/timeline/anchors.ts), which blocks the render. A failed or
 *        degraded alignment is a real and supported state
 *        (EMPTY_WORDS_STILL_BUILDS), so a span with no words falls back to
 *        SECONDS. The video is then timed from measured audio rather than from
 *        words, which is exactly as accurate and merely less resilient to a
 *        later re-record.
 *
 *        QUIZ_TEXT_IS_ON_THE_CARD, which is why this is the one format that
 *        emits NO caption lane. The question and its options are the on-screen
 *        text — drawn large, auto-scaled and inside the safe zone by
 *        `QuizCard` — and a caption band under them would be a second copy of
 *        the same words covering the fourth option. It is also what makes the
 *        pronunciation overrides work: the card draws `question` and `options`
 *        as the author wrote them while the narration says the respelled form
 *        (PHONETICS_ARE_SPOKEN_NOT_SHOWN), and nothing on screen reads from the
 *        narration text. The words are still in the document — the anchors
 *        resolve against them — they are simply not drawn.
 *
 *        SCRIPT_EDITS_DEGRADE_NOT_FAIL. The mapping from narration LINES back
 *        to cards is arithmetic over `planQuizNarration`
 *        (QUIZ_NARRATION_IS_PLANNED_ONCE), and a customer who edits the script
 *        by hand can make the line count disagree with the plan. That produces
 *        a video with fewer or longer cards, never a failed run: the assignment
 *        clamps, and a segment left with no lines emits no card. A format that
 *        refused to build after a hand edit would make the script editor a trap
 *        on this one kind.
 * WHERE: Registered for `quiz` in ./registry.ts. Called by the `timeline` stage
 *        of src/inngest/functions/project-generate.ts.
 */

import { splitBlockIntoLines } from "@/lib/narration";
import { planQuizNarration, type QuizSegment } from "@/lib/quiz";
import type {
  AssetRef,
  AudioItem,
  SceneElement,
  SceneItem,
  TimeValue,
  TimelineDoc,
  Track,
} from "@/lib/timeline";
import { TIMELINE_DOC_VERSION, roundSeconds } from "@/lib/timeline";
import { jsonObjectSchema } from "@/lib/types/json";
import { CANVAS_BY_ASPECT } from "@/lib/types/project";
import { quizSettingsSchema, type QuizSettings } from "@/lib/types/quiz";
import {
  SAFE_ZONE_BY_ASPECT,
  buildBackgroundTrack,
  buildMusicTrack,
  buildSpeakers,
  layNarration,
  paletteIdFor,
  readGeneratorSettings,
  type NarrationSpan,
} from "./common";
import { GeneratorInputError, type Generator, type GeneratorContext } from "./types";

/* Document-local ids and handles — see ASSET_HANDLE_INDIRECTION. */
const CARD_TRACK_ID = "quiz-cards";
const COUNTDOWN_TRACK_ID = "countdown";
const COUNTDOWN_HANDLE = "countdown_sfx";

/**
 * SOURCE OF TRUTH KEYWORDS: COUNTDOWN_GAIN
 *
 * The ticking's level. Well under the narration's 1.0 because it plays in the
 * silence between two spoken lines and does not have to compete with anything
 * — a tick at full gain over a quiet beat is the loudest thing in the video.
 */
const COUNTDOWN_GAIN = 0.5;

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_ELEMENT_KINDS, CARD_ELEMENT_IS_MATCHED_BY_KIND
 *
 * WHAT:  The scene elements a quiz card reads its content from.
 *
 * WHY:   CARD_ELEMENT_IS_MATCHED_BY_KIND, exactly as the Reddit card's post
 *        element and the backdrop's gradient are: the component finds each
 *        element by `kind` rather than by position, so an editor that prepends
 *        or reorders elements cannot silently change which one supplies the
 *        question. Exported so the component that reads them and this generator
 *        that writes them cannot drift.
 *
 *        `option` is the one kind that can appear several times, and its
 *        position in the list is NOT what orders it on screen — `props.index`
 *        is. An editor is allowed to reorder a scene's elements, and a quiz
 *        whose options silently rearranged when somebody dragged one would make
 *        `correctIndex` point at the wrong answer.
 * WHERE: src/remotion/components/quiz-card.tsx.
 */
export const QUIZ_ELEMENT_KINDS = {
  /** The question text, or the intro/outro headline. */
  prompt: "prompt",
  /** One answer. Carries `index` and, on the correct one, `correct: true`. */
  option: "option",
  /** The ring. Carries `seconds`. */
  countdown: "countdown",
  /** A reveal's one-line explanation, or an intro's question count. */
  note: "note",
} as const;

/**
 * SOURCE OF TRUTH KEYWORDS: QUIZ_LAYOUTS, LAYOUT_PICKS_THE_CARD
 *
 * WHAT:  Which of the four cards a scene item is.
 *
 * WHY:   LAYOUT_PICKS_THE_CARD. All four are the same render kind (`quizCard`)
 *        and differ by `scene.layout`, rather than being four render kinds. The
 *        registry's key is a COMPONENT FAMILY and these four share everything
 *        that is hard — the palette, the font bands, the auto-shrink, the safe
 *        zone, the entrance — and differ only in which elements they draw. Four
 *        registry entries would be four components reimplementing
 *        `fitTextRatio`, and the third one would get it slightly wrong.
 *
 *        The values are prefixed `quiz-` so an unrecognised one is still
 *        identifiable as a quiz card, which is what lets the component fall
 *        back to the question layout for a document written by a newer release
 *        or by hand (the committed `quizFixture` uses `quiz-four-up`, from
 *        before this phase named them).
 * WHERE: Written here; switched on by `QuizCard`.
 */
export const QUIZ_LAYOUTS = {
  intro: "quiz-intro",
  question: "quiz-question",
  reveal: "quiz-reveal",
  outro: "quiz-outro",
} as const;

/**
 * SOURCE OF TRUTH KEYWORDS: buildQuizDocument, EXPORTED_FOR_TESTS
 *
 * WHAT:  The document, from the context.
 * WHY:   Exported separately from the `Generator` object so a test can call it
 *        without constructing a registry entry, and SYNCHRONOUS because nothing
 *        in it does I/O — the question set is already a fact on the project's
 *        settings, put there by the writer in the same transaction that saved
 *        the script (THE_WRITER_RECORDS_WHAT_IT_DECIDED).
 * WHERE: ./registry.ts, and generators.test.ts.
 */
export function buildQuizDocument(ctx: GeneratorContext): TimelineDoc {
  const canvas = CANVAS_BY_ASPECT[ctx.aspect];
  const settings = readGeneratorSettings(ctx.settings);
  const paletteId = paletteIdFor(settings);
  const quiz = readQuizSettings(ctx.settings);

  /**
   * QUIZ_NARRATION_IS_PLANNED_ONCE — the same plan the writer turned into
   * script blocks, re-derived here. This is what makes a narration line
   * attributable to the card it belongs to without inspecting its text.
   */
  const segments = planQuizNarration(quiz);
  const assignment = assignLinesToSegments(segments, ctx.lines.length);

  /* COUNTDOWN_IS_A_LEAD_GAP — the beat belongs to the first line of each
   * reveal, and nothing else asks for one. */
  const beatByLine = new Map<number, number>();
  for (const entry of assignment) {
    if (entry.count > 0 && entry.segment.leadSilenceSec > 0) {
      beatByLine.set(entry.from, entry.segment.leadSilenceSec);
    }
  }

  const narration = layNarration(ctx, {
    beatBeforeLine: (lineIndex) => beatByLine.get(lineIndex) ?? 0,
  });
  const totalSec = narration.totalSec;

  const background = buildBackgroundTrack({
    background: ctx.background,
    totalSec,
    paletteId,
  });

  const music = buildMusicTrack({
    musicAssetId: settings.generate.musicAssetId,
    totalSec,
  });

  const assets: Record<string, AssetRef> = {
    ...narration.assets,
    ...background.assets,
    ...music.assets,
  };

  /* Bottom-most first — the renderer walks tracks in array order (LAYER_ORDER). */
  const tracks: Track[] = [];
  if (background.track !== null) tracks.push(background.track);
  if (narration.track !== null) tracks.push(narration.track);
  if (music.track !== null) tracks.push(music.track);

  /* Where each segment's audio actually landed, including the beat in front of
   * it. Computed once, because both the cards and the countdown read it. */
  const placed = placeSegments(assignment, narration.spans);

  const countdown = buildCountdownTrack({
    quiz,
    placed,
    countdownAssetId: quiz.countdownAssetId,
  });
  if (countdown.track !== null) tracks.push(countdown.track);
  Object.assign(assets, countdown.assets);

  const cards = buildCardItems({
    quiz,
    placed,
    paletteId,
    /**
     * SOURCE OF TRUTH KEYWORDS: SAFE_ZONE_IS_BAKED_ONTO_THE_ITEM
     *
     * Baked onto each card for exactly the reason the palette is
     * (PALETTE_IS_BAKED_ONTO_THE_ITEM): a component receives `item`, `assets`,
     * `frames` and `canvas` and NOT the document, so it cannot read
     * `doc.style.safeZone` — and a card has to know the platform insets to
     * auto-shrink its question INSIDE them rather than merely inside the
     * frame. The phase's fourth "done when" check is about the safe zone
     * specifically, so guessing a constant here would be the one thing that
     * fails it.
     */
    safeZone: SAFE_ZONE_BY_ASPECT[ctx.aspect],
    totalSec,
  });
  if (cards.length > 0) {
    tracks.push({
      id: CARD_TRACK_ID,
      type: "scene",
      label: "Cards",
      items: cards,
    });
  }

  /**
   * QUIZ_TEXT_IS_ON_THE_CARD — no caption lane, deliberately, and this is the
   * only format that emits none. See the file header: the question IS the
   * on-screen text, and a caption band would be a second copy of it over the
   * options. `doc.words` is still populated, because that is what the cards'
   * anchors resolve against.
   */

  return {
    version: TIMELINE_DOC_VERSION,
    kind: "quiz",
    /* GENERATED_DOC_IS_ANCHORED — the card items carry word anchors. */
    timing: "anchored",
    canvas,
    style: {
      paletteId,
      captionStyleId: settings.captions.styleId,
      safeZone: SAFE_ZONE_BY_ASPECT[ctx.aspect],
    },
    /* BEATS_SHIFT_THE_WORDS — the alignment's words moved by the countdowns
     * this build inserted, so the document is internally consistent. */
    words: narration.words,
    tracks,
    speakers: buildSpeakers(ctx),
    assets,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: readQuizSettings, SETTINGS_ARE_PARSED_NOT_TRUSTED,
 *   UNBUILDABLE_INPUT_IS_NAMED
 *
 * WHAT:  The question set the project was built with.
 *
 * WHY:   UNBUILDABLE_INPUT_IS_NAMED. Every other read of `Project.settings` in
 *        this codebase falls back to a default on a parse failure, because a
 *        malformed caption preference must produce default captions rather than
 *        a failed generation. A quiz has no such fallback: there is no default
 *        set of questions, and a document built without them would be a paid
 *        video of a host asking questions over blank cards. So this one throws,
 *        with a named error the `timeline` stage turns into a sentence a
 *        customer can act on.
 *
 *        It is the only honest option. Emitting the narration with no cards
 *        would charge for a broken video; refusing with a generic error would
 *        send somebody looking at their background.
 * WHERE: `buildQuizDocument`, first thing.
 */
function readQuizSettings(
  settings: Readonly<Record<string, unknown>>,
): QuizSettings {
  const object = jsonObjectSchema.safeParse(settings);
  const parsed = quizSettingsSchema.safeParse(
    object.success ? object.data["quiz"] : undefined,
  );
  if (!parsed.success) {
    throw new GeneratorInputError(
      "quiz",
      "This quiz has no questions saved. Set it up again from the quiz panel.",
      `settings.quiz did not parse: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SegmentAssignment, assignLinesToSegments,
 *   SCRIPT_EDITS_DEGRADE_NOT_FAIL, POSITION_IS_STABLE
 *
 * WHAT:  Which narration lines belong to which beat of the quiz.
 *
 * WHY:   The writer turned each segment's text into blocks and the TTS stage
 *        split each block into lines with `splitBlockIntoLines` — the same pure
 *        function called here, on the same text, in the same order. So the line
 *        COUNT per segment is re-derivable without storing a mapping, which is
 *        what POSITION_IS_STABLE buys: the same script always produces the same
 *        positions.
 *
 *        SCRIPT_EDITS_DEGRADE_NOT_FAIL is what the clamping is for. A customer
 *        can edit, add or delete script blocks, so the real line count may be
 *        anything. Each segment takes as many lines as it expects or as many as
 *        are left, whichever is fewer, and a leftover tail is given to the LAST
 *        segment that got anything — so extra lines are narrated under the
 *        final card rather than being silently dropped from the video they were
 *        paid for.
 *
 *        A segment that gets zero lines emits no card, which is correct: there
 *        is no audio for it, so there is no span to put a card over.
 * WHERE: `buildQuizDocument`, before the narration is laid, because the beat
 *        callback needs it.
 */
interface SegmentAssignment {
  segment: QuizSegment;
  /** Index into `ctx.lines` of this segment's first line. */
  from: number;
  count: number;
}

function assignLinesToSegments(
  segments: readonly QuizSegment[],
  lineCount: number,
): SegmentAssignment[] {
  const assignment: SegmentAssignment[] = [];
  let cursor = 0;

  for (const segment of segments) {
    const expected = splitBlockIntoLines(segment.narrationText).length;
    const available = Math.max(0, lineCount - cursor);
    const count = Math.min(expected, available);
    assignment.push({ segment, from: cursor, count });
    cursor += count;
  }

  /* A tail the plan did not expect — the script was edited. It goes to the last
   * segment that has lines, so it is narrated under a card rather than playing
   * over nothing. */
  if (cursor < lineCount) {
    for (let index = assignment.length - 1; index >= 0; index -= 1) {
      const entry = assignment[index];
      if (entry === undefined || entry.count === 0) continue;
      entry.count += lineCount - cursor;
      break;
    }
  }

  return assignment;
}

/**
 * SOURCE OF TRUTH KEYWORDS: PlacedSegment, placeSegments, SEGMENT_HAS_A_SPAN
 *
 * WHAT:  Each beat of the quiz with the real times its audio occupies, and the
 *        word its narration starts on.
 *
 * WHY:   SEGMENT_HAS_A_SPAN. The cards and the countdown both need to know
 *        where a segment's audio starts and ends, and both would otherwise
 *        re-walk the spans with the same arithmetic — which is two places for
 *        the off-by-one that attributes a card to the wrong question.
 *
 *        `start` is the start of the segment's FIRST line's audio, so it is
 *        AFTER the beat rather than before it: the beat belongs to the silence
 *        the previous card is still on screen for, which is what makes the
 *        question card's duration come out as narration-plus-countdown with no
 *        duration arithmetic anywhere.
 *
 *        A segment with no lines is dropped entirely rather than being given a
 *        zero-length span — `validate()` refuses a zero-duration item, and a
 *        card nobody can see is not worth one.
 * WHERE: `buildQuizDocument`; read by `buildCardItems` and
 *        `buildCountdownTrack`.
 */
interface PlacedSegment {
  segment: QuizSegment;
  start: number;
  end: number;
  /** For the word anchor, or null when this line has no aligned words. */
  firstWordIndex: number | null;
}

function placeSegments(
  assignment: readonly SegmentAssignment[],
  spans: readonly NarrationSpan[],
): PlacedSegment[] {
  const placed: PlacedSegment[] = [];

  for (const entry of assignment) {
    if (entry.count === 0) continue;
    const first = spans[entry.from];
    const last = spans[entry.from + entry.count - 1];
    if (first === undefined || last === undefined) continue;

    placed.push({
      segment: entry.segment,
      start: first.start,
      end: roundSeconds(last.start + last.duration),
      firstWordIndex: first.firstWordIndex,
    });
  }

  return placed;
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildCardItems, REVEAL_IS_ITS_OWN_ITEM,
 *   ANCHOR_ONLY_WHEN_THERE_ARE_WORDS, QUESTION_CARD_HOLDS_THROUGH_THE_COUNTDOWN
 *
 * WHAT:  One scene item per beat, back to back on a single track.
 *
 * WHY:   QUESTION_CARD_HOLDS_THROUGH_THE_COUNTDOWN. A question card ends where
 *        the NEXT card's audio begins, not where its own narration stops —
 *        which is what keeps the question and its options on screen through the
 *        silent beat, where the viewer is reading them. That is the phase's
 *        "narration plus the configured countdown", and it is read off the
 *        document rather than calculated: the next card's start already
 *        includes whatever beat was inserted in front of it.
 *
 *        The last card runs to the end of the video rather than to the end of
 *        its own line, so the final frames are not an uncovered background.
 *
 *        ANCHOR_ONLY_WHEN_THERE_ARE_WORDS — `start` is a `{ wordIndex }`
 *        anchor where the span has one, and seconds where it does not. The
 *        DURATION is always seconds: a duration anchored to a word would have
 *        to name the first word of the NEXT card, and a card whose end depends
 *        on a word in somebody else's narration is a card that moves when an
 *        unrelated line is re-recorded.
 *
 *        One track, in order, with no overlaps — which is what the quiz fixture
 *        has always exercised in the timeline tests, and why no `z` is needed:
 *        scene items stack by their track's position in the array (LAYER_ORDER).
 * WHERE: `buildQuizDocument`.
 */
function buildCardItems(args: {
  quiz: QuizSettings;
  placed: readonly PlacedSegment[];
  paletteId: string;
  safeZone: TimelineDoc["style"]["safeZone"];
  totalSec: number;
}): SceneItem[] {
  const items: SceneItem[] = [];

  for (const [index, entry] of args.placed.entries()) {
    const next = args.placed[index + 1];
    const end = next === undefined ? args.totalSec : next.start;
    const duration = roundSeconds(end - entry.start);
    /* `validate()` refuses a zero-length item, and a card nobody can see is
     * not worth one. */
    if (duration <= 0) continue;

    const elements = cardElements({
      quiz: args.quiz,
      segment: entry.segment,
      paletteId: args.paletteId,
      safeZone: args.safeZone,
    });
    if (elements.length === 0) continue;

    items.push({
      id: cardId(entry.segment, index),
      /* ANCHOR_ONLY_WHEN_THERE_ARE_WORDS — see the function header. */
      start: startValue(entry),
      duration,
      render: "quizCard",
      scene: {
        layout: QUIZ_LAYOUTS[entry.segment.role],
        elements,
      },
      label: cardLabel(entry.segment),
    });
  }

  return items;
}

function startValue(entry: PlacedSegment): TimeValue {
  return entry.firstWordIndex === null
    ? entry.start
    : { wordIndex: entry.firstWordIndex };
}

function cardId(segment: QuizSegment, index: number): string {
  return segment.questionIndex === null
    ? `card-${segment.role}-${index}`
    : `card-${segment.role}-${segment.questionIndex + 1}`;
}

function cardLabel(segment: QuizSegment): string {
  switch (segment.role) {
    case "intro":
      return "Intro";
    case "outro":
      return "Outro";
    case "question":
      return `Question ${(segment.questionIndex ?? 0) + 1}`;
    case "reveal":
      return `Answer ${(segment.questionIndex ?? 0) + 1}`;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: cardElements, PALETTE_IS_BAKED_ONTO_THE_ITEM,
 *   ANSWER_TYPE_IS_PRESENTATION, OPTION_CARRIES_ITS_INDEX
 *
 * WHAT:  What each of the four cards is given to draw.
 *
 * WHY:   PALETTE_IS_BAKED_ONTO_THE_ITEM. A component receives `item`, `assets`,
 *        `frames` and `canvas` and NOT the document
 *        (RENDER_COMPONENT_CONTRACT), so it cannot read
 *        `doc.style.paletteId` — the generator resolves it once and writes it
 *        onto the prompt element, exactly as the backdrop and the Reddit card
 *        do.
 *
 *        OPTION_CARRIES_ITS_INDEX and its own `correct` flag. The index is what
 *        orders it on screen (not its position in the array — see
 *        QUIZ_ELEMENT_KINDS) and the flag is what the reveal highlights. The
 *        flag is on the option rather than a `correctIndex` on the prompt
 *        because a component then needs no cross-element lookup to draw a
 *        highlight, and an editor that deleted an option cannot leave an index
 *        pointing past the end.
 *
 *        The QUESTION card carries `correct` on its options too, although it
 *        does not draw a highlight. Leaving it off would make the question card
 *        and the reveal card structurally different documents of the same
 *        question, and the reveal would then be the only place the answer is
 *        recorded — so retiming the pair in the editor could separate a
 *        question from its answer.
 *
 *        ANSWER_TYPE_IS_PRESENTATION — `showOptions` is baked on rather than
 *        the options being omitted for an `open` quiz. The reveal still has to
 *        name the right answer, and a document that dropped the options would
 *        have nothing to reveal.
 * WHERE: `buildCardItems`.
 */
function cardElements(args: {
  quiz: QuizSettings;
  segment: QuizSegment;
  paletteId: string;
  safeZone: TimelineDoc["style"]["safeZone"];
}): SceneElement[] {
  const { quiz, segment, paletteId, safeZone } = args;
  const showOptions = quiz.answerType === "multiple-choice";

  if (segment.role === "intro") {
    return [
      {
        id: "intro-prompt",
        kind: QUIZ_ELEMENT_KINDS.prompt,
        text: quiz.topic?.trim() ?? "Quiz",
        props: { paletteId, safeZone },
      },
      {
        id: "intro-note",
        kind: QUIZ_ELEMENT_KINDS.note,
        text:
          quiz.questions.length === 1
            ? "1 question"
            : `${quiz.questions.length} questions`,
      },
    ];
  }

  if (segment.role === "outro") {
    return [
      {
        id: "outro-prompt",
        kind: QUIZ_ELEMENT_KINDS.prompt,
        text: "How many did you get?",
        props: { paletteId, safeZone },
      },
      {
        id: "outro-note",
        kind: QUIZ_ELEMENT_KINDS.note,
        text: "Follow for more",
      },
    ];
  }

  const question =
    segment.questionIndex === null
      ? undefined
      : quiz.questions[segment.questionIndex];
  /* Unreachable while the plan and the set come from the same settings, but a
   * `!` is banned and a missing question must not draw an empty card. */
  if (question === undefined) return [];

  const elements: SceneElement[] = [
    {
      id: "prompt",
      kind: QUIZ_ELEMENT_KINDS.prompt,
      /* The question AS WRITTEN — never the narration text, which may have been
       * respelled for pronunciation (PHONETICS_ARE_SPOKEN_NOT_SHOWN). */
      text: question.question,
      props: { paletteId, safeZone, showOptions },
    },
  ];

  for (const [index, option] of question.options.entries()) {
    elements.push({
      id: `option-${index}`,
      kind: QUIZ_ELEMENT_KINDS.option,
      text: option,
      props:
        index === question.correctIndex
          ? { index, correct: true }
          : { index },
    });
  }

  if (segment.role === "question") {
    elements.push({
      id: "timer",
      kind: QUIZ_ELEMENT_KINDS.countdown,
      /* The ring's own length, so the component animates against the beat
       * rather than against the item — the card is on screen for the narration
       * AND the countdown, and a ring spanning both would be wrong for the
       * whole first half. */
      props: { seconds: quiz.countdownSec },
    });
    return elements;
  }

  const explanation = question.explanation?.trim() ?? "";
  if (explanation.length > 0) {
    elements.push({
      id: "explanation",
      kind: QUIZ_ELEMENT_KINDS.note,
      text: explanation,
    });
  }

  return elements;
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildCountdownTrack, COUNTDOWN_CONTAINS_NO_SPEECH,
 *   COUNTDOWN_SFX_IS_OPTIONAL, MUSIC_LICENCE_IS_NOT_RESOLVED_YET
 *
 * WHAT:  The ticking under each thinking beat, when the workspace picked a
 *        sound for it.
 *
 * WHY:   COUNTDOWN_CONTAINS_NO_SPEECH is the phase's sixth "done when" check,
 *        and it is satisfied by the NARRATION rather than by this track: the
 *        beat is a hole in the narration lane (COUNTDOWN_IS_A_LEAD_GAP), so
 *        there is no speech there to remove. This track only decides whether
 *        the hole is silent or ticks.
 *
 *        The item is placed by SUBTRACTING the beat from the reveal's audio
 *        start, which is exactly the window `layNarration` left empty. Clamped
 *        at zero so a first-question beat cannot start before the video.
 *
 *        COUNTDOWN_SFX_IS_OPTIONAL and normally absent — the Phase 11 library
 *        ships empty, so silence is the working default. Emitting an item
 *        pointing at a handle with no asset behind it would be worse than
 *        omitting it: MISSING_ASSET_DRAWS_NOTHING means the renderer would
 *        silently skip it, and the document would claim a sound the video does
 *        not have.
 *
 *        `duck: false`, which looks wrong next to the music bed and is not: the
 *        duck curve is computed against the NARRATION windows, and this item
 *        lives precisely where there is no narration, so ducking it would do
 *        nothing at all. The music bed above it goes on playing at its own
 *        level, which is what "music or ticking" asks for.
 *
 *        MUSIC_LICENCE_IS_NOT_RESOLVED_YET applies here identically, and for
 *        the same reason: the only way a sound reaches this document today is a
 *        setting naming an asset the workspace uploaded, so `owned` is the
 *        truth. A licensed catalogue tick would need resolving before the build
 *        (RESOLVED_BEFORE_THE_GENERATOR) because a pure generator cannot read
 *        an asset row — whoever builds the sfx picker owns that, and this
 *        comment is the note they need.
 * WHERE: `buildQuizDocument`.
 */
function buildCountdownTrack(args: {
  quiz: QuizSettings;
  placed: readonly PlacedSegment[];
  countdownAssetId: string | undefined;
}): { track: Track | null; assets: Record<string, AssetRef> } {
  if (args.countdownAssetId === undefined) {
    return { track: null, assets: {} };
  }

  const items: AudioItem[] = [];

  for (const entry of args.placed) {
    if (entry.segment.role !== "reveal") continue;
    const beat = entry.segment.leadSilenceSec;
    if (beat <= 0) continue;

    const start = Math.max(0, roundSeconds(entry.start - beat));
    const duration = roundSeconds(entry.start - start);
    if (duration <= 0) continue;

    items.push({
      id: `countdown-${(entry.segment.questionIndex ?? 0) + 1}`,
      start,
      duration,
      assetId: COUNTDOWN_HANDLE,
      gain: COUNTDOWN_GAIN,
      /* See the header: there is no narration in this window to duck against. */
      duck: false,
      /* A tick is usually a second long and the beat is several, so it repeats
       * — with <Loop> rather than the element's own playhead
       * (LOOP_VIA_REMOTION_LOOP), which keeps a frame a pure function of its
       * number. */
      loop: true,
      label: "Countdown",
    });
  }

  if (items.length === 0) return { track: null, assets: {} };

  return {
    track: {
      id: COUNTDOWN_TRACK_ID,
      type: "audio",
      label: "Countdown",
      items,
    },
    assets: {
      [COUNTDOWN_HANDLE]: {
        assetId: args.countdownAssetId,
        kind: "audio",
        /* See MUSIC_LICENCE_IS_NOT_RESOLVED_YET in the function header. */
        license: "owned",
      },
    },
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: quizGenerator, QUIZ_SKIPS
 *
 * WHAT:  The registry entry for `quiz`.
 * WHY:   QUIZ_SKIPS names the four stages this kind does not run, and three of
 *        them are skipped for the reasons the other formats give. The fourth is
 *        the one worth stating, because the voiceover generator's own note
 *        predicted the opposite:
 *
 *          `visuals`    — the background is resolved before the build, as it is
 *                         for every format (RESOLVED_BEFORE_THE_GENERATOR).
 *          `storyboard` — and VOICEOVER_SKIPS says a storyboard "is what a
 *                         multi-shot format needs (Phases 13 and 14)", which
 *                         this phase is. It is still skipped, and the
 *                         distinction is the one the Reddit story drew: a quiz
 *                         IS multi-shot, but its shot order is entirely
 *                         DETERMINED by the question set — intro, then a
 *                         question and a reveal per question, then the outro.
 *                         There is nothing to decide, so a storyboard stage
 *                         would be a progress row for an arithmetic step, and a
 *                         stage that goes from pending to complete in the same
 *                         instant is noise on a list somebody is watching.
 *                         Phase 14, which picks different IMAGERY per block, is
 *                         where it becomes a real decision.
 *          `design`     — the four cards' layouts are the component's, and the
 *                         auto-shrink is a draw-time fit rather than a stored
 *                         one (CARD_FITS_ITS_TEXT).
 *          `render`     — a separate paid action from the preview screen, with
 *                         its own hold and its own resolution choice.
 *
 *        `align` is deliberately NOT skipped, unlike everything else about this
 *        format that could have been derived: the word timings are what the
 *        cards are anchored to (ANCHOR_ONLY_WHEN_THERE_ARE_WORDS), so a quiz
 *        needs them even though it draws no captions.
 * WHERE: GENERATORS in ./registry.ts.
 */
export const quizGenerator: Generator = {
  kind: "quiz",
  skips: ["visuals", "storyboard", "design", "render"],
  build: (ctx) => Promise.resolve(buildQuizDocument(ctx)),
};
