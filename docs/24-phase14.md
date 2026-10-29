<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 14 — voiceover visuals

Phase 13 proved a new FORMAT plugs into the pipeline without touching it. This
phase is the other kind of test: a new **capability** inside an existing format.
The `voiceover` kind stops being a narration over one background and gets a
picture per paragraph — which means two new provider seams, a stage that was
reserved for it in Phase 00 and skipped ever since, a per-image price, a
per-plan quota, and the first thing in this product whose **provenance has to
survive the video**.

The one decision to read if you read nothing else is the fallback chain, and the
discipline that makes it safe: **every step of it is allowed to fail, and none
of them is allowed to fail the video.**

## The one-sentence version

A block's picture comes from **the first of three things that works** — the best
matching stock clip, a generated image, or the styled background — and with both
providers unconfigured the third one is reached for every paragraph and the video
is complete, just plainer.

## Where the code lives

| Path | Contains | Reaches a provider? |
| --- | --- | --- |
| `src/lib/types/visual.ts` | the choice union, the stored shape, the prompt cache key | **no** — pure |
| `src/lib/visuals/select.ts` | which clip is best for a block, and the tie-break | **no** — pure |
| `src/lib/adapters/stock/hosts.ts` | the download host allowlist | **no** — pure |
| `src/lib/adapters/stock/` | the seam, and the Pexels client | the stock seam |
| `src/lib/adapters/image/` | the seam, and the image client | the image seam |
| `src/lib/script/visual-prompt.ts` | the fence, and the two kinds of writing | **no** — pure |
| `src/lib/script/visuals.ts` | the one model call for the shot plan | the LLM seam |
| `src/lib/generators/common.ts` | `buildBlockVisualTracks` and the per-stretch fallback | **no** — pure |
| `src/lib/generators/voiceover.ts` | the branch between one background and per-block pictures | **no** — pure |
| `src/services/visuals.service.ts` | **the chain**, both caches, the ingest, the moderation call | every seam |
| `src/inngest/functions/visual-ingest.ts` | one run per block: fetch or generate, then hand over | via the service |
| `src/inngest/functions/project-generate.ts` | the `visuals` stage: budget, plan, hold, settle | via the service |
| `src/trpc/routers/visuals.ts` | `list`, `searchStock`, `setBlockVisual` | via the service |
| `src/components/global/visual-picker/` | the per-paragraph list and the swap drawer | no |

There is **one migration**, and it adds columns rather than tables — see
"Provenance is a column, not a comment" below.

## The chain, and why it is one function

`resolveBlockChoice` in `src/services/visuals.service.ts` is the whole of the
phase's step 4, in order: search stock, then decide to generate an image, then
fall back to the background. Three properties make it work, and all three are
easier to get wrong than right.

**It never throws.** A stock outage, an unconfigured key, a query that matched
nothing, a refused prompt, an exhausted quota and an empty balance all produce
the same value: `{ source: 'background' }`. There is no error path, because
every caller's response to all six is identical — and the one place an
exception would be tempting (the image generation) is deliberately NOT in this
function. Grep `CHAIN_NEVER_THROWS`.

**The model call happens before the chain, and the image call after it.** The
shot plan is one request for the whole script (`ONE_CALL_FOR_THE_SCRIPT`); the
chain then runs per block and decides that an image *should* be generated,
returning the prompt and its hash. The generation itself happens in the ingest
workflow, where a two-minute provider call belongs — and that split is also what
makes the prompt cache work *before* anything is spent, because a cached prompt
comes back from the chain already pointing at its asset.

**A block that fell back is RESOLVED, not missing.** `background` is a real
member of the source union rather than a null, because a null would be
indistinguishable from "nobody has looked at this yet" — and the entire promise
of the phase is that an unconfigured deployment produces finished videos. Grep
`FALLBACK_CHAIN_IS_THE_POINT`.

## Provenance is a column, not a comment

The phase is blunt: "a stock clip whose provenance is unrecorded is unusable the
moment anyone asks". `Asset.license` already held the terms; what did not exist
was **where a row came from**. So `asset` gained `sourceProvider`, `sourceId`,
`attribution` and `promptHash`, all nullable, with no backfill — an upload, a
render output and every row written before this phase legitimately have no
third-party provenance, and a default would be a claim nobody checked.

Three things follow from that, and they are the reason it is a column:

- A stock choice **cannot be constructed** without a licence, a provider and
  that provider's id, because the zod union requires all three. The test for it
  is written as three separate refusals rather than one, since "it rejects a bad
  object" would pass if only one were required.
- The licence **travels with the document** on the asset ref, so a render can be
  refused months later without re-reading anybody's terms.
