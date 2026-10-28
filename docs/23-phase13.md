<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 13 — the quiz format

Phase 12 built the first complete format and the two extension points a second
one would plug into. This phase is the test of whether that worked: a quiz is a
**generator, a writer, a component family and a resource entry**, and it touched
no workflow's credit handling, no stage list and no renderer.

It did need two additions to shared code, and both are the interesting part of
the phase. Read those two sections first if you read nothing else.

## The one-sentence version

A quiz is **the existing pipeline with two registry entries and one new idea**:
a `SCRIPT_WRITERS` entry that turns a topic or a typed table into a validated
question set and the narration that reads it out, a `GENERATORS` entry that
assembles them into cards, and the one new idea — a **measured beat of silence
between two narration lines**, which is what a countdown is.

## Where the code lives

| Path | Contains | Reaches a provider? |
| --- | --- | --- |
| `src/lib/types/quiz.ts` | the contracts, the four cross-field rules, the refusal copy | **no** — pure |
| `src/lib/quiz/narration.ts` | the shot plan and the pronunciation transform | **no** — pure |
| `src/lib/quiz/import.ts` | the paste parser | **no** — pure |
| `src/lib/script/quiz-prompt.ts` | the fence, the distractor rules, the retry turn | **no** — pure |
| `src/lib/script/quiz.ts` | the model call, and reject-and-regenerate | the LLM seam |
| `src/lib/script/writers.ts` | the `quiz` writer, and `settingsPatch` | no |
| `src/lib/generators/common.ts` | `layNarration` gained beats and word shifting | **no** — pure |
| `src/lib/generators/quiz.ts` | the cards, the countdown, the anchors | **no** — pure |
| `src/remotion/components/quiz-card.tsx` | all four cards | no |
| `src/trpc/routers/quizzes.ts` | `previewQuestion` and `start` | via the LLM seam |
| `.../script/_components/quiz-input-panel.tsx` | the wizard, the table, the import | no |

There is **no new table and no migration**. The phase file says "Data: None",
and that is a decision rather than an absence — see below.

## The two shared-code additions

### 1. A countdown is a hole in the narration, and the generator makes it

This is the decision the rest of the format hangs off, and three places could
have made the hole. Two of them are wrong.

The phase requires a thinking beat between a question and its answer, with
"music or ticking and **no speech**". So the narration lane has to have a gap in
it — and `NARRATION_IS_SEQUENTIAL` says it must not, because `layNarration` and
the alignment stage's `concatAlignedLines` both accumulate measured durations
with no gaps and **have to agree about where line four starts**.

- **The TTS seam, with SSML.** The adapter's contract says in so many words
  that it has no SSML and no streaming, deliberately. Widening it for one
  format would make every future TTS provider owe an SSML implementation, and
  SSML in `NarrationLine.text` would also be markup the aligner has to match
  against words nobody said.
- **The narration and alignment stages, with a stored per-line gap.** This
  works, and it costs a column, a migration and edits to two shared pipeline
  stages — to express something exactly one format wants.
- **The generator.** A gap is a **layout decision about a document**, and
  laying documents out is the one thing a generator does. This is where it went.

`layNarration` now takes an optional `beatBeforeLine` callback, and the second
half is what makes it safe: it returns the aligned **words shifted by exactly
what was inserted**. The alignment row stays gapless and stays correct for its
own purpose; the *document* is internally consistent, which is the only
consistency that matters, because a document is the output and an alignment is
an input several documents can be built from.

Grep `COUNTDOWN_IS_A_LEAD_GAP` and `BEATS_SHIFT_THE_WORDS`. The committed test
asserts the gap is exactly one countdown per question and nowhere else, and that
the last word still ends inside the last audio item — which is only true if the
shift was applied.

### 2. A writer may record what it decided

A quiz's questions are **not words anybody narrates**. They have options and a
correct index, and the card draws them — so there is no script block to put them
on, and the generator needs them.

`WrittenScript` therefore grew an optional `settingsPatch`, which the script
workflow merges into `Project.settings` **in the same transaction that saves the
blocks and charges the credits**. That last part is the point: a quiz whose
narration was saved and whose questions were not is a paid-for video of a host
asking questions no card can draw, and the halfway state cannot exist.

The alternatives, recorded because they will look reasonable again later:

