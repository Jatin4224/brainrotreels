/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: quiz barrel, planQuizNarration, applyPhonetics,
 *   QUIZ_NARRATION_IS_PURE
 *
 * WHAT:  The public surface of the quiz library — the narration plan and the
 *        pronunciation transform.
 *
 * WHY:   QUIZ_NARRATION_IS_PURE. Nothing under src/lib/quiz/ imports Prisma,
 *        `server-only`, React or Remotion, because both halves of the format
 *        need it: the WRITER is server-only and the GENERATOR must stay pure
 *        (GENERATORS_STAY_PURE in src/lib/generators/index.ts). A single
 *        server-side import here would make the generator unbuildable in the
 *        editor and would break it silently rather than loudly.
 *
 *        The MODEL call is deliberately not here — it lives in
 *        src/lib/script/quiz.ts beside the other two writers, so every path
 *        that reaches the LLM adapter is in one directory and carries the
 *        `server-only` marker.
 * WHERE: Imported as '@/lib/quiz' by src/lib/script/quiz.ts and
 *        src/lib/generators/quiz.ts.
 */

export {
  QUIZ_SEGMENT_ROLES,
  applyPhonetics,
  planQuizNarration,
} from "./narration";
export type { QuizSegment, QuizSegmentRole } from "./narration";
export {
  QUIZ_IMPORT_CORRECT_MARKER,
  QUIZ_IMPORT_SEPARATOR,
  parseQuizRows,
} from "./import";
export type { QuizImportError, QuizImportResult } from "./import";
