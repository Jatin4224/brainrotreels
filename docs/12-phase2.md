<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 02 — media assets and storage

`docs/11-phase1.md` describes the timeline document, in which every piece of media is an asset
*handle*. This page describes what turns those handles into real files: one asset system covering
uploads, the curated library, generated audio, generated footage and render outputs.

Read this before Phase 03 (the renderer reads variants), Phase 04 (renders become assets),
Phase 11 (the background library) and Phase 14 (voiceover visuals) — all four either consume or
extend what is here. Read the **signing** and **mine-or-library** sections before you write any
query against `asset`, because both are security boundaries and both are easy to get subtly wrong.

If you want the data shape rather than the reasoning, read the `Asset` and `AssetVariant` models in
`prisma/schema.prisma`. They are commented.

## The one-sentence version

One `asset` table holds every piece of media whatever produced it; bytes are metered on the
`storage` registry limit and nowhere else; a signed PUT takes the upload straight from the browser
to the bucket; and a durable workflow — **running ffmpeg in a container, never in a serverless
function** — turns each upload into the fixed set of variants the renderer and the editor expect.

## One table, not one per source

A `background`, a customer `upload`, generated narration and a finished render are stored in the
same table with the same columns. That looks like under-modelling and is not: every consumer
downstream — the timeline document, the renderer, the media picker, the quota — asks the same five
questions. Where are the bytes, how long is it, what shape is it, is it ready, may this workspace
use it.

What *does* differ is `kind` and `source`, and they are two axes rather than one on purpose:

- **`kind`** is what the media *is to the product* — it drives which variants are worth building,
  which picker the file appears in, and which timeline lane it may be dropped on. An MP4 can be a
  `background`, an `upload` or a `render_output`, and those three are treated completely
  differently.
- **`source`** is *provenance*, and the licensing answer hangs off it: a `library` row is covered
  by the operator's licence, an `upload` by the customer's own rights, a `generated` clip by the
  model's commercial-use terms — which is still an open owner decision for Phase 17.

Both are Prisma `String` columns, because this schema has zero enum blocks. The validated unions
live in `src/lib/types/asset.ts`, exactly as `ProjectKind` does for projects.

## Rule 1 — `organizationId` is nullable, and that changes every query

**Library rows have a null `organizationId`.** That is the only reason the column is nullable, and
it has one consequence that matters more than anything else on this page:

> An ownership check is **"mine OR library"**. Never `organizationId: { not: null }`, never
> `organizationId !== null`, and never a plain lookup by id.

Written the obvious way, the check hands every workspace every other workspace's media the first
time somebody passes an id. So it is written **once**, in `assetScopeWhere()` in
`src/services/assets.service.ts`:

```ts
{ OR: [{ organizationId }, { organizationId: null }] }
```

Grep `MINE_OR_LIBRARY` and you have found every query that can read an asset. Every function in
that service takes `organizationId` and puts it in the `WHERE` clause even when it also has a
primary key — `TENANT_SCOPED_QUERY`, the same rule as `projects.service.ts`. The procedure factory
proves the **caller** belongs to the org they named; it says nothing about the row.

### The read/write asymmetry this creates

"Mine or library" is correct for a **read** and wrong for a **write**. A plain scoped lookup
would let one tenant rename or delete a shared library row that every other workspace can see, so
`assets.update` and `assets.delete` both check `organizationId === null` explicitly and refuse —
`LIBRARY_IS_READ_ONLY`. The row menu is not rendered for a library row either, so the UI never
offers an action the server will refuse.

### The workflow needs an unscoped read, and it is a separate function

A job runs outside `protectedProcedure`, triggered by an event the app itself sent carrying an id
it just created. There is no caller to scope to, and asking for an `organizationId` would mean the
workflow passing one it read off the same row — which proves nothing.

So `findAssetById()` exists with no tenancy predicate, as a **separate function** rather than an
optional parameter on the scoped one. That is deliberate: an unscoped read cannot then happen by
passing the wrong argument. A caller has to name `findAssetById`, and naming it in a router is
immediately wrong in review.

