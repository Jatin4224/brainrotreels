/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: quizFixture, quizCard, QUIZ_BEAT, countdown
 *
 * WHAT:  A two-question quiz: each question is a scene item rendering a
 *        `quizCard`, with its options and answer as scene elements.
 * WHY:   QUIZ_BEAT. A quiz is the format that proves scene elements carry real
 *        structure rather than decoration — the options, the correct index and
 *        the countdown all live in `scene.elements` and `scene.layout`, and the
 *        renderer reads them without the schema knowing what a quiz is. If a
 *        format ever needs a field ON the item instead, this is the fixture
 *        that will show why.
 *        The questions are back to back with no gap, which is what exercises
 *        the ripple maths in ops.ts against adjacent items.
 * WHERE: src/lib/timeline/*.test.ts; the Phase 13 quiz work.
 */

import type { TimelineDoc } from "../schema";
import { buildWords } from "./words";

const SCRIPT =
  "Which planet has the shortest day? And which ocean is the deepest of them all?";

const FIRST_QUESTION_SECONDS = 6;
const SECOND_QUESTION_SECONDS = 6;

export function quizFixture(): TimelineDoc {
  const words = buildWords(SCRIPT, { speaker: "Q" });
  const total = FIRST_QUESTION_SECONDS + SECOND_QUESTION_SECONDS;

  return {
    version: 4,
    kind: "quiz",
    timing: "resolved",
    canvas: { width: 1080, height: 1920, fps: 30 },
    style: {
      paletteId: "electric",
      captionStyleId: "bold-pop",
      safeZone: "shorts",
    },
    words,
    tracks: [
      {
        id: "bg",
        type: "video",
        label: "Background",
        items: [
          {
            id: "i1",
            start: 0,
            duration: total,
            assetId: "bg_gradient",
            fit: "cover",
            loop: true,
            muted: true,
            render: "media",
          },
        ],
      },
      {
        id: "questions",
        type: "scene",
        label: "Questions",
        items: [
          {
            id: "q1",
            start: 0,
            duration: FIRST_QUESTION_SECONDS,
            render: "quizCard",
            scene: {
              layout: "quiz-four-up",
              elements: [
                {
                  id: "q1-prompt",
                  kind: "prompt",
                  text: "Which planet has the shortest day?",
                },
                {
                  id: "q1-a",
                  kind: "option",
                  text: "Mercury",
                  props: { index: 0 },
                },
                {
                  id: "q1-b",
                  kind: "option",
                  text: "Jupiter",
                  props: { index: 1, correct: true },
                },
                {
                  id: "q1-c",
                  kind: "option",
                  text: "Earth",
                  props: { index: 2 },
                },
                {
                  id: "q1-d",
                  kind: "option",
                  text: "Mars",
                  props: { index: 3 },
                },
                { id: "q1-timer", kind: "countdown", props: { seconds: 3 } },
              ],
            },
          },
          {
            id: "q2",
            start: FIRST_QUESTION_SECONDS,
            duration: SECOND_QUESTION_SECONDS,
            render: "quizCard",
            scene: {
              layout: "quiz-four-up",
              elements: [
                {
                  id: "q2-prompt",
                  kind: "prompt",
                  text: "Which ocean is the deepest?",
                },
                {
                  id: "q2-a",
                  kind: "option",
                  text: "Atlantic",
                  props: { index: 0 },
                },
                {
                  id: "q2-b",
                  kind: "option",
                  text: "Indian",
                  props: { index: 1 },
                },
                {
                  id: "q2-c",
                  kind: "option",
                  text: "Pacific",
                  props: { index: 2, correct: true },
                },
                {
                  id: "q2-d",
                  kind: "option",
                  text: "Arctic",
                  props: { index: 3 },
                },
                { id: "q2-timer", kind: "countdown", props: { seconds: 3 } },
              ],
            },
          },
        ],
      },
      {
        id: "narration",
        type: "audio",
        label: "Narration",
        items: [
          {
            id: "a1",
            start: 0,
            duration: total,
            assetId: "narration_q1",
            speaker: "Q",
            gain: 1,
            duck: false,
            loop: false,
          },
        ],
      },
      {
        id: "captions",
        type: "caption",
        label: "Captions",
        items: [{ id: "c1", startWord: 0, endWord: 5, position: { y: 0.84 } }],
      },
    ],
    speakers: { Q: { voiceId: "lib_quinn", displayName: "Quinn" } },
    assets: {
      bg_gradient: {
        assetId: "ast_bg_gradient",
        kind: "video",
        license: "owned",
      },
      narration_q1: {
        assetId: "ast_narration_q1",
        kind: "audio",
        license: "generated",
      },
    },
  };
}