- `promptHash` is indexed per workspace, which is what makes the phase's
  "re-running with an identical prompt makes no second model call" true before
  the money moves rather than reconciled after it.

Pexels does not return a per-clip licence, because its whole library is under
one — exactly the situation where an adapter leaves the field empty or writes
`"stock"`. It is a named constant in the adapter's own config instead, where it
is obvious that it belongs to that provider and has to be revisited if the terms
change. Grep `LICENCE_IS_A_CONSTANT_NOT_A_GUESS`.

## It touched shared code four times

Everything else plugged into what Phases 09–13 built. These four are the
interesting part.

### 1. `NarrationLine` remembers its block

A per-block visual has to be timed to the words of that block, and
`splitBlockIntoLines` turns one long paragraph into several takes — so "the span
of block X" is the union of several lines' spans, and nothing recorded which
lines belonged to which block. `splitScriptIntoLines` had always carried a
`blockId` on its drafts "so an edit can be traced back" and the persistence
layer dropped it.

The alternative was re-splitting the script inside the context assembly and
pairing by position, which is the same mapping computed a second time from the
same inputs — and wrong the moment the split rule is tuned, with the symptom
being pictures one paragraph out. The column is nullable with no foreign key: a
block may be deleted while its recorded audio is still perfectly good, and a
cascade would delete narration the customer has already paid to synthesise.
Grep `LINE_REMEMBERS_ITS_BLOCK`.

### 2. A video item may carry `props`

`MediaClip` has read a `kenBurns` prop since Phase 03, with a note saying "a
generator can set it today". It could not: `videoItemSchema` is `.strict()` and
had nowhere to put one, so the only way to reach the drift was to draw a still
as an **overlay**, which would also have composited it above the captions.

It is an optional field in an existing object, so every stored document is still
valid and there is nothing for a migration step to change — the same argument
`ADDING_A_KIND_IS_NOT_A_MIGRATION` makes about `backdrop`, and the reason no
`docVersion` bump goes with it. It **is** hashed, because it changes the
picture: a customer who swaps a clip for a still must not be served the cached
render of the clip. There is a test in each direction for exactly that.

### 3. One function owns what is behind the words

This is the subtle one. A backdrop sits on the **scene** track, which composites
*above* video (`LAYER_ORDER`). So a document carrying both a full-length
backdrop and per-block clips draws a gradient over every picture, and the bug
looks like "my visuals did not apply".

