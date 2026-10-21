<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 07 — voices and TTS

`docs/16-phase6.md` describes where a script's words come from. This page describes making them
audible: every line has a speaker, every speaker has a voice, every line has a cached audio file —
and re-synthesising unchanged text costs nothing.

Read this before Phase 08 (word timings are aligned against these recordings), Phase 09 (the
pipeline composes this step) and Phase 15 (the editor's main caller is `line.resynth`). Read **The
cache key covers the voice** first — it is the decision that costs money or trust when it is wrong,
and it is the same shape as the Phase 04 bug that shipped.

## The one-sentence version

A script is split into **lines** — the unit of re-synthesis — each line is cached by
`hash(text + voiceId)`, and a fan-out synthesises only what is missing, normalises its loudness and
stores the **measured** duration.

## Where the code lives

| Path | Contains | Reaches a provider? |
| --- | --- | --- |
| `src/lib/narration/split.ts` | line splitting | **no** — pure |
| `src/lib/narration/hash.ts` | the cache key | **no** — pure |
| `src/lib/voices/map-labels.ts` | provider labels → filter enums | **no** — pure |
| `src/lib/adapters/tts/` | the `TtsAdapter` contract + selector | no |
| `src/lib/adapters/tts/elevenlabs/` | the implementation + the key | **yes, only here** |
| `src/services/voices.service.ts` | catalogue, cast, `validateAssignments` | no |
| `src/services/narration.service.ts` | lines and the cache lookup | no |
| `src/inngest/functions/narrate-line.ts` | **the one recording path** | yes |
| `src/inngest/functions/project-tts.ts` | the fan-out | via the above |
| `src/inngest/functions/line-resynth.ts` | one line, re-recorded | via the above |

## Rule 1 — the cache key covers the voice

`NarrationLine.textHash` is `hash(text + voiceId)`, **not** `hash(text)`.

That is the whole point. The same words in a different voice are a **different recording**, so a
hash of the text alone hands a customer the *previous speaker's* audio the moment they change the
cast:

> recast `OP` from Ava to Ben → every line's text is unchanged → cache hit on every one → the
> video comes out in Ava's voice → **nothing errors**, because the hit is a real row with real
> audio behind it.

It is the same class of mistake as Phase 04's render key being `hashDoc(doc)` alone, which shipped
and had to be fixed: **a key that describes the INPUT rather than the OUTPUT** looks right and is
wrong in exactly the cases that cost money or trust.

Two more decisions inside it:

- **Whitespace is normalised; case and punctuation are not.** Reflowing a line is free; `"stop."`
  and `"Stop!"` are different recordings because they are spoken differently.
- **The two halves are joined by a separator** that cannot appear in a cuid or in normalised text.
  A separator-free concatenation is the classic way to make `("ab","c")` and `("a","bc")` collide.

Reuse is scoped to **one workspace**. Two tenants writing the same sentence in the same voice each
pay once, and that is deliberate: the audio is a tenant's asset, under their storage prefix and
deletable by them, so a cross-tenant reuse would hand one workspace a file another can delete out
from under it. Grep `REUSE_WITHIN_THE_WORKSPACE`.

## Rule 2 — the line is the unit of re-synthesis

A `ScriptBlock` becomes one or more `NarrationLine` rows, and the split decides **what a one-word
edit costs**.

Leave a 400-character block whole and fixing a typo in its last sentence re-records the whole
thing — a provider call, and a noticeably different take of every sentence before the typo. The
delivery drifts and the customer hears the seam.

But splitting is not free either: a sentence cut mid-clause is synthesised with the intonation of a
complete thought, and stitching those together sounds worse than one long take. So:

- **Sentence boundaries only**, never a character count.
- **Sentences accumulate** until the next would exceed the cap, so four short sentences stay one
  line rather than four separate takes.
- **A trailing fragment below the minimum merges back.** "Yes." is not worth a recording of its
  own, and alone it is synthesised without the sentence it answers.
- **A single sentence over the cap is not split.** There is no safe place to cut one, and the
  provider handles a long sentence far better than an arbitrary break would.

### Abbreviations are not endings

The naive rule — split on `.`, `!`, `?` — cuts `Dr. Chen` and `approximately 4.2 billion` in half,
and each half is then synthesised as a separate thought. A speaker saying "Dr", pausing, then "Chen
said" is **immediately audible** and invisible to any test that only checks types.

So a boundary requires the punctuation to be followed by whitespace *and* a capital, and the token
before it must not be a known abbreviation or a bare number. That is not a full sentence tokeniser
and does not need to be: a missed boundary costs one slightly longer line, while a false one costs
an audible break — so the rule is deliberately conservative.

**Positions are stable across regeneration**, numbered across the whole script rather than per
block. Per-block numbering makes two blocks' line 0 collide; stability is what makes a `textHash`
cache hit land on the *right* line rather than merely on a line with the right words.

## Rule 3 — one recording path

Both workflows that produce narration call the same function:

```
project.tts  ─┐
              ├─→ narrateOneLine()  → cache? → synthesise → normalise → store → mark ready
line.resynth ─┘
```

It was **extracted the moment the second caller needed it**, not duplicated. Two copies drift
within a phase, and the drift here would be *audible*: one path normalising and the other not is a
narration that jumps in volume at exactly the lines somebody edited. Grep `ONE_RECORDING_PATH`.

Inside it, a cache hit and a synthesis **end identically** — same row write, same status — so a
retried step cannot tell them apart and does not have to.

The cache is checked **again** inside the step rather than trusted from the plan, because a line
earlier in the same run may have just produced audio for identical text: a script that repeats a
phrase pays once.

## Rule 4 — loudness is normalised, duration is measured

Synthesised lines are **not uniformly loud** — different voices, and even different lines in one
voice, come back at different levels. Cut together untouched, a narration audibly jumps at every
line break, and the Phase 03 ducking curve then ducks the music against a moving target.

So every line goes through `normalizeLoudness` before storage: EBU R128 via ffmpeg's `loudnorm`,
targeting **−16 LUFS** — the streaming convention for spoken content, loud enough to sit over a
music bed and quiet enough that the platform's own normalisation does not pull it back down.

Single-pass, deliberately: two-pass is more accurate but means two ffmpeg invocations per line
across dozens of lines, and speech has a narrow dynamic range. If narration ever includes music,
this is the line to revisit.

> **Verified against real ffmpeg**, which is the one provider-independent half of this phase. A
> deliberately quiet tone measuring **−44.4 LUFS** came out at **−16.4 LUFS**, with the duration
> measured from the normalised file (3.5s source, 3.5s measured).

**The stored duration is measured, never the provider's estimate.** The adapter returns one because
it is free and useful for a progress display, and the caller *overwrites* it. The timeline positions
captions, cuts and the music bed against these numbers, so an estimate compounds into visible
desynchronisation across a video. Grep `DURATION_IS_MEASURED_NOT_CLAIMED`.

## Rule 5 — the cast blocks generation

A project with an unassigned speaker is **refused**, not narrated in a default voice. A video in a
voice the customer did not choose is worse than one that did not start, because they only find out
after it is made.

`validateAssignments` returns the **tags**, not just a boolean, so the UI can say *"Assign a voice
to OP and A"* rather than "something is wrong" — the phase asks for exactly that: a disabled button
with the speakers named.

It distinguishes three states, and the third matters:

| Result | Meaning | Right UI |
| --- | --- | --- |
| `ok: true` | ready | enable the button |
| `ok: false`, tags listed | cast incomplete | name them |
| `ok: false`, `hasSpeakers: false` | no script yet | "write a script first" |

It also re-checks that each assigned voice still **exists and is active** — a voice the operator
withdrew leaves a speaker pointing at a row the picker no longer offers, and without this check
generation reaches the provider with a dead id and fails per line.

**Assignments survive regeneration.** `upsertSpeakers` never clears the cast: the customer picked
those voices, the tags usually stay the same, and wiping them would invalidate every `textHash` and
re-record the entire narration at full price.

## Rule 6 — per-line failure

A failure is recorded against the **line**, not the project. One line failing is recoverable — the
whole caching design exists so a re-run synthesises only what is missing — and a project-level flag
would throw away every successful line's work on the next attempt.

The fan-out is one `step.run` per line, so a run that produced twenty lines and then died re-enters
with those twenty replayed from memory and only the remainder actually synthesised. One step per
script would re-record the lot on every retry, at full price.

Concurrency is **one narration at a time per workspace**: a customer queueing six projects must not
saturate the provider and stall every other tenant behind their own backlog. `line.resynth` allows
two, because an editor session is interactive.

## The backup model

The adapter falls back to a **second model** before failing — the phase's step 1 — and the fallback
lives *inside the adapter* so every caller gets it without reimplementing. Putting it in the
workflow means the first caller to forget produces a failed render on a transient model outage.

Two decisions:

- **The backup is a different FAMILY, not a smaller version of the primary.** A backup that shares
  the primary's failure mode is not a backup — if the multilingual model is having a bad hour so is
  every variant of it, and the fallback buys one more failed call.
- **It does not fire on permanent failures.** A bad voice id, a bad key and an exhausted quota all
  fail identically on the backup; retrying is a wasted call and, on the quota case, a doubled bill.

Failures are classified by **status**, not message text:

| Status | Classified | Because |
| --- | --- | --- |
| 401/403 | permanent | the key is wrong — every line fails the same |
| 404 | permanent | the voice does not exist; the catalogue is stale |
| 422/400 | permanent | the request is malformed |
| 429 | **depends** | a rate limit clears by waiting; an exhausted character quota does not |
| 5xx | transient | worth the backup, then a retry |

The default here is **transient**, unlike the LLM adapter where it is permanent. The asymmetry is
deliberate: a TTS failure costs one line of an otherwise fine script and the retry is cheap,
whereas a failed script generation wastes a long expensive call.

## The catalogue

`Voice` has **no `organizationId`** — it is the operator's licensed library, read by every
workspace, exactly like library Assets. Licensed once, not per tenant.

### There is no seed file

The phase forbids an agent-written seed, and the provider voice ids **only exist in a real
account** — a hand-written list would be both a fiction and immediately stale. So the catalogue is
populated by an operator pressing **Sync from provider** in the portal.

`voices.sync` is gated to the **portal workspace** on top of the `voices:sync` permission: `Voice`
rows are shared, so a tenant able to write them could rename or withdraw voices for everyone.

Two rules make it safe to re-run:

- **It preserves operator edits.** The provider owns the *name* and the *id*; the operator owns
  `minPlan`, `isActive` and the descriptive labels. Writing the operator's fields too would reset a
  carefully tiered catalogue back to `free` — so the **second press of the button** would silently
  give away every premium voice. Grep `SYNC_PRESERVES_OPERATOR_EDITS`.
- **A missing voice is deactivated, never deleted.** It is still referenced by speakers, by lines
  already recorded with it, and by the `textHash` of every one of those lines. Deleting orphans all
  of that and — worse — changes what those hashes mean, so the next generation misses the cache and
  re-synthesises audio that already exists in a voice that no longer does. Grep
  `DEACTIVATE_NEVER_DELETE`.

### Label mapping is lossy on purpose

A provider labels voices with whatever its catalogue team typed — "Received Pronunciation",
"raspy", "middle-aged". Surfacing that gives the picker **thirty filter options for forty voices**,
at which point filtering stops narrowing anything. So labels are mapped onto a handful of browsable
axes.

Anything unmatched falls to `other`, **never to a plausible guess**. A voice mislabelled `british`
because the mapper reached for the nearest option is worse than one labelled `other`: the customer
filters for British, gets a result, and hears something else. `other` is visibly unhelpful, which
is the right kind of wrong — and the operator can correct it, because the sync never overwrites a
descriptive axis after creation.

Two substring traps are asserted directly, because both are silent: **"female" contains "male"**,
and **"african american" contains "american"**.

## Gating: two mechanisms, both needed

| | Answers | Shape |
| --- | --- | --- |
| `premiumVoices` flag | may this workspace use gated voices **at all** | one boolean — what a trial turns off wholesale |
| `Voice.minPlan` | **which ones** | a per-row plan threshold |

A boolean cannot express "available from Pro upward" alongside "available from Starter upward", so
`minPlan` cannot be a registry flag. The server checks **both** on assignment.

**Previews are never gated**, and it looks like a hole. A free workspace can play every premium
voice — deliberately, because hearing what you cannot yet use is the upsell, and a preview is a
pre-rendered asset so it costs no credits and no provider call. Only *assigning* is gated, and the
picker's lock badge is an affordance: the server refuses the assignment regardless.

## Status

Phase 07's box in `docs/phases/PROGRESS.md` is **unticked**, and the reason is broad: **no audio
has ever been synthesised and the catalogue is empty**, because no `ELEVENLABS_API_KEY` is set.

**Verified:**

- **Loudness normalisation against real ffmpeg** — the −44.4 → −16.4 LUFS result above, with the
  duration measured from the output.
- **The credential fence, probed.** This adapter uses `fetch` and has no SDK to restrict, so the
  fence is on `ELEVENLABS_API_KEY` itself — which is the thing actually worth confining. It rejects
  both `process.env["..."]` and `process.env....` from outside the adapter folder and stays silent
  inside it.
- **33 tests over the two pure decisions** — 24 on splitting and hashing (the `Dr.` and `4.2`
  cases, the short-fragment merge, position stability, and the voice being part of the key), 9 on
  label mapping (both substring traps).
- **All four workflows register and serve.** `/api/inngest` reports 13 functions, and the Inngest
  dev server lists `rotreels-project-tts`, `rotreels-line-resynth` and both failure handlers.
- The migration is applied; `migrate diff` reports no drift.

**Not verified** — every one of the phase's seven "done when" checks: a two-speaker script
producing one asset per line; a re-run making zero provider calls; a one-line edit re-synthesising
only that line; generation blocked with the speakers named; a free workspace seeing voices locked;
previews playing; and the backup model actually catching a failure. All are implemented and
unit-reasoned; none has met a provider.

## What Phase 07 did not finish

- **Voice previews are a separate pass.** The sync records that a voice has *none* rather than
  downloading a sample inline — that would make a sync a multi-megabyte download inside a request.
  The picker omits the play button until then. Needs R2, still unconfigured from Phase 02. Grep
  `PREVIEWS_ARE_A_SEPARATE_PASS`.
- **Narration audio needs R2**, like everything else that stores bytes.
- **Re-alignment is Phase 08.** `line.resynth` deliberately does **not** call an aligner — a call to
  one that does not exist would be a claim that timings were refreshed, which every later phase
  would be entitled to believe. Grep `ALIGNMENT_IS_PHASE_08`.
- **Word timings, avatars, and voice cloning** — Phase 08, Phase 12, and never, respectively.
- **The credit rates are still placeholders** (Phase 05). Narration charges on them.

> **No clones of real people or third-party characters, ever.** It is a legal position, not a
> preference, and the adapter contract is shaped to make it unreachable: there is no `cloneVoice`,
> no audio-input parameter, and no voice-management surface anywhere in `TtsAdapter`. A contract
> that cannot express cloning cannot accidentally grow it.

## Where to go next

`docs/phases/08-alignment-captions.md`. What it inherits:

- **`NarrationLine.audioAssetId` and its measured duration** are what the aligner runs against —
  and the reason the duration is measured rather than estimated.
- **`line.resynth` has a deliberate gap** where the re-alignment call belongs.
- **The line is already the unit of work**, so per-line word timings need no new partitioning.
