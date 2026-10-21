<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 08 — alignment and captions

`docs/17-phase7.md` describes how a script becomes audio. This page describes making that audio
**addressable**: every word gets a start and an end, and a library of 38 caption styles draws those
words so a caption lands on the word being spoken.

Read this before Phase 09 (the pipeline composes this step), Phase 12–14 (every format's reveal is
anchored to a word) and Phase 16 (motion graphics are timed off the same array). Read **Rule 1 —
the transcript is not the script** first: it is the decision that produces a video that is
confidently, invisibly wrong when you get it backwards.

## The one-sentence version

Each narration line is aligned against **its own audio file**, the transcript is matched back to
the words the customer actually wrote, the result is cached on a hash of every line's recording,
and a failed aligner **degrades to an even distribution** rather than failing the pipeline.

## Where the code lives

| Path | Contains | Reaches a provider? |
| --- | --- | --- |
| `src/lib/alignment/tokenize.ts` | script tokens, display + match forms | **no** — pure |
| `src/lib/alignment/reconcile.ts` | the back-match to the script | **no** — pure |
| `src/lib/alignment/degrade.ts` | even distribution, offsetting, stitching | **no** — pure |
| `src/lib/alignment/hash.ts` | the alignment cache key | **no** — pure |
| `src/lib/captions/styles/` | **the 38 styles, as data** | no |
| `src/lib/captions/chunk.ts` | 2–4 words per card, break rules | **no** — pure |
| `src/lib/captions/build-track.ts` | `buildCaptionTrack` | **no** — pure |
| `src/lib/captions/contrast.ts` | the WCAG rule the test runs | **no** — pure |
| `src/lib/captions/safe-zone.ts` | per-platform insets, the caption box | **no** — pure |
| `src/lib/adapters/stt/` | the `SttAdapter` contract + selector | no |
| `src/lib/adapters/stt/elevenlabs/` | Scribe, and the key | **yes, only here** |
| `src/services/alignment.service.ts` | the `alignment` table, the plan, the document write | no |
| `src/trpc/routers/captions.ts` | `styles` / `get` / `applyStyle` / `align` | no |
| `src/inngest/functions/project-align.ts` | the per-line fan-out | via the adapter |
| `src/components/global/caption-preview/` | **the one caption renderer** | no |
| `src/remotion/components/captions.tsx` | the Remotion adapter for it | no |

Everything under `src/lib/alignment/` and `src/lib/captions/` is **pure** — no Prisma, no
`server-only`, no React, no Remotion, no Node built-ins. That is what lets the same grouping, the
same box and the same colours run in the browser gallery, in the Player and in a Lambda. Grep
`CAPTIONS_STAY_PURE`.

## Rule 1 — the transcript is not the script

An aligner returns **what a model thought it heard**. The customer typed:

> AITA for telling my landlord the 2024 rent increase was illegal?

and the model returns `ay eye tee ay for telling my lanlord the twenty twenty four rent increase
was illegal`. Caption that and you have captioned **a different script from the one the customer
wrote** — no capitals, no punctuation, an expanded acronym, a spelled-out number — and nothing
errors, because the words are perfectly well-formed.

So the transcript is used for its **timings only**. The text is always the customer's.

The contract makes that hard to get wrong: `SttAdapter.align()` returns `HeardWord[]`, a different
type from the document's `WordToken`. A heard word has no index into `doc.words` and never will —
it is evidence about timing, not content. One type for both is exactly how a transcript ends up
stored as the script. Grep `TRANSCRIPT_IS_NOT_THE_SCRIPT`.

### The match is a global alignment, not a walk

`reconcileToScript(heard, scriptText)` runs **Needleman–Wunsch** over the normalised forms of both
sides — exact match, near match (a prefix, or a one-character difference on a word of four or
more), mismatch, gap.

A two-pointer walk was the obvious alternative and it is the failure that looks fine in a demo: it
works until the first mismatch and then **drifts for the rest of the line**. Global alignment with
gaps recovers — a run of unmatched tokens costs a gap, and the next real match pulls both sides
back into step. The matrix is per **line**, not per narration, so it is tiny.

