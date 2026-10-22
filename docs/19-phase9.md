<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 09 — the generate pipeline

Phases 06, 07 and 08 each built one step: a script, a narration, a set of word timings. This page
describes the thing that **runs all of them from one click** and lets the customer watch it happen.

Read this before Phases 11–16: every one of them adds a format or a stage, and the two extension
points below (`GENERATORS` and `PIPELINE_STAGES`) are where they plug in. Read **Rule 1 — compose,
do not reimplement** first; it is the decision the rest of the phase rests on.

## The one-sentence version

The pipeline is an **orchestrator, not a worker**: it invokes the three existing workflows as child
runs, records every stage transition in `pipeline_stage`, hands the result to the kind's own
generator to build a timeline document, and streams the stages to the browser over the SSE
transport that has been configured and unused since Phase 00.

## Where the code lives

| Path | Contains | Reaches a provider? |
| --- | --- | --- |
| `src/lib/types/pipeline.ts` | the 12 stage names, the 5 statuses, `StageUpdate` | **no** — pure |
| `src/lib/generators/types.ts` | the `Generator` / `GeneratorContext` contract | **no** — pure |
| `src/lib/generators/voiceover.ts` | the first generator | **no** — pure |
| `src/lib/generators/registry.ts` | kind → generator (**the extension point**) | **no** — pure |
| `src/lib/palettes/index.ts` | what `style.paletteId` actually means | **no** — pure |
| `src/remotion/components/backdrop.tsx` | draws the styled background | no |
| `src/services/pipeline.service.ts` | the `pipeline_stage` table, status, holds | no |
| `src/inngest/functions/project-generate.ts` | **the orchestration** | via its children |
| `src/trpc/routers/projects.ts` | `generate` / `cancel` / `getStages` / `progress` | no |
| `src/components/global/stage-progress/` | the stage list + the `aria-live` region | no |
| `.../projects/[id]/generate/` | the screen | no |

Everything under `src/lib/generators/` and `src/lib/palettes/` is **pure** — no Prisma client, no
`server-only`, no React, no Remotion, no Node built-ins. That is what lets a generator run inside a
workflow step, inside a unit test with no database, and (from Phase 15) in the editor. Grep
`GENERATORS_STAY_PURE`.

## Rule 1 — compose, do not reimplement

The phase file lists the steps as `script → voices → tts → align → build`. Three of those already
existed as **workflows of their own**, each with its own credit hold, its own cache, its own
fan-out and its own degrade rules. So this pipeline `step.invoke`s them as child runs rather than
repeating their steps. Grep `COMPOSE_DONT_REIMPLEMENT`.

That buys three things a re-implementation would have thrown away:

- **Each child still owns its own money.** One hold per unit of paid work, taken and settled by the
  code that knows what was actually done: a fully cached narration reserves nothing, and a fully
  degraded alignment is not charged at all. A single pipeline-level hold could express neither.
- **Each child still owns its own caching.** Re-running a project whose text has not changed makes
  zero TTS calls and zero STT calls, because `project.tts` and `project.align` check that
  themselves. The phase's resume behaviour comes for free.
- **A child's steps are its own steps.** Phase 07's narration is one step per line across dozens of
  lines; hosting that inside this run would make a resumed pipeline replay every one of them.

The cost of the decision is that **cancellation had to be pushed into the children**. Cancelling a
parent run does not cancel its children, so `project.tts`, `project.align` and `script.generate`
each gained a `cancelOn` matching `project/cancelled` on the same `projectId`. Without it, pressing
Cancel would stop the orchestrator while a provider kept billing. Grep `CANCEL_STOPS_PAID_WORK`.

## Rule 2 — the stage list never reshuffles

`PIPELINE_STAGES` is twelve fixed names in run order, and it is the contract between the workflow
and the UI. Two properties follow from it, and both exist because the one thing a progress display
must never do is move:

- **Every stage is written before any work happens.** The first step of a run seeds all twelve rows,
  so the customer's first frame shows the whole list with nothing done yet, rather than a list that
  grows. Grep `SEED_BEFORE_WORK`.