## Rule 2 — bytes are metered on `storage`, so the counter is hand-written

Read `docs/05-feature-gates.md` first. Normally a `limit` on a registry entry means
`<resource>.create` is gated and counted with nothing declared in the router.

`assets` **declares no `limit`**, because the thing a plan caps is bytes, and bytes already have a
resource: `storage`. A registry entry declares `limit` or `flag`, never both and never a *second*
resource's quota — so there is no way to express "assets are capped by storage" in the registry at
all.

The consequence is explicit rather than hidden. Because `assets.create` is not a limit path:

| Concern | Who does it |
| --- | --- |
| The gate before an upload | `assets.createUploadUrl`, calling `checkFeatureGate(org, 'storage', bytes)` by hand |
| The counter after an upload | `assets.completeUpload`, calling `incrementUsage(org, 'storage', bytes)` by hand |
| The counter after a delete | `assets.delete`, calling `decrementUsage(org, 'storage', bytes)` by hand |

This is the same documented pattern `invitation.create` uses for seats. Grep
`BYTES_METERED_ON_STORAGE` for all three sites. If you add a path that stores or frees bytes — AI
footage in Phase 17, render outputs in Phase 04 — **it has to do this too**, and nothing will warn
you if it does not. The symptom is a quota that drifts from the bytes actually in the bucket, and
`sumAssetBytes()` exists so a reconciliation cron can find that drift later.

Note that `checkFeatureGate` takes a **quantity**. The gate is checked for *this many bytes*, not
for "one more asset" — that is the whole reason the parameter is there.

### `AssetVariant.bytes` is deliberately not charged

An upload produces three or four derived renditions. Charging a customer for all of them would
mean one 10 MB upload consuming 25 MB of their quota, which makes the number unexplainable.
Variants are treated as a cost of storing the original. They are still deleted with it.

## Rule 3 — the two-phase upload, and the trap inside it

A 200 MB video cannot go through a serverless function: it blows both the request body limit and
the execution budget. So the browser PUTs **straight to the bucket** and the flow is three steps:

```
assets.createUploadUrl   → gate, then a presigned PUT URL
PUT <url>                → the browser, direct to R2, with progress
assets.completeUpload    → the Asset row, the counter, and the `asset/uploaded` event
```

### `GATE_BEFORE_SIGNING` — the ordering is the point

The storage gate is checked in `createUploadUrl`, **before a write URL exists**. Refusing in
`completeUpload` would mean the bytes are already in the bucket and already costing money, and the
only remaining choices would be to charge for them or silently delete a customer's file.

The refusals happen in increasing cost order, and the last one is the one a customer can act on:

1. **The per-file cap for the plan** — a plain `BAD_REQUEST`, because no upgrade makes an
   arbitrarily large file acceptable. The message names both numbers: *"That file is 200 MB. The
   largest single file on your plan is 50 MB."*
2. **The storage quota** — a structured `FORBIDDEN` built to the *same shape* the factory's own
   gate throws, carrying the registry's upgrade copy. The client's upgrade modal therefore opens
   identically whether the refusal came from here or from an auto-gated path.

### `EXACT_CONTENT_LENGTH` — the trap

`signedPutUrl` signs `ContentType` **and `ContentLength`** into the URL (see
`src/lib/adapters/storage/r2/index.ts`), so R2 rejects any PUT whose body length differs from the
number signed. The adapter parameter is called `maxBytes`, which makes the wrong thing look
right:

> Sending the plan cap as `maxBytes` produces a URL that accepts a file of **exactly** that size —
> i.e. one that rejects every real upload.

So the client sends `file.size`, the server validates it against the cap and signs **that**. For
the same reason the client PUTs the `Content-Type` the server **echoed back**, not `file.type` read
a second time: a header differing by one character gets a `SignatureDoesNotMatch` that looks
nothing like its cause.

### `TRUST_THE_BUCKET_NOT_THE_CLIENT`

