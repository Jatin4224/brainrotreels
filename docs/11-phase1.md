<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 01 — the timeline document

`docs/10-phase0.md` describes the infrastructure the product needed before any video code could
be written. This page describes the first piece of video code: `src/lib/timeline/`, the JSON
document that every generator, the editor, the player and the renderer all speak.

Read this before you touch anything under `src/lib/timeline/`, and before Phase 03 (the
renderer), Phase 06 (the generators) or Phase 15 (the editor) — all three consume this module
and none of them can be written correctly without knowing the six rules below.

If you want the shape of the document itself rather than the reasoning, read
`src/lib/timeline/schema.ts` directly. It is the source of truth and it is commented.

## The one-sentence version

One JSON document describes a whole video; `src/lib/timeline/` is the only code that defines,
validates, migrates or edits it; and that module is **pure** — no Prisma, no `server-only`, no
Node built-ins, no React — so the identical `apply()` runs in the browser editor and on the
server.

Everything else on this page follows from that sentence.

## Why purity is the load-bearing constraint

The editor needs to apply an edit and show the result immediately. The server needs to apply
the same edit to produce the document it renders. If those are two implementations, they drift —
and the symptom is the worst kind this product can have: an editor preview that does not match
the video the customer paid for. `architecture.md` names this as the documented way the design
fails.

So the fence is enforced twice, deliberately:

- **An eslint rule** over `src/lib/timeline/**` in `eslint.config.mjs`, banning Node built-ins,
  `server-only`/`client-only`, Prisma, services, tRPC, adapters, React and Next.
- **`src/lib/timeline/purity.test.ts`**, which reads every file in the folder and fails on a
  forbidden import.

The test exists because a lint rule is skippable — by a disable comment, by a config that stops
matching the path, by `--no-verify`. The test is not. It also has an **allow-list** assertion,
not just a blocklist: the module may reach outside itself for `zod`, `@/lib/types/json` and
`@/lib/types/project`, and nothing else. Adding a fourth entry should be a decision somebody
makes on purpose.

Imports are checked **textually**, not by loading the modules. An import that is merely present
already breaks a client bundle even if nothing calls it, so a runtime check would pass on a
module that fails to build.

**The practical consequence for you:** if you need the database, a provider or a React hook,
you are in the wrong folder. The timeline module takes a document and returns a document. Put
the rest in a router, a service, or a component.

## The six rules you have to know

### 1. Timing is two-formed, and the document says which form it is in

A generator does not say "caption at 2.4s". It says "words 0 through 3". Seconds come from
`doc.words`, so re-recording a line moves its captions automatically.

Every time field therefore accepts a number of seconds **or** a word anchor:

```ts
{ start: 0 }                   // absolute seconds
{ start: { wordIndex: 12 } }   // when word 12 is spoken
{ start: { word: 'anyway' } }  // the first word matching "anyway"
```

`{ word }` exists for the LLM's benefit — a model writing a document by hand gets indices wrong
constantly but quotes text reliably. It resolves to the **first** match, so it is only safe for
a word that appears once. Generators should prefer `{ wordIndex }`.

The root carries `timing: 'anchored' | 'resolved'`. `resolveWordAnchors()` flips it, and
`validate()` refuses a `'resolved'` document that still holds an anchor — because that document
would render the item at time zero rather than failing loudly.

This is why `timing` is a field on the document and not an argument to `validate`. The phase
contract is `validate(doc)`, one argument; carrying the expectation on the document is what
keeps it that way, and it means a player handed a document knows for itself whether to resolve
it first.

### 2. A duration anchor is an END, not a start

The trap in this module. It was not in the phase file and it is easy to get wrong.

```ts
{ start: { wordIndex: 4 }, duration: { word: 'anyway' } }
```

`start` means *when word 4 is spoken*. `duration` means *until "anyway" has been said* — it is
an **end**, measured to that word's `e`, and the stored duration is the distance from the item's
own start. Inclusive of the named word, because that is what the phrase means to someone writing
a script.

Resolving a duration anchor the same way as a start produces a duration equal to a **timestamp**.
That is a nonsense number that happens to be positive, which means it renders rather than
erroring — the hardest class of bug to notice. `resolveDuration()` and `resolveWordEnd()` in
`time.ts` are the only correct way to read one.

### 3. An item's `assetId` is a key into `doc.assets`, not an Asset row id

