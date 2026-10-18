> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 16 — Quiz video format

## Goal
Trivia shorts with question cards, animated countdowns, answer reveals and narration.

## Depends on
Phase 13.

## Deliverables
- Quiz question generation and manual entry
- `QuizCard` component family
- `quiz` generator

## Steps
1. Input: a topic (LLM generates questions) or a manual question table. Config: number of questions, countdown seconds, difficulty, answer type (multiple choice or open).
2. Validate generated questions with Zod: exactly one correct answer, plausible distractors, no duplicates, answer length limits.
3. `QuizCard` components: `QuestionCard` (question text, options list, animated countdown ring), `RevealCard` (correct answer highlight, optional explanation), `IntroCard`, `OutroCard` with a CTA.
4. Narration: question read aloud, a countdown beat (music or ticking, no speech), then the reveal. Support SSML or phonetic overrides for acronyms and technical terms.
5. Timing: each question scene equals narration duration plus the configured countdown; reveal is a separate scene item.
6. Auto-shrink long question or option text to fit the card; truncate with an ellipsis only as a last resort.
7. Wizard input panel: topic field or question table with add/import rows, timer length, question count.

## Acceptance criteria
- A topic produces a complete quiz video with countdowns and reveals.
- Manually entered questions render identically to generated ones.
- A very long question auto-scales without overflowing the safe zone.
- An acronym with a phonetic override is pronounced correctly.

## Out of scope
Leaderboards, interactive quizzes, 16:9 output.