`completeUpload` does not take a byte count. It **HEADs the object** and charges the quota what R2
reports. A client-supplied number is the number the quota is billed on, so it is precisely the one
not to trust — and the HEAD doubles as proof the upload happened, so a client calling
`completeUpload` without uploading gets `NOT_FOUND` rather than a phantom row.

It also re-checks that the `storageKey` sits under the caller's own prefix
(`isOwnedByOrganization`) **before** anything else. A client that could name an arbitrary key could
attach another workspace's object to its own row and then read it through a signed URL
legitimately issued for that row.

### The per-file cap is not the quota, and could not live in the registry

`UPLOAD_BYTES_PER_PLAN` in `src/lib/types/asset.ts` caps **one file**. `RESOURCES.storage.limit`
caps the **total**. They answer different questions, and a free workspace with 100 MB of room must
still be stopped from pushing a 4 GB file through a presign.

It is not in the registry because the registry's `limit` shape is a counter with a usage row behind
it, and nothing accumulates for a per-file cap — declaring it there would create a second
`storage`-shaped quota the factory would try to gate and bump.

A test asserts each plan's per-file cap stays **below** that plan's total storage, so one file can
never fill a workspace that then cannot be extended.

## Rule 4 — where ffmpeg runs

This was the open decision in the phase brief. The answer, recorded in
`src/lib/adapters/media/types.ts` under `FFMPEG_RUNS_IN_A_CONTAINER`:

> **ffmpeg runs in the process that runs the workflow, which must therefore be a long-lived
> container** — a Node worker serving `/api/inngest`, or a dedicated worker image. **Not** a
> serverless function.

Three things force it:

- **Size.** A serverless bundle caps at a few hundred MB; an ffmpeg build is most of that before
  any application code.
- **Time.** Transcoding a two-minute 4K upload outlasts a serverless execution budget — and a step
  that times out retries from the top and times out again, forever.
- **Disk.** ffmpeg wants real files it can **seek** in. A function's writable `/tmp` is small and,
  worse, is not shared between the retries of one step.

Lambda is the right answer for **rendering** in Phase 04 and the wrong one here: a render is one
long job per project that parallelises across frames, whereas ingest is many short jobs that want a
warm process and a local disk. The seam is what keeps that revisable.

### The seam, and the fence around it

`src/lib/adapters/media/` is shaped exactly like the jobs and storage seams — a contract, a
provider selector, and an implementation folder loaded through a dynamic `import()` so the
implementation is never evaluated in a process that does not process media. `MEDIA_PROVIDER` is
server-only; a browser never transcodes anything.

The contract is in terms of **local file paths**, not storage keys or streams. Not an oversight:
the adapter must not know what R2 is, and a stream is exactly what ffmpeg cannot use, because it
needs to seek. Each method is one process invocation, so each one can be its own resumable step.

eslint now confines `node:child_process` to `src/lib/adapters/media/ffmpeg/**`. Spawning a process
is the most dangerous thing this codebase does — every argument is a potential injection and every
invocation is unbounded CPU — so `ARGV_NEVER_A_SHELL` holds there unconditionally: everything goes
through `execFile` as an **array** with no shell, so there is nothing to quote and nothing to
escape. `runTool()` is the only function that spawns anything, which is also where the timeout
lives (ffmpeg can hang indefinitely on a malformed file rather than exiting).

## The ingest workflow

`asset.ingest` in `src/inngest/functions/asset-ingest.ts`, triggered by `asset/uploaded`:

```
probe → refuse what we cannot process → variants (one step each) → moderate → ready
```

### `STEP_PER_VARIANT` and what "a retry resumes" actually means

Every variant is its own `step.run`, and each step **stages its own input**, writes its own object,
and upserts its own `AssetVariant` row before returning. So a run that produced the master and then
died on the poster re-enters with the master recorded in both the database and the bucket, and
Inngest replays the completed steps from memory rather than re-running them.

