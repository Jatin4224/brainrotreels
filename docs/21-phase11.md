<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 11 — the backgrounds library

Phase 09 gave a voiceover video a gradient behind the words. This page describes the thing that puts
**real footage** there: a shared catalogue every workspace can browse, the workspace's own uploads
beside it, a plan gate on the catalogue, and the looping that makes a four-second clip cover a
ninety-second script.

Read this before Phases 12–14. Every format they add needs something behind the captions, and the
resolver and the picker described here are what they reuse rather than re-derive.

## The one-sentence version

A **library asset is an ordinary `Asset` row with no `organizationId`**, which the existing ingest
transcodes into the same variants an upload gets and the existing signing path serves from the CDN
instead of signing — so the only genuinely new machinery in this phase is a manifest, a fetch, a
plan gate and a picker.

## Read this first: the catalogue is EMPTY and that is the deliverable

`src/lib/library/backgrounds.manifest.ts` ships with no rows in it. That is a decision, recorded in
full in that file's header, and it is the phase's own instruction taken literally.

The phase opens by requiring the **gameplay-footage licensing position to be settled by the owner
before anything is seeded**; `architecture.md` names it the largest non-technical risk in the
product. Footage from commercial games is copyrighted, and redistributing it inside videos customers
then monetise is not covered by the fact that everyone on TikTok does it. The defensible positions
are footage the operator recorded under a specific game's content policy, commissioned original
loops, or licensed abstract loops whose terms **explicitly permit end-user publication and
monetisation** — which most stock music licences do not, so the audio kinds are held to the same bar.

So the **mechanism is complete and the catalogue is thin**, which is what the phase asks for. A
hand-written list of URLs and licence sentences nobody has verified would be a fiction, and a
fiction in a licence column is the one kind this product cannot afford — the same reasoning
`voices.sync` recorded when it refused to ship a seed file.

An empty catalogue is a **working product**: the picker shows the styled backdrop and the workspace's
own uploads, and a generated video is complete without footage.

## Where the code lives

| Path | Contains | Reaches a provider? |
| --- | --- | --- |
| `src/lib/types/background.ts` | the kinds, the plan ladder, the manifest schema | **no** — pure |
| `src/lib/library/backgrounds.manifest.ts` | the catalogue, as data | **no** — pure |
| `src/lib/adapters/storage/keys.ts` | `assetObjectKey` — which prefix an asset gets | **no** — pure |
| `src/lib/adapters/storage/types.ts` | `publicUrl` on the contract | no |
| `src/lib/adapters/storage/r2/index.ts` | the CDN origin | no |
| `src/services/backgrounds.service.ts` | the catalogue queries and the resolver | no |
| `src/trpc/routers/backgrounds.ts` | `list` / `applyBackground` / `sync` | no |
| `src/inngest/functions/library-ingest.ts` | **the one new workflow** — fetch, then hand over | the source URL |
| `src/inngest/functions/asset-ingest.ts` | now library-aware (keys, moderation) | ffmpeg |
| `src/lib/generators/voiceover.ts` | emits footage instead of a backdrop | **no** — pure |
| `src/components/global/background-picker/` | the picker | no |

## The five decisions worth knowing

### 1. A library asset is not a new model — it is a null `organizationId`

`Asset.organizationId` has been nullable since Phase 02 precisely for this, and
`assetScopeWhere` has read "mine **or** library" ever since. Nothing in this phase adds a table or a
column. The manifest key becomes the row's **primary key** (`lib-<key>`), so a re-sync updates the
catalogue row rather than minting a second one and stranding every project that pointed at the
first. Grep `MANIFEST_KEY_IS_THE_IDENTITY`.

### 2. Two prefixes, chosen once, from the row

The bug this phase had to avoid: a library asset's variants written under
`orgs/<whoever-synced-it>/uploads/…`. That key fails `isLibraryKey`, so `signScopedKey` refuses it
for every **other** workspace — the catalogue would be invisible to the tenants it exists for, and
the failure would read as a signing bug rather than a key bug.

`assetObjectKey(owner, …)` is a discriminated union with no default, so the ingest cannot forget the
library case and cannot pass an organization id for a shared row. Grep `ONE_OWNER_ONE_PREFIX`.

### 3. The CDN decision lives in `signScopedKey`, not in this phase's code

Every path that turns an asset into a URL already goes through one function: the picker's
thumbnails, a voice preview, and `signDocumentAssets` on the way to a render. So "serve library
assets from the CDN" is **four lines in that function** rather than a branch in three callers, two
of which would have been forgotten.