Three things happen after the traceback:

- **Many heard → one written.** `AITA` matches at most one of its four spoken tokens. The other
  three are absorbed into the written word *before* them, extending its span — so the caption holds
  the screen for as long as the acronym was actually spoken, instead of flashing for a quarter of
  it. Grep `MANY_HEARD_TO_ONE_WRITTEN`.
- **Unheard words are interpolated**, weighted by length, inside the gap between two *measured*
  neighbours. A guess bounded at both ends by correct timings cannot accumulate; a word with no
  timing at all cannot be captioned.
- **Times are forced monotonic**, with a minimum duration. A provider is perfectly capable of
  returning two words with the same timestamp, and a zero-length word is a caption the renderer
  shows for no frames.

### Tokens keep their punctuation

`tokenizeScript` splits on **whitespace only** and carries two forms per token: `raw` (what the
customer wrote, punctuation and case intact) and `norm` (lower-cased, diacritics folded, symbols
stripped) for matching.

Splitting on punctuation too would break `Dr.`, `4.2`, `don't` and every hyphenated word into
fragments — the same mistake Phase 07's line splitter is careful about, one layer down. And the
caption chunker *breaks on punctuation*, so stripping it would silently disable that rule.

## Rule 2 — degrade, never fail

If the aligner fails twice on a line, that line's words are spread **evenly across its measured
duration**, the alignment row is flagged `degraded`, and the pipeline continues.

This is a product decision, not error handling. By the time alignment runs, the script has been
written and the narration has been recorded and paid for. A pipeline that stops there produces
nothing from all of it. A degraded video with a visible warning can be watched, judged, re-aligned
and published.

Three details:

- **Two attempts happen inside the step, not as workflow retries.** Inngest retries end in a
  *failed run*, which is the one outcome this rule forbids. Grep `TWO_ATTEMPTS_THEN_DEGRADE`.
- **A permanent failure degrades immediately** rather than burning the second attempt. A bad key
  or an unreadable file fails identically twice, and the second call is a wasted bill.
- **An empty transcript degrades too.** The provider succeeded and heard nothing — silence, or
  audio it could not read — and the back-match would return nothing, dropping the line's words out
  of the document entirely.

The distribution is **weighted by word length**, not equal. Equal slices are wrong in a specific,
visible way: short function words hold the screen as long as the long nouns around them, so the
captions run steadily ahead of the voice through a sentence and snap back at the end of it.

And the flag is a **column**, not an inference. It is the only thing standing between an estimated
alignment and a customer believing the captions are accurate. The screen turns it into a warning
with the fix next to it.

## Rule 3 — cache by the audio

Alignment is billed per minute, and audio rarely changes. `Alignment.audioHash` is
`fnv1a(position:textHash of every ready line, in order)`.

| Fold in | Why |
| --- | --- |
| each line's `textHash` | it already covers the line's **text and its voice** (Phase 07) |
| the line's **position** | the same sentences re-ordered are the same files and a different narration |
| nothing else | the style, the document and `updatedAt` would invalidate on a colour change |

Durations are deliberately *not* folded in: they derive from the same audio, so they add nothing a
change of audio would not already change — and a float in a cache key is a cache that misses on a
re-measurement that rounded differently.

### A degraded alignment is not a cache hit

This is the exception that makes the rule usable. A degraded row's hash matches its audio
**perfectly** — the audio is exactly what it was. Treat the hash match as "done" and a provider
outage freezes that project's captions at evenly distributed guesses forever, with the re-align
button doing nothing.

So `alignmentPlan()` — the single place that decides — returns `cached: false` for a degraded row.
Grep `DEGRADED_IS_NOT_A_CACHE_HIT`.

One function decides, and both the workflow and the screen's "Up to date" badge read it. Two
implementations would disagree the first time one of them was changed.

## Rule 4 — alignment is per line

Each narration line has its **own audio file**, so each is aligned on its own and the results are
offset by the durations before them and re-indexed into one array.