Steps share **nothing on disk**. That looks wasteful — the proxy step re-downloads the master the
previous step just uploaded — and it is the only correct design: steps are independently retried
and may run on different machines, so a file left on disk by step two may simply not exist when
step three runs. A pipeline assuming otherwise works in development, where everything is one
process, and fails in production on exactly the retries it exists to survive. Grep
`STAGE_PER_STEP`.

`withStagingDir()` takes a callback rather than exposing create/destroy, because the cleanup has to
be unskippable. A worker's disk is small and long-lived, and a few hundred leaked half-gigabyte
transcodes fills it — at which point every ingest fails at once, for a reason that looks nothing
like the cause.

The variant rows are **upserted**, not created, on `(assetId, variant)`. A retried step may produce
the same variant twice, and the second attempt's object is the one in the bucket, so its key and
size are the ones that must be on the row. A create would throw on the unique constraint and turn a
successful retry into a failed ingest.

### `PERMANENT_VS_TRANSIENT_FAILURE` — the distinction that decides whether a customer waits

| Failure | Treatment |
| --- | --- |
| Unsupported codec, corrupt file, deleted row | Mark the asset `failed` with a readable reason, then throw `NonRetriableError` |
| Download blip, full disk, anything else | Throw normally; Inngest retries with backoff |

Getting this backwards means either four pointless transcodes of a file that will never improve, or
a permanent failure on a network blip. `retries` is 2 rather than the default, because each attempt
may be minutes of CPU and the failures worth retrying here clear fast or not at all.

Concurrency is **1 per workspace** (`key: 'event.data.organizationId'`), so a customer dropping
thirty files cannot saturate the worker pool and stall every other tenant behind their own.

`onFailure` is the net under every transient failure: a run that exhausts its retries still has to
leave the row honest, or the asset sits on `processing` forever and the customer has a spinner and
no explanation. Note the failure event **wraps** the original one — the payload is at
`data.event.data`, which is easy to get wrong by one level, so it is parsed with a schema rather
than indexed.

### Event payloads and step results are both JSON, so both are parsed

`JobEvent.data` is `Record<string, unknown>` by contract: it crosses a queue, arrives as JSON with
no types attached, and may have been enqueued by an older deploy. Reading
`event.data.assetId as string` would turn a renamed field into a Prisma query for `undefined`.

The same applies to a step's **return value** — it is serialised, stored and replayed on retry, so
what a resumed run receives is JSON and not the object the step returned (a `Date` arrives as a
string). Both boundaries re-parse. Grep `EVENT_PAYLOAD_PARSED` and `STEP_RESULTS_ARE_JSON`.

## The variant plan

`src/lib/media/ingest-plan.ts` is **pure** — it takes probe facts and returns a plan — for the same
reason `src/lib/timeline` is pure: these are the decisions worth testing, and they are untestable
while tangled with a process spawn and an S3 round-trip. Every number in it is a product choice,
and it is the one file to argue with about them.

```
video → vertical_1080 (master) → proxy_480 (from the master) → thumb (from the master)
image → vertical_1080 as a STILL → thumb
audio → waveform only
```

### Four decisions in it worth knowing

**The proxy is derived from the master, not from the original.** That pairing is what makes the
editor preview and the final render the *same framing*, which `architecture.md` names as the reason
they match at all. Deriving it from the original reintroduces exactly the drift the design avoids.

**Crop vs pad is a property of the material, not of the file.** Cropping fills the frame and loses
the edges; padding keeps everything and adds bars.

- `background`, `ai_footage`, `render_output` → **crop.** Texture under narration; nobody reads its
  edges, and black bars behind a narration video look broken. This is the setting Phase 11's
  gameplay footage depends on.
- `upload`, `image`, `avatar` → **pad.** The customer's own content, which may have a subject or
  text near an edge. Silently cutting a third off it is the worse failure; Phase 15's editor is
  where someone reframes it deliberately.

It is a full `Record` over `AssetKind`, so a new kind cannot ship without the decision being made
for it.

