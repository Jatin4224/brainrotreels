/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: TRY_ONE_PROMPTS, PAGE_OWNED_COPY,
 *   A_SUGGESTION_IS_A_REAL_PROMPT, CreatableProjectKind
 *
 * WHAT:  The "Try one:" suggestions under the composer, per format.
 *
 * WHY:   A_SUGGESTION_IS_A_REAL_PROMPT. These are not placeholder garnish —
 *        pressing one fills the field with exactly this text and the
 *        generator then runs on it, so each has to be a prompt that actually
 *        produces a good short in that format. A Reddit suggestion is a
 *        thread URL shape, a quiz suggestion names a subject with enough
 *        trivia in it, and a voiceover suggestion is a question with a
 *        surprising answer.
 *
 *        Keyed by `CreatableProjectKind`, so a new startable format fails the
 *        typecheck here until somebody writes suggestions for it — rather
 *        than shipping a composer with an empty "Try one:" row, which reads
 *        as broken.
 *
 *        PAGE_OWNED_COPY, held apart from the component for the reason
 *        `landing-content.ts` is: these are words a non-engineer will want to
 *        tune, and they should be a readable diff.
 *
 * WHERE: The suggestion row in ./composer-screen.tsx.
 */

import type { CreatableProjectKind } from "@/lib/types";

export const TRY_ONE_PROMPTS: Record<
  CreatableProjectKind,
  readonly string[]
> = {
  voiceover: [
    "How does Netflix know what you'll watch next?",
    "Why do we get goosebumps?",
    "What actually happens when a plane hits turbulence",
  ],
  quiz: [
    "Capital cities almost nobody gets right",
    "Guess the decade from the technology",
    "Science facts that sound made up",
  ],
  "reddit-story": [
    "https://www.reddit.com/r/AmItheAsshole/comments/",
    "A roommate story that goes too far",
    "The malicious compliance that cost them everything",
  ],
};