- **Generate the questions in the request.** A model call inside a 10-second
  Prisma transaction — the thing
  `EXTRACT_SYNCHRONOUSLY_GENERATE_ASYNCHRONOUSLY` exists to prevent.
- **Give the quiz its own workflow.** That duplicates the hold, the retry
  classification, the refund on every path and the one transaction that saves
  and charges — the four things `ONE_WORKFLOW_MANY_WRITERS` exists to share.
- **Have the generator ask a model.** A document build would become
  non-deterministic and paid, which breaks Phase 04's render reuse outright.

Grep `THE_WRITER_RECORDS_WHAT_IT_DECIDED` and `PATCH_IS_MERGED_NOT_REPLACED`.

## The seven decisions worth knowing

### 1. One shape, two inputs — and no second path

A topic goes to the model; a typed table goes straight through. Both are parsed
by `quizQuestionSchema` and both are checked by `checkQuizSet`, and everything
after that point — the narration plan, the blocks, the settings, the generator,
the cards — **cannot tell which arm produced it**. That is the phase's "manually
entered questions render identically to generated ones" made structural rather
than tested once.

The typed arm never reaches the LLM adapter, which is not an optimisation: a
customer who typed ten questions must not be charged a model request to have
them read back, and a model asked to pass them through would rewrite them. It
**is** validated, by the same rules, because a person is as capable of typing
two identical options as a model is. Grep `ONE_SHAPE_TWO_INPUTS` and
`MANUAL_IS_NOT_A_MODEL_CALL`.

### 2. The schema is not enough, and the four rules are each a real video

`quizQuestionSchema` can say `correctIndex` is a non-negative integer. It cannot
say that index is inside **this** question's options, that no two options are the
same answer, that no two questions are the same question, or that the correct
answer is not suspiciously the only long one. Those are cross-field and
cross-question, so they live in `checkQuizSet` beside the schema, and each one
is a video that would otherwise have been generated and paid for:

- an index past the end draws a reveal highlighting nothing — a quiz with no
  answer;
- two identical options make a question with two right answers or none,
  depending which the viewer picks;
- the same question twice is a ten-question video that asks eight things.

It returns a **list** rather than throwing, because the two consumers need
different things from it: the wizard attaches each one to the row it is about,
and the retry turn tells the model which question to fix. Grep
`THE_SCHEMA_IS_NOT_ENOUGH` and `REJECTED_IS_NOT_BROKEN`.

**The fourth rule is about model behaviour and it needed tuning, not just
writing.** A model asked for three distractors writes the real answer carefully
and the wrong ones carelessly, so the right one ends up visibly longest and a
viewer picks it without knowing the topic. The naive rule — a length ratio —
refuses "Jupiter" against "Mars" constantly, which would make the product unable
to ask a fair question about planets. So it needs **both** a ratio and an
absolute character gap, and the committed test has as many accepting cases as
rejecting ones, because a rule that over-refuses fails invisibly in a suite that
only checks that bad sets are caught. Grep `LENGTH_IS_THE_LLM_TELL`.

### 3. Reject and regenerate — once, and the rejection is the feedback

The phase's third "done when" check says a bad set is "rejected and regenerated
rather than saved". A refused set is asked for **once** more with the refusals
named by question number, and a second refusal is permanent.

Once, for the reason the LLM adapter gives for its own single retry: a second
failure is almost always the model being asked the wrong question rather than
having a bad moment, and every attempt is a paid request against a customer's
credits.

**The two retries are at different levels and both are needed.** The adapter
retries output that fails the **schema** — malformed JSON, a missing field. This
retries output that passes the schema and is **not a quiz**. Neither can do the
other's job: the adapter cannot know what makes a question set unusable, and
this cannot see a parse failure. Grep `REJECT_AND_REGENERATE` and
`THE_REJECTION_IS_THE_FEEDBACK`.

### 4. A topic is still untrusted

A topic is three words the customer typed, so it looks harmless next to a Reddit
thread. It is fenced anyway, with `wrapUntrusted`, and `quizSystemPrompt()`
**takes no arguments** — the same property `condenseSystemPrompt()` holds, so
there is no parameter through which topic text could reach the operator channel
and no future edit can interpolate one by accident.