**Backgrounds are muted at ingest; uploads are not.** The renderer composites narration itself, so a
background's own audio means every render using it carries a second soundtrack nobody asked for.
A customer's upload may *be* the audio they want. Doing it at ingest rather than at render time
means it is not a flag to remember on every render path. Grep `MUTE_BACKGROUNDS_NOT_UPLOADS`.

**The poster is taken one second in, not at zero.** The first frame of a huge share of real video is
black, a fade-in or a slate, and a media library of black rectangles is indistinguishable from a
broken one. A clip shorter than a second uses its midpoint; an unknown length does not seek at all,
because seeking past the end produces no frame and a missing thumbnail is worse than a dark one.

### Two allowlists, and only one of them is a real check

| Where | What it decides | Based on |
| --- | --- | --- |
| `CONTENT_TYPE_ALLOWLIST` (`lib/types/asset.ts`) | what we will **sign an upload for** | the string the *browser* supplied |
| `SUPPORTED_*_CODECS` (`lib/media/ingest-plan.ts`) | what we can **actually process** | what ffprobe found *inside* the file |

The second is the one that matters — `CODEC_ALLOWLIST_IS_THE_REAL_CHECK`. A ProRes or HEVC MOV is a
perfectly legitimate `video/quicktime` upload that the renderer cannot read, and an `.mp4`
containing nothing at all is a legitimate `video/mp4`. HEVC is a deliberate omission: modern
iPhones record it by default, so it *will* be hit, and the honest behaviour is a clear refusal
telling the customer to export as H.264 rather than a transcode that dies halfway through.

Refusal messages name the codec and the fix. *"This video uses the HEVC codec… export it as H.264
(MP4)"* is actionable; "unsupported format" is a support ticket.

### ffprobe output is parsed, never cast

`PARSED_NOT_CAST`. ffprobe's JSON is loosely typed by convention, not by contract: `duration`
arrives as a **string**, `r_frame_rate` as the fraction `"30000/1001"` or the meaningless `"0/0"`,
and whole sections are absent depending on the container. Every awkward case has a wrong answer
that looks plausible — `Number("30000/1001")` is `NaN`, and `NaN` survives every comparison the
pipeline makes about duration before reaching a render.

`parseProbeOutput()` is exported separately from `probe()` precisely so this can be tested against
real ffprobe output without an ffprobe install. Nine cases in
`src/lib/adapters/media/ffmpeg/index.test.ts`.

One zod detail, since it is the kind of thing you will re-derive: the numeric coercion is
`.optional().catch(undefined)` **in that order**. `.catch()` must return the schema's own output
type, so the optional has to come first for `undefined` to be a legal fallback.

## Signing — the security boundary of this phase

`signAssetUrl(assetId, organizationId, ttl?)` is the published contract, and it checks **twice**,
because the two checks fail independently:

1. **The row** must be readable by this workspace (mine or library). That is authorization.
2. **The key** must agree — it must sit under this workspace's prefix, or under `library/`. That is
   `DOUBLE_CHECKED_KEY`, and it catches a row whose `storageKey` was written wrong by a bug or a
   bad import, which authorization alone cannot see.

Grep `SIGNING_BOUNDARY`. Two behaviours follow from it:

**It returns `null`, it does not throw.** The caller answers `NOT_FOUND`. Distinguishing "no such
asset" from "not yours" with different status codes tells an attacker which ids are real — so
`assets.get` on an unknown id returns **404**, never 403.

**A mismatched key logs and returns null rather than raising.** A media list must still render with
one broken tile rather than erroring entirely.

`signVariantUrl` exists because the grid needs thumbnails and the editor needs proxies, and neither
is the asset's own object: signing `storageKey` for a page of twenty-four tiles would hand the
browser hundreds of megabytes of masters.

The list endpoint signs thumbnails **with the rows**, which is safe for a specific reason — the rows
came out of the scoped query, presigning is local HMAC with no network call per row, and
`signScopedKey` still re-checks each key's prefix. Fetching them per tile would be a request per
asset on every page change.