`buildBlockVisualTracks` therefore returns a **list of tracks** — the clips and
the fallback over exactly the stretches they do not cover — rather than being
composed from two calls at a generator. Making it one function is what makes the
overlap structurally impossible; the test asserts the invariant ("no second of
the video has both") rather than a shape, because the shape has four cases and
the invariant has one.

### 4. The `visuals` stage, and a fourth hold namespace

The stage existed in `PIPELINE_STAGES` from Phase 00 and every generator skipped
it. `voiceover` now runs it, and `PROJECT_HOLD_REFS` gained `visuals` — a stage
that holds credits and settles them later is exactly the window that tuple
exists to cover, and a namespace missing from it is a cancelled run's money
stranded until the Phase 05 reconciler notices.

The stage is not skipped conditionally when no provider is configured, although
it could be. `skips` is **static** — `seedStages` reads it before a run starts
and cannot see a provider's configuration — and a customer whose video came out
plainer should be told which step decided that, rather than watching a greyed
row claim the feature does not exist.

## The decisions worth knowing

### A quota and a price, and both fire

`aiImages` is a **limit** resource with `period: 'month'`, and its `free` cap is
`0`. That is a real value and not a disabled feature: the gate refuses with the
upgrade modal and the meter reads `0/0`, which is a better upsell than the
feature vanishing. A `flag` was the obvious alternative and it cannot express
fifty a month on Starter against five hundred on Pro, which is the whole shape
of the feature.

The plan's allowance and the credit price are **independent and both enforced**.
The allowance says how many images a customer is entitled to; `perAiImage` says
what each costs on the ledger. The stage takes the **lower** of the remaining
quota and what the balance buys, so a customer can neither be charged for an
image their plan disallows nor given one free because the quota had room and the
wallet did not. Grep `A_QUOTA_AND_A_PRICE` and `VISUAL_BUDGET_IS_THE_LOWER_OF_TWO`.

The resource has no `delete` verb, for the reason `renders` has none: the
procedure factory auto-decrements a limit resource's counter on
`<resource>.delete`, so a delete verb would refund the monthly quota every time
somebody tidied up a picture they did not like.

### The settlement is on what was produced, not what was planned

The hold is taken against the images the plan asked for and committed against
the ones that were actually generated — which is routinely fewer, because a
prompt may have been refused, a model may have been down, or the cache may have
hit. The difference comes back through `PARTIAL_RELEASE`. That is the phase's
"nobody is ever charged for a video that was not made", applied per image.

### The narration is still untrusted

The shot plan is derived from the narration, which this app generated — which is
exactly why it feels safe and is not. The narration was written **from** source
material a customer supplied, so it is the laundering path the delimiter
discipline exists to block: a Reddit comment reading "ignore previous
instructions" that survived into a script block would otherwise arrive at the
visual prompt as an instruction.

So `visualSystemPrompt()` takes no arguments, the blocks go in the user turn
fenced by `wrapUntrusted`, and the committed hostile fixture checks that a block
carrying the delimiter itself cannot close the fence early. Grep
`NARRATION_IS_STILL_UNTRUSTED`.

### Keywords and poetry are different jobs, and the failure is silent

The model is asked for two kinds of writing per block and they are not
rephrasings of each other. A `query` is **search keywords** typed into somebody
else's keyword index; a `prompt` is a **description of a shot**. A model asked
for a "visual description" writes one every time, the search matches nothing, and
the video quietly falls back to the backdrop — which looks exactly like a library
that has nothing in it.

That is why the distinction is spelled out with a worked example of each, and why
the prompt test asserts the example is there. Grep `KEYWORDS_NOT_POETRY`.

### Coverage beats resolution

`src/lib/visuals/select.ts` scores a clip on three terms and coverage outweighs
pixel height by an order of magnitude. A 720-tall clip that covers an
eight-second paragraph looks better on a phone than a 4K clip that stutters four
times under it, and `LOOP_IS_A_MODULO` will happily do the stuttering.

Two things about that file are worth knowing. The tie-break compares
`providerId` as a string and is **load-bearing rather than tidy**: the pick ends
up in a document whose hash decides whether a paid render is reused, so a tie
broken by array order is a tie broken by whatever the provider felt like
returning that minute. And an unreported duration scores **half** the coverage
weight rather than zero — a test caught that, because zero is not neutral, it is
the worst possible score, and it made a clip of unknown length lose to one known
to stutter seven times. Grep `NEUTRAL_IS_THE_MIDDLE_NOT_ZERO`.

### A stored URL is the dangerous part

A `stock` choice is written to `Project.settings` and read back by a workflow
that fetches it **server-side with our own network position**. That makes
`downloadUrl` the one genuinely dangerous field this phase adds: anything that
can write a project's settings and get that URL fetched has a request-forgery
primitive aimed at our internal network.

The defence is an **allowlist** of the provider's own delivery hosts, checked in
two places — before a choice is stored, and again before its bytes are fetched —
because the first stops a mistake and the second stops a row written by an older
release or by somebody probing. A blocklist of private ranges has to be right
about DNS rebinding, redirects, IPv6 mapping and every metadata endpoint; an
allowlist only has to be right about where the bytes legitimately come from.

The comparison is on a **dot boundary**, never `endsWith`:
`pexels.com.attacker.example` passes a naive suffix test, and that one line is
the difference between an allowlist and a decoration. It has its own committed
test. Grep `NO_SSRF_THROUGH_A_STORED_URL`.

### One run per block

A five-block script is five ingest runs rather than one, which looks wasteful
until you ask what the alternative does when block three's prompt is refused. A
single run would either abandon blocks four and five or need its own per-block
error accounting. One run per block makes the queue do that for free: each has
its own retries, its own concurrency slot and its own failure handler, and a
block that cannot be fetched marks **itself** failed without touching its
neighbours. That is also the phase's "swapping one block's visual leaves the
other blocks untouched", enforced at the queue rather than remembered.

The event carries the **block id**, never the choice — a run that resumes after a
customer swapped the visual must not re-apply the one they just replaced. Grep
`CHOICE_IS_RE_READ_NOT_REPLAYED`.

Unlike the library sync, this run **waits** for the ingest it starts
(`step.invoke`, not `enqueue`), because the generate pipeline is waiting on the
answer: `resolveBlockVisuals` refuses an asset that is not `ready`, so a document
built a second too early would silently fall back to the backdrop for every
block. Grep `INGEST_IS_INVOKED_NOT_ENQUEUED`.

### Everything goes through `asset.ingest`

A stock clip and a generated image are ingested **like uploads** — same probe,
same `vertical_1080` / `proxy_480` / `thumb` variants, same readiness
transition. The visual ingest does only the one thing the upload path cannot:
get somebody else's bytes to a storage key. Three producers now, one pipeline —
which is what keeps "a generated image gets the same variants as an upload" true
six months from now, instead of one of two pipelines getting a fix.

No timeline item ever points at a provider URL, and that is structural rather
than remembered: `ResolvedBlockVisual` carries an `assetId` and nothing that
could be hotlinked, so a generator has no URL to reach for. Grep
`NO_PROVIDER_URL_IN_A_DOCUMENT`.

## Two things that look odd and are not

**`upload` is a fourth source, and the phase's contract names three.** The
phase's `resolveBlockVisual` returns `'stock' | 'ai_image' | 'background'`, and
its step 8 requires that a customer can "upload their own" for a block — which
is none of the three. Folding it into `stock` would record a Pexels licence
against a customer's own file, which is exactly the unverifiable provenance the
rest of this phase is built to prevent. So there are four values, the automatic
chain still only ever produces the phase's three, and the fourth is reachable
only from the swap drawer. Grep `UPLOAD_IS_A_FOURTH_SOURCE`.

**An `ai_image` asset is `source: 'generated'`, not `'ai_image'`.** The phase
says `Asset.source` "gains two values already allowed by the Phase 02 union:
`stock` and `ai_image`". `stock` was indeed already there; `ai_image` was not,
and `generated` was — meaning the same thing, and already carrying the open
owner decision about commercial rights for generated media. Adding a second
value for one concept would have made every query that asks "is this ours or
somebody else's" check two strings forever. The `ai_image` distinction lives on
the **choice**, which is where it is actually read.

**The shot plan is skipped when there is nowhere to spend it.** With no stock
search and no image budget, every block falls through to the backdrop whatever a
model proposes — so the model is not asked. That is not an edge case: it is the
state of every deployment that has configured neither key, which is the state
the phase requires to produce a complete video. Paying a model per generation to
decorate a decision already made is the kind of charge nobody would ever
attribute. Grep `NO_PLAN_WITH_NOWHERE_TO_SPEND_IT`.

## Narrowed or decided differently from the phase file

- **`Asset.source` gains no new value.** See above.
- **A generated image's moderation is `skipped`, not `pending`.** The same
  decision narration audio already carries: this is our own synthesis from a
  prompt the pipeline classified under the stricter `prompt` standard *before*
  the model was called, and the model applied its own policy on top. `pending`
  would withhold the image from the video it was generated for, which is the one
  outcome that makes the feature useless; `approved` would be a claim that
  something looked at the pixels, which nothing did. The ingest can still
  **reject** on the filename afterwards — this is the floor, not a bypass. Grep
  `GENERATED_IMAGE_IS_CLEARED_UPSTREAM`.
- **A stock clip is cleared for rendering only if the operator says so.** This
  was the hardest decision in the phase and both obvious answers are wrong, so
  it is worth reading `STOCK_REVIEW_ENGINE` in
  `src/inngest/functions/asset-ingest.ts` in full. In short: the default
  posture holds a third party's file `pending` because nothing has looked at its
  frames, which applied to stock footage makes the feature **dead** — every clip
  is fetched, transcoded and then withheld, so the video falls back to the
  backdrop having spent a search, a download and a transcode to get there.
  Writing `approved` unconditionally is the claim this codebase refuses
  everywhere else, and `LIBRARY_IS_APPROVED_BY_REVIEW` is no precedent for it:
  that approval is earned by a person reading a specific asset into a manifest,
  in a diff, and nobody reads a stock search result.

  So the claim moves to the only party who can make it. `STOCK_LIBRARY_PRE_CLEARED`
  defaults to false — the fail-closed posture is what ships — and setting it is
  the operator stating, for their deployment, that their chosen provider's
  library is moderated before publication. Each cleared clip's moderation record
  names the setting as the basis, so an auditor sees both that it was cleared and
  on whose authority. It can only promote a `pending` to an `approved`; a
  filename the classifier rejects is still rejected. Grep
  `THE_OPERATOR_MAKES_THE_CLAIM`.
- **The `storyboard` stage stays skipped for `voiceover`.** A multi-shot format
  is what the phase file imagined needing it, and a voiceover now is one — but
  its shot order is entirely determined by the block order, so the stage would be
  a progress row for an arithmetic step. The same argument Phase 13 made for the
  quiz.
- **No "choose for me again" endpoint.** Re-running the chain costs a model call
  plus a search per block plus possibly an image per block, and it belongs to the
  pipeline where the hold, the settlement and the ingest runs already live. The
  four things the phase asks a customer to be able to do are each one
  `setBlockVisual` with a different `choice`. Grep
  `THE_CHAIN_IS_NOT_RE_RUN_HERE`.

## What is NOT in this phase

Generated **video** footage, which the phase file assigns to Phase 17 — this
phase is stills and stock clips only. Editing a block's visual *after*
generation is the timeline editor's job (Phase 15); today the swap drawer is
used before a run, and changing a choice afterwards takes effect on the next
one, exactly as the background picker does.