- **A kind that does not use a stage writes `skipped`, never omits it.** Grep `SKIPPED_NOT_OMITTED`.

`skipped` is therefore a **first-class status**, not an absence — and it carries a reason, because a
greyed row with no explanation reads as a failure. `voiceover` skips four:

| Stage | Why it is skipped |
| --- | --- |
| `visuals` | Phase 11 owns the footage library; until then the background is a gradient. |
| `storyboard` | One background and one narration — there is nothing to sequence. |
| `design` | The look is the caption style, already chosen on the captions screen. |
| `render` | Rendering is a **separate paid action** with its own hold, cap and resolution choice. |

That last one is worth stating plainly: **the pipeline does not render.** The phase's goal is a
*previewable* video, and `renders.create` (Phase 04) is where a billed render starts. Rendering
inside the pipeline would charge for an output nobody asked for yet.

**Which stages a kind skips lives on the generator**, not in the workflow — so adding a format in
Phase 12 cannot leave the orchestrator with a stale list of hard-coded exceptions. Grep
`SKIPS_LIVE_ON_THE_GENERATOR`.

### `qa` runs before `timeline`, and that is deliberate

The stage order puts `qa` before `timeline`, so `qa` checks that the **pieces** are present and
consistent — audio for every line, a measured duration on each — rather than checking the built
document. The document is validated inside `timeline` itself, with the timeline module's own
`validate()`, where a failure can name the item that broke. A `qa` that ran after the build would go
green *after* the stage below it, which is the reshuffling problem in a different costume.

## Rule 3 — one run per click, enforced by the key

Two rapid identical requests must produce one run. A status check cannot deliver that: both requests
read `draft` before either writes `generating`, which is the ordinary double-submit race. So the
guarantee lives in the **enqueue key** instead. Grep `IDEMPOTENCY_IS_PROJECT_PLUS_SHAPE`.

The phase asks for `projectId + docHash`, and the subtlety is *which* document: on a first run there
is no timeline document, because building one is the point. What is hashed is the **input shape** —
the project's kind, aspect, settings and source, plus its script blocks and its narration lines'
text hashes. Identical clicks hash identically; a genuine second attempt after an edit does not.

This needed `hashDoc`'s argument widened to any JSON-shaped value (`hashValue`). It reuses the
module's canonicalisation rather than a `JSON.stringify` at the callsite, because key order would
otherwise change the key and every new settings field would silently break the guarantee. Grep
`SAME_HASH_FOR_ANY_SHAPE`.

Retry passes `force`, which appends a one-second time bucket — a failed run's inputs are by
definition unchanged, so without it the key would collapse the retry into the run that just failed.

## Rule 4 — the stream and the poll are one read

`projects.progress` is the **first `.subscription()` in this codebase**, and it needed no new
infrastructure — which is the point. The SSE transport has been configured and unused since Phase
00: `initTRPC` carries the `sse` block with its five-minute cap and ten-second ping, the client's
`splitLink` already routes subscriptions to `httpSubscriptionLink`, and the route already sets
`X-Accel-Buffering: no`. Grep `FIRST_SUBSCRIPTION`.

Three decisions make it work:

- **Each yield is a complete snapshot, not a delta.** Twelve rows is under a kilobyte, and a
  snapshot makes reconnection trivially correct: the client discards what it had and renders what
  arrived. There is no state to resynchronise and no `tracked()` id to resume from. Grep
  `SNAPSHOT_NOT_DELTA`.
- **The server polls the database, and that is honest rather than ideal.** There is no pub/sub in
  this stack: the writes come from Inngest workers in *other processes*, so nothing in the web
  process can be notified when a stage row changes. The poll is on the **server**, which is what the
  customer gains — one connection instead of a request every two seconds, and no tab-throttling of a
  background timer. If a real pub/sub arrives, the change is the body of that loop and nothing else.
  Grep `WHY_THE_SERVER_POLLS`.
- **`getStages` returns exactly what `progress` yields.** Same `StageUpdate[]`, so the component
  renders one shape and neither transport has a renderer of its own. The client turns the poll on
  when the subscription is not connected and off when it is, read from the subscription's own
  status. Phase 17's REST API uses the query and never touches the stream. Grep
  `STREAM_AND_POLL_ARE_ONE_READ`.