**One thing to know before you rely on these.** `signAssetUrl`, `signVariantUrl`,
`getAssetVariants` and `sumAssetBytes` are the phase's *published contracts* and currently have
**no callers in app code** — the two endpoints that sign today already hold their rows, so they go
through `signScopedKey` directly rather than re-reading by id. The functions are the API Phase 04's
render pre-flight and Phase 15's editor are meant to use, and they apply the full two-step check.
Being uncalled means they are also unexercised, so the first phase to adopt one should verify it
rather than assume it: start from `signAssetUrl` and check that a foreign id returns `null`.

## Deletion — the ordering is chosen for the failure direction

```
1. collect every storage key WHILE the rows still exist
2. delete the Asset row (variants cascade)
3. decrement `storage` by the recorded byte total
4. delete the objects — LAST, outside what can roll back
```

Step 1 is first because after the cascade the variant keys are unrecoverable and their objects
would be billed forever. Step 4 is last and deliberately outside the transaction —
`ORPHAN_OBJECTS_OVER_MISSING_OBJECTS`:

> If the transaction failed after the objects were gone, the row would come back pointing at
> nothing — a tile that looks fine and 404s. This way the worst case is objects with no row, which
> cost storage, are swept by the cleanup cron, and break nothing in the product.

## The UI

### `<MediaUpload>` is global, and Phases 11 and 14 are the reason

It lives in `src/components/global/media-upload/` because three phases need it and none should own
it. Everything surface-specific arrives as a prop — the asset `kind`, the copy, `variant`
(`panel` or `compact`) — and nothing about the media page is hardcoded in it.

**`XHR_FOR_PROGRESS`.** The PUT goes through `XMLHttpRequest`, not `fetch`. That is not legacy code:
`fetch` cannot report request-body progress, and without it a video upload is a spinner for four
minutes. It is the one place in this codebase where XHR is the right call.

**It renders its own at-limit state instead of being wrapped in `<FeatureGate>`.** A gate wraps a
single clickable trigger and intercepts its `onClick`, which cannot express "the drop target is
also inert" — a customer at their cap would still be able to drag files onto it and watch every one
fail. At the cap the zone shows the registry's own upgrade sentence and opens the same modal the
gate would have. Note it gates on **`storage`**, not on `assets`; `assets` has no limit to gate.

**Uploads are sequential.** Parallel uploads look faster and are not — they share the customer's
uplink, so six at once is six slow bars instead of one fast one — and ingest is serialised per
workspace anyway.

**A refused file is still shown, with its reason.** Dropping it silently is how someone drags eight
files, sees six, and assumes the page is broken. `validateFileForUpload` is exported and pure, and
it mirrors the server's rules from the same objects (`CLIENT_SERVER_MIRROR`): the point of checking
twice is the *message*, not the security.

The `accept` attribute is generated from `CONTENT_TYPE_ALLOWLIST`, so the picker offers exactly
what the server will sign for. Typing extensions there by hand is how a picker ends up offering a
format the API rejects.

### `<UsageMeter resource="…">` names no resource

`src/components/global/usage-meter/` takes a `LimitResourceKey` and reads everything else from the
gate map — the label, the numbers and the upgrade sentence all come from the registry. Phase 02
needs it for storage; a storage-specific bar would have guaranteed a second, slightly different one
later. An unlimited plan gets the word "Unlimited" and **no bar**, because a bar implies a ceiling.

### Two things about the media table

**It polls while anything is `processing`.** An upload lands as `processing` and becomes `ready`
when a workflow finishes seconds or minutes later, with nothing pushing that to the browser. The
`refetchInterval` predicate is re-evaluated after every fetch, so polling stops by itself the
moment the last row goes ready. Without it a customer uploads a file, sees "Processing", and has to
guess that a reload would help.