Concatenating the narration into one file and aligning that was the alternative. It loses three
things:

- A re-recorded line would re-align **everything**, at full price.
- It needs a temporary stitched file before any provider call can be made.
- It cannot attribute a word to a speaker — which per-line alignment gets for free, because the
  line already knows its speaker.

That last point is why `SttAdapter` has **no diarisation**. This app chose the voice and
synthesised the audio; asking a model to infer the speaker back out of it is paying for a worse
answer to an already-answered question.

`concatAlignedLines` re-indexes every word so `WordToken.i` equals its array position. The
document's validator checks exactly that, and every caption item and motion anchor resolves against
it — concatenate without re-indexing and word 0 appears once per line. Grep
`WORD_INDEX_IS_THE_POSITION`.

## Rule 5 — styles are data

`src/lib/captions/styles/` holds **38 styles across six families**, each a plain object: font key,
weight, case, size, tracking, line height, fill, highlight, optional highlight box, stroke, shadow,
animation, words per card, position band, `minPlan`.

Adding the thirty-ninth touches **no code** — it appears in the gallery, in the renderer and in the
contrast test by existing. That is what the phase means by "a new style is a data change, not a
deploy of new components".

Three rules hold the library together:

- **`defineStyle` starts from a legible base**, so a style's definition shows only what makes it
  that style. It also **parses** the result at module load: a style is data, so a `sizeVh` of 60
  type-checks perfectly and renders a frame of solid colour.
- **No escape hatch.** No `css`, no `className`, no `props: Record<string, unknown>`. The moment
  one exists, half the library expresses itself through it and the contrast test, the safe-zone
  check and the preview/render equivalence all stop covering what actually renders.
- **Duplicate ids throw at import.** A duplicate silently wins or loses on import order, so a style
  vanishes from the gallery on an unrelated change.

An unknown style id **falls back to the default** when rendering, and is **refused** when applying.
Those point opposite ways on purpose: a render of an old document naming a retired style has no
better option than the default, while a customer who picked a style and silently got another one
has no way to tell that is what happened.

### One renderer, three surfaces

`CaptionCard` lives in `src/components/global/caption-preview/` and takes **time as a prop**:

```
Remotion layer  → seconds = (item.from + useCurrentFrame()) / fps  ─┐
gallery preview → seconds = a looping rAF clock                    ─┼→ CaptionCard
Player          → the Remotion layer, unchanged                    ─┘
```

The phase's last check is "the same document produces identical captions in the Player and in a
cloud render", and the gallery has to show the same thing again before either exists. Three
implementations would agree on the day they were written and drift by the next style. Grep
`ONE_CAPTION_RENDERER`.

The gallery renders the card at **full canvas size inside a CSS `scale`**, not at preview size.
Rendering small would round every derived pixel — the font, the stroke ring, the safe inset —
differently from the render, which is how a caption that fits in the preview overflows in the
video.

### Colours are content, and the stroke is a ring of shadows

Every other surface in this codebase is forbidden literal colours and must use theme tokens. A
caption is the documented exception: it is burned into an MP4 by a headless browser with no
stylesheet, no CSS variables and no dark mode. A caption that followed `--foreground` would be
invisible over half the footage people put behind it.

The outline is drawn with **eight `text-shadow`s**, not `-webkit-text-stroke`. The webkit property
strokes the glyph *centre line*, eating into the letterform, and it renders at subtly different
widths in the Player's browser and in Remotion's headless Chrome — a preview that does not match
the paid output. A shadow ring sits outside the glyph and is identical in both. Grep
`STROKE_WITHOUT_WEBKIT`.

Casing happens at **draw time** and never touches `doc.words`. A style that upper-cased the stored
words would make a restyle rewrite the document, and `AITA` and `Aita` would be indistinguishable
after one round trip.

## Rule 6 — contrast is a test, not an eye

38 styles cannot be reviewed by looking at a gallery. They can on the day they are added and never
again, and the thirty-ninth arrives in a hurry. So the rule is executable and
`contrast.test.ts` runs it over the whole library.