Two levels of indirection, and the field names make it genuinely confusing, so it is called out
loudly in `schema.ts` as `ASSET_HANDLE_INDIRECTION`:

```jsonc
{
  "tracks": [
    { "type": "video", "items": [{ "assetId": "bg_loop_07" }] }   // ← a HANDLE
  ],
  "assets": {
    "bg_loop_07": { "assetId": "ast_9f2…", "kind": "video", "license": "licensed" }
    //              ↑ the real Asset row id
  }
}
```

Two reasons. The same background appears on fifteen items, so swapping it must be one edit. And
`license` has to travel **with** the document, because a render must be refusable months later
without re-reading a provider's terms — gameplay-footage licensing is the product's largest
non-technical risk, and `PROGRESS.md` still lists it as blocked on an owner decision.

`AssetRef` has no `url` field and must never get one. URLs are signed per request and a stored
one is a leak with an expiry date.

`validate()` reports a handle that is not in `doc.assets` as `UNKNOWN_ASSET`. Catching that here
is the difference between a field-level error and a black rectangle in a video somebody paid for.

### 4. Captions reference word ranges, never text

A caption item holds `startWord` and `endWord`. It holds **no copy of its text**. The words live
in `doc.words` with their timings, so restyling, re-grouping or re-recording cannot desynchronise
a caption from the audio.

Three consequences that surprise people:

- **`trim`, `split` and `move` refuse caption items.** A caption's timing is derived, so "make
  this caption longer" is not an operation on the caption. You change its word range, or you
  change the words. `delete` *is* allowed — removing a caption group does not contradict the
  words, it just stops showing them.
- **`setCaptionText` is the only op that touches `doc.words`**, and it does three things, not
  one: replaces the words in the range, redistributes the original span across the new words **in
  proportion to their length** (an even split makes the caption visibly lag its audio mid-sentence
  — "I" and "unbelievable" do not take the same time to say), and **shifts every later caption's
  word range** when the word count changed. Skipping that last step is how an edit near the top of
  a script desyncs the whole video. A caption whose range *straddles* the edited one is refused
  rather than guessed at.
- **`start`/`duration` on a caption are a cache** of the word range, written by
  `resolveWordAnchors()` and never by hand. `validate()` reports a disagreement as
  `STALE_RESOLUTION`.

### 5. The video's length is the spine, not the furthest item

`documentLength()` measures the **video and audio lanes only** (`SPINE_TRACKS`), because those
are the two things with an intrinsic duration. Captions, overlays and scenes are decoration on
top, and an overlay at 90 seconds on a 58-second video is a bug worth reporting — not a reason to
make the video 90 seconds long. That is the `OUT_OF_RANGE` rule.

A document with no spine at all — a pure motion piece, which `motionFixture()` exists to exercise
— falls back to the furthest point on any lane. That makes the range check vacuous for it rather
than failing everything at zero.

### 6. `hashDoc` must ignore what does not change the picture, and nothing else

Phase 04 skips a paid Lambda render when a document's hash matches one already rendered, so this
function is load-bearing on **both** the bill and correctness, and its two failure modes are
opposite. Too sensitive and every customer pays twice for the same video. Too insensitive and a
customer is served someone else's edit.

So it ignores key order (JSON objects have none), absent-versus-`undefined`, float noise, and the
editor-only `label` on tracks and items — renaming a track must not cost a second render. The
ignore list is a short named constant, `CACHE_IRRELEVANT_FIELDS`, and a test asserts it still has
exactly one entry. Every addition to it is a decision to serve a stale video and should read like
one.

**It is FNV-1a, not SHA-256.** The module is pure, so `node:crypto` is out, and WebCrypto's
digest is async — which would make `hashDoc` impossible to call from a render path. This is a
cache key, not a security boundary; collision resistance against an adversary is not a
requirement, and 64 bits is far past what a workspace's render history can populate.

## The module, file by file

| File | What it owns |
| --- | --- |
| `schema.ts` | The v4 document. Zod schemas; every type is **inferred**, never hand-written |
| `errors.ts` | `ValidationError`, the closed `TimelineErrorCode` union, `ValidationResult` |
| `time.ts` | Anchor resolution, spans, document length, frames, `cloneDoc`, `iterateItems` |
| `validate.ts` | The schema parse plus 12 structural rules |
| `migrate.ts` | The stepwise v1→v4 chain |
| `ops.ts` | The nine edits as data, and `apply()` |
| `anchors.ts` | `resolveWordAnchors()` and frame snapping |
| `hash.ts` | `hashDoc()`, `canonicalize()`, `stableStringify()` |
| `fixtures/` | One document per project kind, plus a v1 document |
| `index.ts` | The barrel. **Import from `@/lib/timeline`**, not from the files |