`elapsedMs` is derived **on the server**, where the clock is authoritative; a browser clock ten
minutes off would otherwise show a stage that has been running for minus ten minutes. The row's
stopwatch then advances locally by counting ticks on top of that figure — not from `Date.now()`,
because this codebase enforces React's purity rules with eslint and a clock read during render
breaks them. Grep `ELAPSED_TICKS_LOCALLY` and `RENDER_STAYS_PURE`.

## Rule 5 — failure is explained, never dumped

A failed project shows the failing stage, one plain sentence, and Retry. The rule is enforced in the
**service signature**: `failStage` takes a reason and nothing else, so there is no parameter a
provider's stack trace could travel through by being the easiest thing to hand. Grep
`FAILURE_IS_EXPLAINED_NOT_DUMPED`.

Expected refusals write their own precise message at the step that found them — *"Assign a voice to
OP and A before generating"*, *"There is no script and nothing to write one from"*. Everything else
goes through `explainFailure`, which **matches against** the engine's message and never shows it;
the one case worth distinguishing for a customer is the one they can fix, which is running out of
credits. Grep `NEVER_SURFACE_A_PROVIDER_MESSAGE`.

Two things are deliberately *not* failures:

- **A degraded alignment completes with a warning.** The phase requires that a video still finishes
  with STT disabled; failing there would throw away a narration already paid for. Grep
  `DEGRADE_IS_A_WARNING_NOT_A_FAILURE`.
- **A completed stage can carry a message.** A warning is not a sixth status — the stage genuinely
  completed — so the UI renders a completed row with a message as a caution.

## The money

Nothing in this phase takes a credit hold of its own; the three children each take and settle their
own. What this phase owns is the **two exits where nobody settles**:

| Exit | Who releases | How |
| --- | --- | --- |
| A child fails | that child's `onFailure` | its own hold, as before |
| The parent fails between children | `project.generate`'s `onFailure` | `releaseProjectHolds` |
| The run is **cancelled** | `projects.cancel` | `releaseProjectHolds` |

The cancellation row is the one that needed building. **Inngest does not run `onFailure` for a
cancelled run** — there is no failure — so the cleanup the failure path performs never happens, and
a hold would sit against the balance until Phase 05's reconciler noticed. `releaseProjectHolds`
releases the holds under all three of a project's ledger namespaces (`script:`, `tts:`, `align:`),
named explicitly rather than "everything for this workspace", so it cannot cancel a render the
customer started separately. Grep `CANCEL_RELEASES_EVERY_HOLD` and `PROJECT_HOLD_REFS`.

`projects.generate` deliberately performs **no up-front balance check**, unlike `scripts.generate`
and `renders.create`. This run's cost is the sum of three jobs whose sizes are not known until the
script exists, so any number compared here would be a guess that refuses runs which would have
succeeded. Grep `CREDITS_ARE_REFUSED_BY_THE_CHILDREN`.

## The generator contract

```ts
export interface Generator {
  kind: ProjectKind
  skips: readonly PipelineStageName[]
  build(ctx: GeneratorContext): Promise<TimelineDoc>
}
```

A generator takes facts and returns a document. It does not save, enqueue, charge or touch a
provider — the workflow owns all four. Grep `BUILD_IS_THE_WHOLE_CONTRACT`.

`GENERATORS` is a **`Partial<Record<ProjectKind, Generator>>`**, not a full one, and the difference
from `FIXTURES_BY_KIND` is worth understanding. A fixture must exist for every kind — that is what
makes the validation tests cover a new format the day it is declared — and a fixture is a
hand-written example anyone can write. A generator is the real thing, so demanding one per kind
would mean declaring a format and building it in the same change. The absence is the honest state,
and `resolveGenerator` turns it into a named error the UI puts in front of the customer. Grep
`DOCUMENTED_GAP_NOT_A_STUB`.

### The voiceover generator