The naive implementation — fill versus background at 4.5:1 — **deletes most of the library**, and
would be wrong to. A caption over footage is legible through its **outline**: white text with a
black stroke is readable on snow, and the fill alone is not.

So the rule asks, for pure white and pure black backgrounds (the worst cases at both ends):

1. Does the **fill** carry 4.5:1, **or** does a load-bearing stroke carry it while being at least
   3:1 away from the fill, so it reads as an outline at all?
2. The same for the **active word**, separately — a style whose highlight is a pale yellow over an
   otherwise legible white caption fails exactly where the viewer is looking.
3. A **boxed** highlight is judged against its box at 4.5:1, and the box-plus-word pair has to be
   visible against the footage. A near-black box holding white text is invisible *as a box* over
   dark footage and perfectly readable anyway, so either half may carry it.

A stroke thinner than 4% of the font size cannot count — it is a hairline at 1080p and gone at
preview resolution. Grep `MIN_LOAD_BEARING_STROKE`.

> A consequence worth stating: **no single colour passes 4.5:1 against both white and black.** A
> style with no load-bearing outline therefore cannot exist in this library. Four styles failed the
> check as first written and were recoloured before it shipped.

The test also proves the checker **refuses** something — a pale style and a hairline stroke are
both rejected by name. A test that only ever passes proves nothing about the checker.

The gallery shows the same verdict on each card. It should never be false; that is exactly why it
is worth showing.

## Rule 7 — restyling is free, and provably

`buildCaptionTrack(words, styleId, options)` returns a caption track of **word ranges**. Nothing it
produces carries a second.

```ts
{ id: "captions", type: "caption", styleId, items: [{ startWord: 0, endWord: 2, position: { y } }] }
```

Times are derived from `doc.words` by `captionRangeSeconds`, which is the only function in the app
that derives them. A restyle therefore **cannot** move a caption, even by accident — and the test
asserts it over the whole library rather than over two styles, because the thing that would break
it is one style doing something clever.

`start` and `duration` are deliberately **not** written here, even though the schema allows them.
They are a cache of a derived value, written by `resolveWordAnchors`, and `validate()` refuses a
resolved document whose caches disagree with its ranges.

### Grouping

2–4 words per card, and a card ends when:

| Condition | Why |
| --- | --- |
| the limit is reached | the card is full |
| the word ends a sentence or clause | a card spanning a full stop reads as one garbled thought |
| the gap to the next word ≥ 0.6s | a card spanning a pause freezes on screen with its last word already spoken |
| **never** between a hyphen pair | `well-` alone on screen is a broken card, not a cosmetic one |

A trailing **single word** is pulled back into company by moving one word from the previous card —
but only when that break was a soft length break. Rebalancing across a full stop would undo the
punctuation rule to fix a cosmetic problem.

The hyphen rule is allowed to **exceed the limit**. A five-word card is cosmetic; a dangling hyphen
is not.

## Rule 8 — overflow is a bug, not a cosmetic issue

A long compound word, fast speech and a large style each fit on their own; together they run off
the frame, or under TikTok's button rail.

The defence is not a careful style — it is a **box**. `captionBox()` returns the safe rectangle in
canvas pixels for one platform, the text lays out inside it with wrapping on and a hard width, and
overflow becomes impossible by construction rather than unlikely by inspection.

Safe zones are **per platform**, because one bottom margin is wrong on two platforms out of three:

| Zone | top | bottom | sides |
| --- | --- | --- | --- |
| `tiktok` | 8% | 22% | 8% |
| `reels` | 8% | 20% | 7% |
| `shorts` | 12% | 16% | 6% |
| `none` | 5% | 5% | 5% |

Fractions, not pixels, for the same reason `sizeVh` is a fraction: the same document renders at
720p, 1080p and 4K.

**The band is a wish; the safe zone is a constraint.** A style asking to sit at 0.9 on TikTok gets
the lowest position that is still safe — clamped, not refused and not silently centred, because
clamping keeps the customer's intent as far as the platform allows. The clamp reserves the whole
text block, not just its centre: reserving the centre is the off-by-one that puts the *first* line
of a wrapped caption over the platform's UI, and it only shows on long lines.