Import through the barrel so the internal split stays free to change.

## `validate()` returns; it does not throw

Every consumer needs to attach a problem to a *place*: the editor highlights a clip, the
generator retries one line, the render refuses with a reason a human can act on. A thrown `Error`
collapses all of that into a string.

```ts
const result = validate(doc)
if (!result.ok) {
  // result.errors: { path: 'tracks.2.items.0.duration', code: 'BAD_DURATION', message: '…' }[]
}
```

The result is discriminated on `ok`, so a caller that forgets to check cannot reach `.doc` — the
compiler refuses. `path` is the dotted route into the document, which is what the editor maps
back to a clip. `message` is user-facing copy, not a developer note; these reach the screen.

`validate()` returns the **parsed** document, not its input. Zod has filled defaults (`timing`,
`fit`, `gain`) by then, so the caller gets the normalised form and two readers cannot disagree
about what a missing `muted` means.

The rules run in dependency order and **skip rather than cascade**. A document with a broken word
list reports that once, not once per caption that referenced it. There is a test for exactly
that, because the cascading version looks like it works.

## `migrate()` runs on every read, without exception

A project rendered in January must still render in December. The alternative — a one-off backfill
— fails the moment a customer's document is restored from a backup, arrives from an export, or
was written by a release that got rolled back.

Each step upgrades by exactly **one** version and knows nothing about the others. A
v1-straight-to-v4 shortcut looks like a saving and costs a combinatorial number of paths the
first time v5 lands. `MIGRATIONS` is keyed by *source* version, so a document joins the chain
wherever it happens to be, and a gap is a missing key rather than an off-by-one. A test asserts
the chain spans 1 to `TIMELINE_DOC_VERSION` with a step for every number between — **that is the
test that will catch the next real bug here**, because bumping the version without adding a step
makes every stored document unreadable and nothing else in the suite would notice.

The steps work on loose JSON, not typed documents. A v1 document is not a `TimelineDoc` and never
will be, so giving each legacy shape its own full zod schema would mean maintaining four obsolete
schemas forever. The guarantee comes from the **end** of the chain, where `validate()` parses the
result.

Two entry points:

- `migrate(doc)` → `TimelineDoc`, throwing `TimelineMigrationError` (which carries `errors`). Use
  it where a bad document is an exception — there is no partial timeline to render.
- `tryMigrate(doc)` → `ValidationResult<TimelineDoc>`. Use it where a bad document is an expected
  outcome: a bulk re-render skipping one broken project, an import naming the file that failed.

`projects.get` uses `tryMigrate` and returns `timeline: null` with the reasons attached, so the
project page still has a title, a status and a **delete button** to offer. A hard failure would
strand the customer with no way to remove the broken project.

## `apply(doc, ops)` — the editor's contract

Ops are **data**, not method calls: a zod-validated discriminated union. That is what lets the
editor send them over tRPC, keep an undo stack of them, and replay them against a newer revision
when two people edited at once. They arrive from a browser, so they are validated like any other
input.

```ts
const { doc: next, errors } = apply(doc, [
  { type: 'trim', itemId: 'i1', duration: 4.2, ripple: true },
])
```

| Op | Notes |
| --- | --- |
| `trim` | Moves the head **without** moving the tail, or sets the length. Not conflated with `move` |
| `split` | Cuts at an absolute time, strictly inside the clip. Tail id is derived (`a1` → `a1-2`) |
| `move` | Slides an item, keeping its length |
| `delete` | Removes an item. The only time op that accepts a caption |
| `reorder` | Rearranges a track. Must list **every** item exactly once |
| `setCaptionText` | See rule 4 — the only op that edits `doc.words` |
| `setItemProps` | An **allow-list** patch, re-parsed against the target track's item schema |
| `addItem` | Appends, parsed against the track's own item schema |
| `addOverlay` | The same handler, pinned to an overlay track — a distinct intent in an undo stack |

Three properties hold, and all three are asserted per-op in `ops.test.ts`:

- **Pure.** The input document is byte-identical afterwards. This is what the undo stack depends
  on and the easiest thing to break with a stray in-place sort.