Two reasons, and the second is the one that matters: the customer is not the only
reader of their own topic field (Phase 17's API caller is a program, and a shared
workspace has several people in it), and a prompt that interpolates "harmless"
input into the system turn is one edit away from interpolating something else.

The committed test puts an attack — including an unmatched delimiter — in the
topic and asserts the fence is intact, the delimiter is stripped, the task is
restated after the fence, and the count and difficulty stay outside it. It
**does not call a model**, for the reason the Reddit injection test records: a
test that asked Claude whether it had been injected would cost money per run, be
non-deterministic, and prove nothing about the next model version. Grep
`TOPIC_IS_STILL_UNTRUSTED`.

### 5. The reveal is its own item, and the card holds through the countdown

The phase states it as a requirement: "keeping the reveal as its own item is
what lets the editor retime a reveal without touching the question". The obvious
build is one card per question that changes what it draws partway through, and it
is wrong for a reason that only shows up in Phase 15 — **an editor can only move
what the document names**, and a reveal buried inside a question item is not
addressable.

So: two items, back to back, on one scene track. And the question card ends
**where the next card's audio begins**, not where its own narration stops —
which is how "a question scene whose duration is narration plus the configured
countdown" is arrived at with no duration arithmetic anywhere: the next card's
start already includes the beat. Grep `REVEAL_IS_ITS_OWN_ITEM` and
`QUESTION_CARD_HOLDS_THROUGH_THE_COUNTDOWN`.

### 6. Word anchors, and the fallback that makes them survivable

The phase's step 4: "the reveal fires on the word that announces it, not on a
hard-coded offset, so re-recording narration keeps it in sync". Each card's
`start` is a `{ wordIndex }` anchor naming the first word of its own narration,
and the index is stable under re-recording because it is a position in the
**script**, not a time.

But an anchor naming a word the document does not have leaves the document
`anchored` forever (`PARTIAL_RESOLUTION`), which blocks the render — and a
failed or degraded alignment is a supported state (`EMPTY_WORDS_STILL_BUILDS`).
So a span with no words falls back to **seconds**. The video is then timed from
measured audio, which is exactly as accurate and merely less resilient to a
later re-record. The committed test asserts both forms validate. Grep
`ANCHOR_ONLY_WHEN_THERE_ARE_WORDS`.

The **duration** is always seconds, never an anchor: a duration anchored to a
word would have to name the first word of the *next* card, and a card whose end
depends on a word in somebody else's narration moves when an unrelated line is
re-recorded.

### 7. The quiz is the one format with no captions

A quiz emits **no caption lane**, and that is not an omission. The question and
its options **are** the on-screen text — drawn large, auto-scaled, inside the
safe zone — and a caption band under them would be a second copy of the same
words covering the fourth option.

It is also what makes the pronunciation overrides work. `phonetics` maps a term
to how it should be **said**, and it is applied only to the narration: "SQL" is
read as "sequel" and still reads as "SQL" on the card, because the card draws
`question` and `options` as the author wrote them and nothing on screen reads
from the narration text. That is the only arrangement that is right on both
channels, and it is how the phase's "an acronym with a phonetic override is
pronounced as specified" is met **without** adding SSML to a TTS contract that
deliberately has none.

`doc.words` is still populated — the anchors resolve against it. The words are
simply not drawn. Grep `QUIZ_TEXT_IS_ON_THE_CARD` and
`PHONETICS_ARE_SPOKEN_NOT_SHOWN`.

## Four cards, one component family

`IntroCard`, `QuestionCard`, `RevealCard` and `OutroCard` are **one** render
kind (`quizCard`) switching on `scene.layout`, not four registry entries. The
reason is in what they share rather than what they do: the palette read, the
safe-zone box, the auto-shrink, the entrance and the typography are identical,
and only the elements drawn differ. Four components would be four copies of the
font-band logic and the third copy would get it slightly wrong. Grep
`ONE_FAMILY_FOUR_LAYOUTS`.

**Auto-shrink steps font size by text LENGTH, in bands, and measures nothing.**
That is a constraint rather than a shortcut: this component runs in a Lambda
worker during a paid render, and a layout that depended on a measured text node
could differ between the browser preview and the render. A frame has to be a
pure function of its number and its props.