The hostile-line test drives four of the longest words in English at 0.12s each through **every
style and every platform**, asserting the box stays inside the frame and the block stays inside the
zone.

## The money

| | |
| --- | --- |
| Rate | `alignment` base 1 credit + 0.01/second (Phase 05 — still placeholders) |
| Hold | inside the run, after everything that could still refuse for free |
| Settle | committed against the narration's measured length |
| **Fully degraded** | **released, not committed** |

Nothing was timed — the words are a weighted guess — and billing for that is how a provider outage
becomes a refund request. A *partial* degrade is still charged: most of the narration really was
aligned.

`captions.applyStyle` costs nothing: no credits, no provider call, no confirmation. Only
re-aligning spends money, which is why the two are rate limited an order of magnitude apart.

## Two places a caption choice lives

The timeline document is the render's input, and **it does not exist until Phase 09 builds one**.
A gallery that could only write into a document would be unusable on every project until then, and
would lose the choice every time a document was rebuilt from the script.

So:

| Where | Holds | Written by |
| --- | --- | --- |
| `Project.settings.captions` | the **intent** — style, band, words per card, on/off | `captions.applyStyle` |
| `Timeline.doc` | the **realisation** — `words`, `style.captionStyleId`, the caption track | `applyCaptionsToTimeline`, when a document exists |

The document write is a **no-op that reports itself** when there is no timeline, rather than a
throw. Grep `CAPTION_SETTINGS_LIVE_ON_THE_PROJECT` and `TIMELINE_IS_OPTIONAL_UNTIL_PHASE_09`.

When it *does* write, it writes three things together — the words, the style id and the track —
because splitting them is how a document ends up with a caption track pointing at word indexes that
no longer exist. It also resets `timing` to `anchored` **whenever the words changed**, since a
resolved document's cached times were computed from the old ones and `validate()` would refuse the
result.

## Captions are a layer, not a render kind

A caption item carries a **word range and no `render` field** (`WORD_RANGE_NOT_TEXT`, Phase 01), so
there is nothing for `RENDER_COMPONENTS` to choose between. `TimelineRenderer` branches on the
**track type** for captions, exactly as it already does for audio.

That is not a `WALK_DONT_BRANCH` violation: the rule forbids branching on **format**, which grows
with every phase. Track types have been fixed at five since Phase 01. This was the one sanctioned
reason to edit that file again, and Phase 08 was the phase that got to. Grep `CAPTIONS_ARE_A_LAYER`.

Per-track style overrides (`track.styleId`, for a translation lane later) are resolved into an
item-id map before the walk, because the frame plan flattens tracks away.

## Gating: two mechanisms, both needed

| | Answers | Shape |
| --- | --- | --- |
| `premiumCaptionStyles` flag | may this workspace use gated styles **at all** | one boolean |
| `CaptionStyle.minPlan` | **which ones** | a per-row plan threshold |

Identical to the voice catalogue's split, with one deliberate difference: `availableOnFreeTrial` is
**true** here and false for voices. A premium voice costs provider characters every time it is
used; a premium caption style costs nothing to render, so letting a trial see its own video in the
good styles is free upsell.

`captions.styles` returns **every** style with a `locked` flag — never a filtered subset. A style a
customer never sees is one they have no reason to pay for. The lock badge is an affordance; the
server re-checks both gates on `applyStyle`.

> **The registry block in the phase file declares only `read`.** It also asks for a style to be
> applied and an alignment to be started — two writes, one of which spends credits. An action with
> no permission to gate it is an action every member can take whatever their role, so the resource
> ships `["read", "apply", "align"]`. This is the same gap Phase 02 found on `assets`.

> **The procedure is `captions.applyStyle`, not `captions.apply`.** tRPC refuses `apply` as a router
> key — it collides with `Function.prototype.apply` — and the failure is a build-time error in the
> serve route, a long way from the router. The audit and rate-limit keys follow the **path verb**,
> so they say `applyStyle` too.