Signing a shared object buys nothing — every workspace gets identical bytes — and costs the whole
edge cache, because a signed URL carries a unique query string and is a miss per tenant and per page
load. With no `R2_PUBLIC_URL` configured, `publicUrl` returns null and the key falls through to
signing, so a bucket with no CDN still works and is merely slower. Grep
`LIBRARY_IS_SERVED_FROM_THE_CDN` and `CDN_IS_OPTIONAL`.

### 4. The plan gate is TWO gates, and only one of them is the registry's

| Gate | Question | Mechanism |
| --- | --- | --- |
| `Asset.minPlan` | *which* rows | `backgroundAvailableOnPlan` — a ladder comparison |
| `RESOURCES.backgroundLibrary.limit` | *how many* rows | a **cursor** at the last row the plan includes |

The second is the unusual one. It is a `limit` on the registry — so it appears on the pricing page
and in the upgrade modal's comparison table for free — but it counts nothing: the resource declares
no `create` verb, so the procedure builder's plan gate and counter bump never fire and `UsageMetrics`
stays empty for it. The cap is applied at **read time**.

And it is applied as a **cursor**, not a row index, which is worth knowing because the obvious
version is wrong. "The first N of the catalogue" looks like `skip + index` on the page being
rendered — correct only while the page IS the catalogue in order. Under a search it is the rank among
the MATCHES, so a free workspace searching "rain" would see the first ten hits unlocked even if they
are rows thirty to forty, click one, and be refused by a server that re-checks properly. So the cap
is resolved once into the `(createdAt, id)` of the last row the plan includes, and one **pure**
function compares every row against it — on the read and on the write. Grep `BREADTH_NOT_A_COUNTER`,
`BREADTH_IS_APPLIED_AT_READ_TIME` and `A_CURSOR_NOT_A_ROW_INDEX`.

Which makes the ordering load-bearing: the catalogue is sorted **oldest first**, the only ordering in
this codebase that is not newest first. A plan's breadth is "the first N of the catalogue", so on a
newest-first list every background the operator added would push a different one out of reach and a
customer would find the loop they used last week locked. Grep `CATALOGUE_ORDER_IS_STABLE`.

Both gates are re-checked on the write, and the write recomputes the cursor rather than trusting a
boundary the client sent. Grep `APPLY_IS_THE_BOUNDARY`.

### 5. One resolver, two callers

A background is resolved **before** the generator runs, in `resolveProjectBackground`, from three
places in order: the project's stored choice, the workspace's last pick on any recent project, then
the catalogue's first row the plan can reach. Then null, which means the styled backdrop.

The same function feeds **the picker** and **the pipeline**. If they had each resolved their own, the
picker could pre-select one row while the generator used another, and the customer would get a video
with a background they can see they did not choose — with nothing on either side looking wrong in
isolation. Grep `ONE_RESOLVER_TWO_CALLERS` and `THREE_PLACES_TO_LOOK`.

Every candidate is re-checked, **including** the project's own stored choice, because a background
can be deleted, rejected by a later review, or fall out of reach when a workspace downgrades. The
honest behaviour then is the next default, not a hole in the video.

It is resolved in a service and handed to the generator as a **fact**, because generators stay pure
(`GENERATORS_STAY_PURE`) and must not be able to read a plan (`GENERATOR_CONTEXT_IS_FACTS`). The
`db` on `GeneratorContext` remains unused. Grep `RESOLVED_BEFORE_THE_GENERATOR`.

## Why a library row is `approved` and an upload is not

This is the only exception to Phase 10's fail-closed moderation, so it is worth being exact.

An upload is held `pending` because nothing has looked at its pixels and this product has no vision
classifier — the check that matters did not happen (`MODERATION_IS_PARTIAL`). That reasoning does not
transfer. A library row exists **only** because somebody added it to the manifest, which is a code
change a person reads and which carries the licence they established. The human review already
happened, in the diff. Holding it `pending` afterwards would mean asking an operator to clear, in a
queue, the thing they just committed — and until they did, every picker would be empty.

It is `approved` rather than `skipped` deliberately: `skipped` means "moderation does not apply",
which is for our **own** output (a render's file, narration we synthesised from already-classified
text). A curated loop is somebody else's footage that a person vouched for. The record names
`library-manifest` as the engine, so the queue can tell a model's verdict from a human's. Grep
`LIBRARY_IS_APPROVED_BY_REVIEW` and `MANIFEST_IS_THE_REVIEW`.

## Footage or backdrop, never both

A backdrop sits on the **scene** track and composites **above** a video item (`LAYER_ORDER`), so a
document carrying both would draw a gradient over the footage the customer chose — and the bug would
read as "my background did not apply". The generator emits one or the other. Grep
`FOOTAGE_OR_BACKDROP_NEVER_BOTH`.

