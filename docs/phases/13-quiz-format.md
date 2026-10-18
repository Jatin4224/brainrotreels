# Phase 13 — Quiz format

**Depends on:** Phase 09.

## Goal

A topic becomes a trivia short with question cards, an animated countdown, answer reveals and
narration. Manually entered questions render identically to generated ones.

## Registry

```ts
quizzes: {
  name: 'Quiz videos',
  description: 'Trivia videos with countdowns and reveals',
  flag: {
    perPlan: { free: false, starter: true, pro: true, enterprise: true, portal: true },
    availableOnFreeTrial: true,
  },
}
```

A `flag` gates **every verb** of the resource automatically, queries included — so a free workspace
cannot even list quiz templates. That is the intent here.

## Data

None. Quiz content lives in `Project.settings` and then in the timeline document. Questions are not
a separate entity with their own lifecycle: they are authored once, baked into a scene track, and
edited thereafter through the timeline editor like anything else.

## Build

1. **Two input paths, one shape.** A topic goes to the LLM; a manual question table goes straight
   through. Both produce the same validated structure, so step 3 onward cannot tell them apart.
   Config: number of questions, countdown seconds, difficulty, answer type (multiple choice or
   open).
2. **Validate hard with Zod.** Exactly one correct answer, no duplicate options, no duplicate
   questions across the set, option and question length caps, and distractors that are actually
   plausible — reject a set where the correct answer is the only long option, which is the classic
   LLM tell.
3. **The `quiz` generator** in `src/lib/generators/`. Per question: a question scene whose duration
   is narration plus the configured countdown, then a **separate** reveal scene item. Keeping the
   reveal as its own item is what lets the editor retime a reveal without touching the question.
4. **Timing by word anchor.** The reveal fires on the word that announces it, not on a hard-coded
   offset, so re-recording narration keeps it in sync.
5. **The `QuizCard` component family**, registered into `src/remotion/registry.ts`:
   - `IntroCard` — topic and question count
   - `QuestionCard` — question text, option list, animated countdown ring
   - `RevealCard` — correct answer highlighted, optional one-line explanation
   - `OutroCard` — CTA
6. **Auto-shrink long text** to fit the card: step the font size down within a defined range, wrap,
   and only truncate with an ellipsis as a genuine last resort. A clipped question is a broken
   video; a slightly smaller one is not.
7. **Narration with SSML.** The question is read aloud, the countdown is a beat with music or
   ticking and **no speech**, then the reveal. Support phonetic overrides for acronyms and technical
   terms — "SQL", "GIF", "Nginx" all need them, and the user should be able to add their own per
   question.
8. **Countdown audio** comes from the Phase 11 library as `sfx`, under the same licence discipline.
9. **Wizard input panel**: topic field or a question table with add, delete, reorder and import
   rows; timer length; question count. The table is a form, so it follows the house pattern — Zod
   schema in `src/lib/types/quiz.ts`, RHF with `useFieldArray`, `mode: 'onTouched'`.
10. **Preview a single question** before committing to a full generation, so a user discovers a bad
    distractor for free rather than after paying for the render.

## Contracts

```ts
export const quizQuestionSchema = z.object({
  question: z.string().min(1).max(200),
  options: z.array(z.string().min(1).max(80)).min(2).max(4),
  correctIndex: z.number().int().min(0),
  explanation: z.string().max(200).optional(),
  phonetics: z.record(z.string(), z.string()).optional(),
})
export type QuizQuestion = z.infer<typeof quizQuestionSchema>

export interface QuizSettings {
  questions: QuizQuestion[]
  countdownSec: number
  answerType: 'multiple-choice' | 'open'
  difficulty: 'easy' | 'medium' | 'hard'
}
```

## Done when

- [ ] A topic produces a complete quiz video with countdowns and reveals.
- [ ] Manually entered questions render identically to generated ones.
- [ ] A generated set with two correct answers, a duplicate option, or a duplicate question is
      rejected and regenerated rather than saved.
- [ ] A very long question auto-scales and stays inside the safe zone without truncation.
- [ ] An acronym with a phonetic override is pronounced as specified.
- [ ] The countdown contains no speech.
- [ ] A free workspace cannot reach the quiz routes at all, server-side included.

## Not in this phase

Leaderboards, interactive quizzes, 16:9 output.