## The screen

`/dashboard/projects/[id]/captions`:

- **Word timing** — how many lines are recorded, what timed them, and the Align / Re-align button.
  A degraded alignment shows a warning that says the captions are estimated and offers the fix. An
  unfinished narration is named, not silently skipped: lines with no audio cannot be timed, and
  captioning around them leaves a hole.
- **Preview** — the real renderer over a light or dark background, with the safe zone drawn, plus
  the three controls: position band, words per card, captions on/off.
- **Style gallery** — every style as a live card, searchable and filterable by family, each a real
  `<button>` with `aria-pressed` and a name a screen reader can use. Locked cards open the upgrade
  modal with the registry's own copy.

One departure from the phase's wording: **position is three bands, not a pixel slider.** The band is
clamped into the safe zone at render time, so two nearby slider positions would often produce the
identical frame and the control would feel broken. Phase 15's editor is where a caption gets nudged
by hand against a real frame. Grep `POSITION_IS_A_BAND`.

## Status

Phase 08's box in `docs/phases/PROGRESS.md` is **unticked** for the same reason as Phase 07: no
`ELEVENLABS_API_KEY` is set, so **no audio has ever been aligned**.

**Verified:**

- **91 tests** over the four decisions that can be wrong without anything erroring — the back-match
  (the `AITA` expansion, a misheard word keeping the customer's spelling, a length-weighted
  interpolation, a hallucinated run of filler not causing drift), the degrade distribution, the
  cache key (one line re-recorded, the same lines re-ordered, the concatenation trap), and the
  grouping (punctuation, hyphens, pauses, no orphan card).
- **The contrast rule over all 38 styles**, and the checker proved to refuse a pale style and a
  hairline stroke by name.
- **The hostile line** through every style and every platform's safe zone.
- **Document-level tests**: a built caption track `validate()`s in every style, resolves its
  anchors, and a **degraded** alignment still produces a valid, resolvable document. Two styles with
  the same `maxWords` produce byte-identical ranges.
- **The credential fence, probed.** `ELEVENLABS_API_KEY` is rejected outside the two adapter
  folders and silent inside `src/lib/adapters/stt/elevenlabs/`.
- The migration is applied; `migrate diff` reports no drift. `/api/inngest` reports **15** functions,
  up from 13. `next build` succeeds with the captions route present.

**Not verified** — four of the phase's seven "done when" checks: captions landing within ~50ms on a
real 60-second sample; a *real* forced STT failure producing a flagged video; a provider call
actually being skipped by the cache; and Player-versus-Lambda parity, which is additionally blocked
by Phase 04's AWS gap. There is now one renderer rather than three, which is the only structural
guarantee available without a cloud render.

## What Phase 08 did not finish

- **The captions screen has not been driven in a browser.** It builds and type-checks; there is no
  aligned project to click through.
- **Phase 09 owns the chain.** `project.tts` deliberately does **not** enqueue `align/requested`
  when a narration finishes — the generate pipeline composes the steps, and auto-triggering here
  would race its orchestration. `line.resynth` *does* enqueue it, because that edit has no pipeline
  behind it; that is Phase 07's `ALIGNMENT_IS_PHASE_08` hook, now closed.
- **Translation, manual timing edits and per-speaker caption colouring** are Phases 15, 15 and 12.
  The schema already allows a second caption track with its own style, which is where a translation
  lane will go.
- **R2 is still unconfigured**, so there is no narration audio to align even with a key, and the
  credit rates are still Phase 05's placeholders.

## Where to go next

`docs/phases/09-generate-pipeline.md`. What it inherits:

- **`doc.words` is now real**, so every `{ wordIndex }` anchor a generator writes can be resolved.
- **`buildCaptionTrack` and `Project.settings.captions`** are what the pipeline calls to put
  captions into the document it builds — it does not need to know what a style is.
- **`alignmentPlan()` is the one cache check**, so composing the align step costs nothing when the
  audio has not changed.
- **The degrade path means the pipeline has no alignment failure case** to handle: it either gets
  timings or gets estimates, and both render.