The smallest band is sized so that the **longest text the schema allows** — 200
characters — wraps inside the safe box. Truncation is therefore unreachable
through the product's own forms; the ellipsis (`-webkit-line-clamp`, which
applies without measuring) exists for a document written by hand or by a future
release with a higher cap. Grep `CARD_FITS_ITS_TEXT` and
`SHRINK_BEFORE_TRUNCATE`.

**The correct answer is marked three ways**, not one. Roughly one man in twelve
cannot reliably distinguish a tinted row from a neutral one, and for them a
reveal that only tints the answer has revealed nothing — which matters more here
than anywhere else in the product, because that information is the entire point
of the video. A tick, a heavier weight and the accent fill, and the tick is the
one doing the work. Grep `CORRECT_IS_NEVER_ONLY_COLOUR`.

**An unfamiliar layout falls back to the question card** when the scene has
options. That is not defensive clutter: the committed `quizFixture` predates this
phase and uses `quiz-four-up`, and it has to keep rendering.

## Two things that look odd and are not

**`quizzes` is a flag that is FALSE on `free`.** Unlike `redditStories`, which
is true everywhere because it exists to be switched off (`A_FLAG_NOT_A_LIMIT`),
this one is a genuine entitlement — and the phase spells out what that has to
mean: "a `flag` gates **every verb** of the resource automatically, queries
included — so a free workspace cannot even list quiz templates". Section 10 of
the procedure builder makes that true with no check in either handler, which is
the phase's seventh "done when" item. A client-side hide would leave the
procedure callable.

**`quizzes.previewQuestion` is a mutation, not a query.** It is the one place
this file departs from the Reddit router's shape, and deliberately: a model
request is not idempotent and must not be re-fired by a cache revalidation, a
window refocus or a retry. "Free" means free of **credits**, not free of cost —
which is also why it carries the resource's own rate limit.

## Narrowed or decided differently from the phase file

Three, and the first is the only one worth arguing about.

- **"Narration with SSML" (step 7) is implemented without SSML.** The TTS
  adapter's contract states, as a decision rather than an oversight, that it has
  "no streaming, no SSML, no voice management", and the two things SSML was
  wanted for are both achieved otherwise: the **countdown** is a gap in the
  narration lane, and the **phonetic overrides** are a respelling of the spoken
  copy while the card keeps the original. Adding SSML would have widened a seam
  every future provider has to implement, and put markup into
  `NarrationLine.text` that the aligner then has to reconcile against words
  nobody said. If a future phase needs real SSML — prosody, emphasis — that is a
  seam change with its own argument, not a side effect of this one.
- **`answerType: 'open'` still stores options.** The phase's own contract makes
  `options` required with a minimum of two, so an "open" question is a
  presentation choice: the question card does not draw the option list and the
  reveal still does, because the reveal has to name the right answer. Switching
  a finished quiz between the two is a settings change and a re-render, not a
  re-authoring. Grep `ANSWER_TYPE_IS_PRESENTATION`.
- **`storyboard` is skipped**, although the voiceover generator's own note
  predicted Phase 13 would need it. A quiz **is** multi-shot, but its shot order
  is entirely determined by the question set — intro, then a question and a
  reveal each, then the outro. There is nothing to decide, so the stage would be
  a progress row for an arithmetic step, and a stage that goes from pending to
  complete in the same instant is noise on a list somebody is watching. Phase 14,
  which picks different **imagery** per block, is where it becomes a real
  decision. `align` is **not** skipped, even though a quiz draws no captions,
  because the word timings are what the cards are anchored to.

## What is NOT in this phase

- **Leaderboards, interactive quizzes and 16:9 output** — the phase excludes all
  three.
- **A countdown sound.** `settings.quiz.countdownAssetId` is read and the track
  is built when it is set, but the Phase 11 library ships empty and there is no
  sfx picker, so the beat is **silent** by default. Silence is a complete video,
  which is why it is the working default rather than the broken one. The same
  unresolved licence category as the music bed applies (grep
  `MUSIC_LICENCE_IS_NOT_RESOLVED_YET`).
- **A question editor after generation.** The questions are baked into the scene
  track and are edited thereafter through the timeline editor, which is
  Phase 15 — the phase says so explicitly. Re-running the quiz panel replaces
  them.
- **Phase 11's empty background catalogue** and the **ELEVENLABS/R2/AWS gaps**
  are unchanged, so a quiz currently plays over the styled backdrop and no quiz
  has completed past `tts`.