- **Narration is laid end to end** by accumulating measured durations, with no gaps. This has to
  agree exactly with how Phase 08 offset each line's words into one narration-wide array; if the two
  drift, captions desynchronise further with every line and nothing notices. There is a test that
  asserts the agreement directly. Grep `OFFSETS_MATCH_ALIGNMENT`.
- **Ducking is requested, not baked.** The music item carries `duck: true` and no gain curve; the
  renderer computes the curve from the narration windows at draw time. Baking it would freeze the
  mix against word timings that re-aligning is allowed to move. Grep `DUCK_IS_A_REQUEST`.
- **Music is optional and normally absent.** There is no music library until Phase 11, so the track
  exists only when the project's settings name an asset — emitting an item pointing at nothing would
  claim a bed the video does not have. Grep `MUSIC_IS_OPTIONAL`.
- **No words still builds.** With no alignment at all the document has audio, a background and no
  caption track, rather than failing. Grep `EMPTY_WORDS_STILL_BUILDS`.
- **The document leaves anchored.** Caption items are addressed by word range and carry no `start`,
  so a document claiming `resolved` is one `validate()` refuses. Grep `GENERATED_DOC_IS_ANCHORED`.

## The styled background

`style.paletteId` has been in the timeline document since Phase 01 and nothing ever resolved it.
This phase is the first that had to, so `src/lib/palettes/` answers "what does `warm` mean" in one
place — and the ids are **the ones existing documents already hold** (`warm`, `mono`, `electric`,
`noir` from the fixtures, `default` from the v1 migration). Picking new names would have left every
stored document pointing at a palette that does not exist. There is a test that asserts every
fixture's palette resolves.

`backdrop` is a **new render kind**, not a `media` item, because a MediaClip draws an *asset*: it
needs a handle in `doc.assets`, a signed URL and an ingest behind it. A gradient has no bytes
anywhere, so expressing it as media would mean minting an Asset row for two colours and metering it
against the workspace's storage quota. Grep `BACKDROP_IS_NOT_MEDIA`.

Adding the kind was **not a document migration**: it is a new value in an open-ended enum, so every
stored document is still valid and there is nothing for a migration step to change. Grep
`ADDING_A_KIND_IS_NOT_A_MIGRATION`.

It sits on a **scene** track, which is the only lane that fits — a video item is required to carry
an `assetId` and an overlay would composite above the captions — and its palette travels in
`scene.elements` because a component never receives the document. The generator emits a backdrop
**or** (from Phase 11) a video item, never both. Grep `PALETTE_IS_BAKED_ONTO_THE_ITEM`.

## The screen

`/dashboard/projects/[id]/generate`. The stage list is a global component
(`components/global/stage-progress/`) that knows nothing about projects or pipelines: it takes
`StageUpdate[]` and renders it, and the buttons, the failure banner and the strip arrive as **slots**
— so the render pipeline can reuse it. Grep `SLOTS_NOT_BRANCHES`.

- **Transitions are announced.** A `polite` `aria-live` region holds **one sentence at a time**,
  describing the most recent transition rather than re-reading twelve rows on every change. A
  progress UI that communicates only by colour and motion is unusable for part of the audience, and
  a generation runs for minutes with nothing else to tell you where it is. Grep
  `ANNOUNCE_TRANSITIONS`.
- **Every row carries a glyph and a word**, not just a tint, so the state survives greyscale and a
  bright phone screen outdoors. Grep `STATUS_IS_NOT_ONLY_COLOUR`.
- **There is no local "is it running" flag.** Whether a run is in flight is derived from the
  **stages**, which is what makes the screen correct after a refresh, in a second tab, and for a
  teammate watching the same project. Grep `SERVER_IS_THE_SOURCE_OF_TRUTH`.
- **It says the tab can be closed**, because nothing else on the screen would imply it.

### The strip is tiles, not thumbnails

The phase asks for "a thumbnail strip filling in". Nothing in this app renders video frames outside
a render, so real thumbnails would mean rasterising frames mid-pipeline — work the customer pays for
in order to watch a progress bar. What the strip shows instead is the **narration fan-out**: one tile
per line, turning solid as its audio lands and red if it could not be recorded. It answers the same
question ("how much of my video exists yet") with information that is actually true. This is a
deliberate substitution, recorded here rather than quietly made. Grep `TILES_NOT_THUMBNAILS`.