**Thumbnails use a plain `<img>`, not `next/image`** — `SIGNED_THUMB_NOT_NEXT_IMAGE`. A signed URL
is unique per request and uncacheable, which is exactly what the optimiser cannot help with, and
routing it through `/_next/image` would make the server re-fetch every tile on every page view.
`images.remotePatterns` *was* added to `next.config.ts`, but for the **public** library objects
Phase 11 will serve unsigned — those are the ones `next/image` is for. It is derived from
`R2_PUBLIC_URL` and omitted entirely when that is unset, because an empty hostname in
`remotePatterns` is a build error and a repo with no bucket must still build.

## Two things that will bite you

### Audit templates are keyed by the path verb, not the CRUD word

`writeAuditRow` looks a template up as `resourceDef.audit.describe[pathAction]` — the **path's own
last segment**, not an overridden action. So on `assets.completeUpload`, a template keyed `create`
resolves to nothing and the audit row ships with **no description at all**.

The keys are therefore `completeUpload`, `update` and `delete`. This compiles either way and reads
correctly either way, which is what makes it worth writing down. If you add a mutation whose verb
is not `create`/`update`/`delete`, key its template by the verb you actually used.

Relatedly: `createUploadUrl` sets `audit: false`. It changes no state — it hands out a URL — and a
row per issued URL would bury the row that matters under noise. The per-resource rate limit on that
path is what makes abuse of it visible instead.

### `assets` carries an `update` permission the brief omitted

The phase brief lists `['create', 'read', 'delete']` and *also* asks for a rename row action. An
action with no permission to gate it is an action every member can take regardless of their role,
so `update` is on the list. It grants rename and nothing else — a filename is a label, and nothing
about the bytes is editable.

## Status

Phase 02 is **built but not fully verified**, and its box in `docs/phases/PROGRESS.md` is
deliberately unticked. The migration is applied. `tsc --noEmit`, `eslint` and `next build` are
clean, and the suite is 339 green (52 new).

What **was** verified in a browser on 2026-10-19: the screen renders with the meter reading
"0 B of 100 MB used" and the drop zone resolving "up to 50 MB each" from the real plan; the sidebar
entry appears from the registry with no nav wiring; the `accept` list is exactly the eight
allowlisted types; and every server-side refusal was probed over tRPC **bypassing the client
gates** — the per-file cap, the content-type allowlist, a 0-byte file, a privileged `kind`, a
foreign storage key (403, before storage is touched) and an unknown id (404, never 403). A
legitimate presign passed both the cap and the storage gate and failed only on missing credentials,
which is the proof `GATE_BEFORE_SIGNING` ran and allowed it.

What was **not** verified, because no `R2_*` variables are set in `.env`: the actual ingest
round-trip. An MP4 becoming its three variants, the storage bar moving on upload and back on
delete, URL expiry, object deletion, and a corrupt file marking `failed` against a real file. The
refusal logic behind that last one is unit-tested but has never run on a real byte. `PROGRESS.md`
lists all of it.

## What Phase 02 did not finish

- **Moderation is a stub that writes `skipped`, not `approved`.** Phase 10 makes it real.
  `approved` would be a claim nothing checked, and every later phase would be entitled to believe
  it.
- **No library rows exist.** The nullable `organizationId`, `minPlan` and the "mine or library"
  predicate are all in place and enforced; the curated backgrounds and their tier gating are
  Phase 11.
- **`sumAssetBytes()` has no caller.** It is the number the `storage` counter *should* equal, ready
  for the reconciliation cron `architecture.md` schedules.
- **The `tmp/` lifecycle rule is still outstanding from Phase 00.** The key convention assumes R2
  deletes that prefix after 24 hours and nothing in code enforces it.

## Where to go next

`docs/phases/03-render-core.md` — Remotion, and the first time a variant is actually consumed. The
pairing to carry over is `vertical_1080` for the render and `proxy_480` for the browser preview;
that is the whole reason the two match.

Two rules to carry forward when you get there:

- **Nothing renders an asset that is not `ready`.** A corrupt file must never reach a paid render.
- If you make renders into assets (Phase 04), **they have to charge the `storage` counter by hand**
  like every other write here does. Nothing will warn you.