- **Atomic per op.** A failing op records an error, leaves the document exactly as it was *before
  that op*, and the remaining ops still run. A half-applied trim — duration changed, ripple not —
  is the one outcome nobody could recover from.
- **The result is re-validated.** A legal op can leave an illegal document (two overlays colliding
  at a depth after a move), and `apply` reports that in the same call.

`apply` returns the document **even when there are errors**, because the editor needs something to
render. Four of five ops succeeding and the fifth saying "that clip is outside the video" is a
usable screen; throwing it all away would lose the four.

### Ripple is per-track, never per-document

`trim`, `move` and `delete` take `ripple`, which shifts items on the **same track** that began at
or after the edited item's end. Rippling globally would drag the music bed and every caption along
with a background clip, which is never what the gesture meant.

### Editing requires a resolved document

`trim`, `split` and `move` refuse an anchored item. The editor writes absolute times by
definition (`architecture.md`'s invariant), so an op against an anchored document means the
pipeline skipped `resolveWordAnchors()`. "Shift this anchor by 0.4s" is not a meaningful request.

## `resolveWordAnchors()` and frame snapping

Replaces every anchor with absolute seconds **snapped to the canvas frame grid**, fills each
caption's cached times from its word range, and marks the document `resolved`.

Snapping is not an optimisation. The renderer works in whole frames, so an unsnapped 2.4133s
becomes frame 72.399 and gets floored somewhere downstream — by Remotion, by the player, by each
independently. Snapping once, here, is what makes the editor's preview and the paid render agree
to the frame. Rounded, not floored: flooring loses up to a frame per conversion and the losses
compound, pulling the end of a sixty-second video visibly off its audio.

**Partial resolution is deliberate.** An anchor naming a word the script does not contain is
*left in place* and the document stays `anchored`. Marking it resolved would make `validate()`
report the leftover anchor as the problem when the real problem is the missing word; silently
zeroing it would render the item at the start of the video. The document comes back honest about
not being ready, and `validate()` names the dangling anchor as `ANCHOR_NOT_FOUND`.

Use `hasUnresolvedAnchors(doc)` as a precondition — a render must never start on an anchored
document — rather than reading `timing`, which a generator sets by hand.

### The bug this interaction caused

Worth knowing, because it is the kind of thing that recurs. `resolveWordAnchors` writes caption
times snapped to the frame grid, while `validate` compared that cache against the **raw** word
times at microsecond tolerance. Every document the resolver produced therefore failed validation.

The tolerance is now one frame (two for a duration, which has two snapped edges), because that is
the precision the resolver actually works at. A tolerance that looks stricter was simply wrong.

## Fixtures are production data

`src/lib/timeline/fixtures/` lives in `src/`, not in a test folder, because it has three
consumers: Phase 03's Remotion studio renders them as its development compositions, Phase 06's
generators are written against their shape, and the tests assert on them. One set, so a format
change cannot pass the tests while breaking the studio.

Each is produced by a **function**, not exported as a shared object — the ops are pure and the
tests assert they do not mutate their input, which a shared mutable fixture would quietly
undermine.

`FIXTURES_BY_KIND` is a full `Record<ProjectKind, …>`, so adding a fifth format to
`PROJECT_KINDS` fails to compile until it has a fixture. Each one earns its place:

| Fixture | What it is there to exercise |
| --- | --- |
| `redditStoryFixture` | All five track types at once; the format the product was shaped around |
| `voiceoverFixture` | The **anchored** form, with both anchor kinds and a duration anchor |
| `quizFixture` | Scene elements carrying real structure; back-to-back items, for ripple |
| `motionFixture` | **No spine** and an **empty word list** — the `documentLength` fallback |
| `legacyV1Fixture` | A v1 document, preserved verbatim. Typed `JsonObject`, not `TimelineDoc` |

## Projects — the data and the router

### Two tables, on purpose

`Project` holds everything cheap to query. `Timeline` holds the document, in a 1:1 row keyed by
`projectId` with no surrogate id. The split is because `Timeline.doc` is jsonb that runs to
hundreds of kilobytes, and `include: { timeline: true }` on a page of twenty rows is how a list
screen starts timing out in month three. `PROJECT_LIST_SELECT` in the service is explicit for the
same reason.

`Timeline` carries two numbers that are easy to confuse: `docVersion` is the **document schema**
version that `migrate()` acts on; `revision` is the **optimistic concurrency** counter the editor
bumps per save.

`kind`, `status` and `aspect` are Prisma `String` columns, because this schema has zero enum
blocks. The validated unions live in `src/lib/types/project.ts` and they are the only thing
standing between a typo and a project no renderer can open — which is why the router validates
against them rather than trusting its caller.

### The branch policy, settled now

`architecture.md` flags this as decide-early-or-suffer, so the data shape is fixed in this phase
even though Phase 15 implements the UI:

**Regenerating a project whose `manualEdited` is true creates a new `Project` row with `parentId`
set, and never overwrites the edited timeline.**

`projects.duplicate` already uses that shape — `parentId` points at the source. A copy and a
branch are deliberately the same shape, because two shapes would mean the version history could
not show them in one tree. `manualEdited` is **not** copied: the duplicate has had no manual work
done to it, and inheriting the flag would make its first regeneration branch again for no reason.

### `duplicate` is the one handler that gates by hand

Read `docs/05-feature-gates.md` first: the plan limit and the usage counter are auto-derived from
the registry, and `projects` declares a `limit`, so `projects.create` is gated and counted with
nothing declared in the router.

The factory fires on the path segment `create` and **nothing else**. `duplicate` also produces a
project, so it would slip past the cap and leave the counter one short of reality. It is therefore
the one handler in the router that calls `checkFeatureGate` and `incrementUsage` itself, both
inside the handler's transaction so a failed copy cannot leave the counter inflated.

The refusal is built to the **same shape** the factory throws, so the client's upgrade modal opens
identically whether the cap was hit by `create` or by `duplicate`.

Renaming the verb to `createCopy` would have bought the automation back and lost the audit
template and the client cache key. That is the worse trade — but it is the kind of thing to weigh
again if a second non-`create` creator appears.

Also note: the document is copied **un-migrated**. Migrating on copy would mean a duplicate
renders differently from the original it was taken from, which is exactly what someone
duplicating a finished video does not want. `get` migrates on read, as everything does.

### `rename`, not `update`

The only other writable fields are `status` and `manualEdited`, and neither is the customer's to
set — the pipeline owns one and the editor owns the other. A general `update` would have to defend
each of them.

## Two things that will bite you

### `aspect` is required, not defaulted

`createProjectSchema.aspect` has no `.default()`. A zod default makes the schema's **input** and
**output** types differ, which breaks React Hook Form's resolver typing outright — the error is a
forty-line `Resolver<…> is not assignable to Resolver<…>` that does not mention defaults at all.
It would also have been the third place `'9:16'` is written, after the form's `defaultValues` and
the Prisma column.

If you add a field to a form schema, do not reach for `.default()`.

### `form.watch()` fails the React Compiler lint

`create-project-sheet-content.tsx` shows one field conditionally on the selected format. Use
`useWatch({ control, name })`, not `form.watch(name)` — the compiler refuses to memoize a
component that calls `watch()`, because it returns a function whose result it cannot track. The
rule is `react-hooks/incompatible-library`.

## Status

Phase 01 is complete. The migration is applied, and the CRUD path, the filters and the plan limit
were verified end to end in a browser on 2026-10-19 — including a direct tRPC call that bypasses
`<FeatureGate>` to prove the **server** refuses at the cap, and a counter that read 0 → 3 → 0 so
both the automatic and the hand-written usage bumps are accounted for.
`docs/phases/PROGRESS.md` lists everything that was exercised.

That run also turned up a pre-existing hydration mismatch in the dashboard shell —
`useIsMobile()` returns `false` on the server while `src/components/ui/sidebar.tsx` branches on
it structurally, so a narrow client discards the tree. It affects every dashboard page and is not
this phase's; it is written up in `PROGRESS.md`.

## What Phase 01 did not finish

- **The branch policy is a contract, not a behaviour.** Nothing regenerates until Phase 15.
- **`revision` is returned but nothing acts on it.** `projects.get` sends it to the client and no
  write checks it, so there is no conflict detection yet — optimistic concurrency is Phase 15's
  problem. The column is here so the editor does not need a migration to get it.

## Where to go next

`docs/phases/02-media-assets.md` — uploads, the ingest job and signed URLs, which is what turns
the asset *handles* in this document into real files. Phase 03 then renders one.

When you get to Phase 03, the rule to carry over is the one in `architecture.md`: an unknown
`render` value logs a warning and draws nothing. A bad item must never crash a paid render.