## Gating

`projects` gained two permissions, because an action with no permission to gate it is an action
every member can take whatever their role — the same gap Phase 02 found on `assets` and Phase 08 on
`captionStyles`:

- **`projects:generate`** — starting a run spends credits against three providers, so gating it as
  an `update` would mean anyone who can rename a project can spend its balance. Grep
  `GENERATE_IS_NOT_AN_UPDATE`.
- **`projects:cancel`** — stopping a run somebody else started is a different trust decision from
  starting your own.

The daily cap is `rateLimit: { generate: { count: 30, window: '1 h' } }` on the registry entry, and
the procedure factory applies it off the path verb like every other one. It is **not** a plan limit:
`limit` caps how many projects a workspace holds, and what is worth capping here is how often the
paid pipeline may be *started*. Grep `DAILY_CAP_ON_GENERATE`.

The workflow re-checks ownership itself, because it runs outside `protectedProcedure` and gets none
of its gates: every read and write goes through a function that takes `organizationId` and puts it in
the `WHERE` clause, and there is no call in the file that loads a project by id alone. Grep
`RECHECK_OWNERSHIP_IN_THE_WORKFLOW`.

## Status

**Verified.**

- **The pure halves, by 41 new tests** (the suite is 649 and green): the generated document against
  the timeline module's own `validate()` in both its anchored and resolved forms; the line offsets
  matching Phase 08's stitching exactly; ducking and speaker tagging; the no-words and no-lines
  cases; the stage mapping's ordering, its completeness, its unknown-name and unknown-status
  handling and its clock-skew clamp; the idempotency hash's key-order insensitivity and its
  sensitivity to a changed script, setting or re-recorded line; every fixture's palette resolving
  and every palette's text colour passing the caption library's own contrast rule.
- **The migration is applied**; `migrate status` reports up to date and `migrate diff` reports no
  drift.
- **The workflow registers and serves.** `/api/inngest` reports **17 functions** — ten registered
  entries plus the seven failure handlers.
- `tsc --noEmit`, `eslint` and `next build` are clean, with
  `/dashboard/projects/[id]/generate` present.

**NOT verified — needs an `ELEVENLABS_API_KEY` and R2.**

No generation has ever run to completion, because the `tts` stage cannot synthesise audio without a
key and cannot store it without object storage. `ANTHROPIC_API_KEY`, `DATABASE_URL` and
`RESEND_API_KEY` are set, so the `moderate`, `script` and `voices` stages have everything they need;
`tts` onwards does not. Every end-to-end check in the phase file is therefore untested:

- A prompt producing a narrated, captioned video that previews and renders.
- Killing the dev server mid-run and resuming from the failed step.
- Cancelling stopping the run, marking it `cancelled` and releasing the hold.
- Two rapid identical requests producing one run — the hash is tested, but no duplicate enqueue has
  ever been collapsed by a real queue.
- Stage transitions arriving over SSE without a refresh, and the fallback to polling.
- Closing the tab not stopping the job.
- A degraded-captions completion with a visible warning.
- A screen reader announcing each transition.

## What Phase 09 did not finish

- **Real moderation.** The `moderate` stage completes with a warning that says so, rather than a
  green tick with no check behind it. Phase 10.
- **Backgrounds beyond a gradient.** Phase 11. The `visuals` stage writes `skipped` with that reason.
- **The other three formats.** `reddit-story`, `quiz` and `motion` can be created and have fixtures,
  but have no generator, so `projects.generate` refuses them by name. Phases 12, 13 and 16.
- **A music bed has no picker.** The generator reads `settings.generate.musicAssetId` and the
  timeline honours it with ducking, but no screen sets it — it needs the Phase 11 library.
- **The credit rates are still placeholders** (Phase 05).
- **Phase 04's AWS deploy** and **Phase 02's R2** remain open.

## Where to go next

`docs/20-phase10.md` for safety and launch limits — which is what turns the `moderate` stage from a
warning into a check.