The clip spans the whole narration and asks to be looped; the repetition is **Remotion's `<Loop>`**,
which Phase 03 already built, not the element's own playhead — that is what keeps a frame a pure
function of its number and therefore keeps Phase 04's render reuse correct. A clip with no measured
duration is emitted with `loop: false`, because the loop divides by the source length and a loop
with no modulus is a division by zero; the tile says so on screen. Grep `LOOP_TO_THE_NARRATION` and
`LOOP_IS_A_MODULO`.

Nothing in this phase does geometry. Phase 02's ingest already crops a 16:9 source to a 9:16 master
at transcode time (`fitForKind` → `crop` for `background`), so `fit: "cover"` at render time is a
no-op. Grep `CROP_OR_PAD`.

## The picker is a radiogroup, not a grid of buttons

The tiles are a single-select, so they are one `radiogroup` of `radio`s with a roving tabindex and
arrow-key navigation — which is what "fully keyboard navigable" actually requires. A grid of buttons
is reachable with Tab, but it makes a screen-reader user hear twenty unrelated controls instead of
one choice with twenty options, and it puts twenty stops between the grid and whatever follows.

The **column count is measured** from the laid-out tiles rather than hard-coded, because the grid is
responsive and Up/Down have to move exactly one row. Grep `RADIOGROUP_NOT_A_LIST_OF_BUTTONS` and
`ROVING_TABINDEX`.

A locked tile is rendered, focusable and selectable, and choosing it opens the upgrade modal:
hiding it removes the upsell, and `disabled` would take it out of the keyboard order so a keyboard
user could not discover that the thing exists. "No footage" is a **tile in the group**, not a Clear
button beside it — the styled backdrop is one of the options, not an undo. Grep `LOCKED_NOT_HIDDEN`
and `BACKDROP_IS_A_CHOICE`.

The upload tile is `<MediaUpload variant="compact">` — the component Phase 02 built, which already
carries the storage gate, the accept list and the refusal copy — and it sits **outside** the
radiogroup, because it is an action rather than an option.

## Two producers, one ingest

`backgroundLibrary.sync` writes the catalogue rows and enqueues one `library/requested` per entry. It
does **not** fetch anything: a manifest row is a multi-megabyte download followed by four
transcodes, and the handler runs inside a 10-second Prisma transaction.

`library-ingest` does the one thing the upload path does not — pull a third party's URL into
`library/…` — and then sends `asset/uploaded`, so the probe, the variants, the moderation and the
readiness transition all happen in the ingest that owns them. A second pipeline for library rows is
how "library rows get the same variants as uploads" stops being true six months later. Grep
`FETCH_ONCE_THEN_HAND_OVER`.

The event carries the manifest **key**, never the entry: the manifest is code, so a run that resumes
after a licence correction must re-read it rather than replay the string the operator just fixed.
And because the object key is derived from the id, a re-sync lands on the same key — so a `head` that
finds the object there skips the download, which makes correcting a licence free. Grep
`MANIFEST_IS_RE_READ_NOT_REPLAYED` and `OBJECT_EXISTS_IS_A_SKIP`.

`sync` is **portal-only** on top of its permission, exactly as `voices.sync` is: library rows are
read by every tenant, so a custom role in one workspace must not be able to replace a background for
everybody. Rows are never deleted by a sync — projects point at them, and withdrawing a background
is raising its `minPlan` or deleting it deliberately, not a side effect of editing a file.

## Two things that look like inconsistencies and are not

**`backgroundLibrary.applyBackground`, not `.apply`.** tRPC reserves `apply` — it collides with
`Function.prototype.apply` and the router throws at build time. This is also why `captionStyles` is
reached at `applyStyle`. The *permission* is still `backgroundLibrary:apply`.

**Changing the background rewrites no document.** `captions.applyStyle` can restyle an existing
timeline because a restyle provably cannot change the timing (`RESTYLING_IS_FREE`). Swapping the
footage changes what every frame looks like, and half-rewriting a document from a router would
produce a preview the pipeline never built — so the choice applies to the **next generation**, and
the handler returns `appliesToNextGeneration` so the UI says so rather than leaving the customer to
notice.

## What is NOT in this phase

- **AI-generated footage** — Phase 17.
- **Stock clip search per script block** — Phase 14.
- **A music or SFX picker.** The manifest, the ingest, the licence discipline, the key convention and
  the plan gate all cover the audio kinds already (`kind: 'audio_music' | 'sfx'`), and
  `settings.generate.musicAssetId` has existed since Phase 09 — but no picker is wired to it, so a
  bed can only be chosen by writing the setting. Deliberately deferred: there is nothing to choose
  from until the music licences are settled, and that is the same owner decision as the footage.
- **An operator console for `sync`.** The mutation has no screen, the same state `voices.sync` is in.
  An import against an empty manifest is a button with nothing to do.
