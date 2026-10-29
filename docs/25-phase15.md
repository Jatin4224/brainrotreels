<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 15 — the timeline editor

Every phase up to here produced video **for** the customer. This one hands it
over: a multi-track editor where they fix what the generator got wrong instead
of regenerating and hoping. It is the first screen in the product that WRITES a
timeline document, and that single fact is what makes it the riskiest phase so
far — the document is the contract every other phase reads.

The one decision to read if you read nothing else is that **there is no second
implementation of an edit**. The browser does not have a trim that resembles the
server's trim. It calls the same function, from the same file, over the same
input. Everything else in this phase is scaffolding around keeping that true.

## The one-sentence version

Every gesture becomes an `Op`, `apply()` runs it in the browser so the preview
redraws immediately, a debounced autosave posts the same ops to the server which
replays them through **that same `apply()`** against the stored document, and a
revision compare in the WHERE clause of the save decides who wins when two tabs
disagree.

## Where the code lives

| Path | Contains | Touches the database? |
| --- | --- | --- |
| `src/lib/timeline/ops.ts` | the eleven edits and `apply()` — **unchanged in shape**, two ops added | **no** — pure, isomorphic |
| `src/lib/timeline/session.ts` | the editor's state machine: undo/redo stacks, unsaved queue, rebase | **no** — pure, isomorphic |
| `src/lib/types/timeline.ts` | the procedure inputs, the save-result union, the inspector's forms | **no** |
| `src/services/timeline.service.ts` | the compare-and-set save, the snapshot trail, the prune | **yes** — the only layer that does |
| `src/trpc/routers/timeline.ts` | `open`, `applyOps`, `revisions`, `restore`, `resynthLine` | via the service |
| `src/trpc/routers/projects.ts` | the branch on regenerate (`EXPLICIT_GATE_ON_A_BRANCH`) | via `ctx.db` |
| `.../projects/[id]/edit/_components/use-timeline-editor.ts` | the hook: autosave timer, conflict, shortcuts | via tRPC |
| `.../edit/_components/timeline-editor.tsx` | the shell: player, toolbar, conflict banner, history | no |
| `.../edit/_components/timeline-tracks.tsx` | five lanes, ruler, playhead, trim/move/snap | no |
| `.../edit/_components/timeline-inspector.tsx` | per-item forms, stacking, the one paid control | via tRPC |
| `.../edit/_components/caption-word-timing.tsx` | word nudges and caption regrouping | no |
| `.../edit/_components/overlay-canvas.tsx` | drag and resize over the player | no |
| `.../edit/_components/add-media-button.tsx` | insert from the library into a lane | no |
| `.../edit/_components/delete-item-dialog.tsx` | the captions question | no |
| `src/components/global/render-panel/` | **moved here** from the preview route | via tRPC |
| `src/components/global/asset-picker/` | **new global** — the library picker | via tRPC |

There is **one migration** and it adds one table, `timeline_revision`, exactly
as the phase file specifies it.

## The property the whole phase rests on

`src/lib/timeline/` has been an `ISOMORPHIC_PURE_MODULE` since Phase 01, guarded
by `purity.test.ts` rather than by a lint rule — because a lint rule is
skippable and the claim had no consumer yet. This phase is the consumer. The
editor imports `apply()` directly into a `"use client"` component, so a single
`import 'server-only'` or `node:crypto` anywhere under that folder now breaks
the browser bundle rather than breaking nothing.

That is why the editor's state machine lives in `session.ts` — inside the pure
module — rather than inside the React hook. Three consequences:

- The phase's hardest check is asserted **directly**. "Undo restores a document
  whose hash matches the pre-edit hash exactly" is a unit test over `hashDoc`,
  not a thing somebody clicked. And `hashDoc` is the same function Phase 04 uses
  to decide a paid render can be reused, so a document that hashes equal is one
  that renders identically — the strongest available form of the claim.
- "The browser and the server produce the same result" is a test that runs the
  editor's path (`editSession` per gesture) and the server's path (`apply()`
  over the posted list) across one fixture and compares the hashes. A reducer
  tangled into `useState` is a reducer nothing can prove.
- The hook became small. It owns the debounce timer, the mutation and the
  keyboard — nothing that decides what an edit *means*.

## Two new ops, and the argument for the first one

The phase says **operations only**, and means it: no editor-local mutation of
the document, ever. Two features cannot be expressed as a forward edit, and
pretending otherwise would have produced a worse answer than admitting it.

### `restoreDoc` — a whole-document op

The undo stack holds **documents**, not inverse ops. That is deliberate:
`split` and `delete` have no faithful inverse. An inverted delete has to invent
the item's array position, and array position is what decides which of two clips
in a lane draws on top (`STACKING_ORDER`). A snapshot is exact by construction;
an inverse is a reconstruction that is usually right.

So undo *within* the autosave window could just shorten the unsaved queue — but
the autosave fires every 1.2 seconds, which would cap undo at roughly one
gesture. Undoing past a save means telling the server to go **back**, and there
is nothing to send but the document.

It does not weaken what ops exist for, and this is worth being precise about:

- `apply()` is still the single implementation — the restore runs through it.
- The result is still re-validated as a whole, so restoring a document that
  parses but breaks an invariant is refused rather than stored.
- The revision compare still happens **before** any op runs, so a restore cannot
  overwrite another tab's work any more than a trim can.

Grep `WHOLE_DOCUMENT_IS_STILL_AN_OP`, `UNDO_PAST_THE_SAVE`, `SNAPSHOT_UNDO`.

### `setWordTiming` — the word-level nudge

A word is not an item: it has no id, it lives in `doc.words`, and the captions
over it derive their timing *from* it. `trim` on a caption is refused for
exactly that reason (`CAPTIONS_FOLLOW_WORDS`), and a nudge is what somebody
actually wanted when they tried it.

It **refuses rather than clamps** when the nudge would cross a neighbouring
word. Clamping would silently produce a token order that disagrees with the
audio, and nothing downstream would report it — the captions would still render,
in the wrong order, confidently. Grep `NEIGHBOURS_ARE_THE_BOUNDS`.

## The save, and why the revision check is in the WHERE clause

`commitTimelineRevision` does not read the revision and then write. It writes
with the revision in the predicate:

```ts
await db.timeline.updateMany({
  where: { projectId, revision: expectedRevision },
  data: { doc, docVersion, revision: expectedRevision + 1 },
});
// written.count === 0  IS  the conflict
```

A read-then-write has the classic gap between the check and the write, and the
symptom is an edit that vanished with nothing logged. Here the **database**
decides the race, and no amount of load can make two savers both win. The
unique on `(projectId, revision)` is the second half of the same guard, which is
why it is not decoration. Grep `COMPARE_AND_SET`.

The router compares the revision too, *before* doing any work — that one answers
the client cheaply. Both are needed and they answer different questions.

### A conflict is a result, not an exception

`applyOps` returns a status union rather than throwing. Two tabs is a thing
people do, not an error condition, and the response to it is a **choice the UI
offers**: a banner that stops the autosave and offers to reload the server's
version. A thrown `CONFLICT` would be indistinguishable from a network failure
at the call site, and the one thing this phase forbids is losing an edit
silently. The editor never reloads by itself, because the unsaved work is on
that screen. Grep `CONFLICT_IS_A_RESULT_NOT_AN_ERROR`.

### There is a third status the phase's contract does not list

`applied | conflict | rejected`.

`apply()` returns a document **even when the result breaks an invariant**,
because the editor needs something to render — four of five ops succeeding and
the fifth reporting "that clip is outside the video" is a usable screen. The
server must not *store* that. A timeline with a zero-length clip or two overlays
colliding at a depth is a project the render pre-flight will refuse, and a
customer who autosaved into that state has no obvious way back.

So a rejected save leaves the stored document untouched, returns the reasons,
and the editor **keeps the broken state on screen** so it can be fixed or
undone. Reverting the screen instead would read as a gesture that never
registered. Grep `AN_INVALID_DOCUMENT_IS_NOT_STORED`.

Telling the two apart is possible because of a contract that already existed:
`apply()` reports a refused op under the dotted path `ops.<index>` and a broken
invariant under the document's own path. Grep `OP_PATHS_ARE_THE_CONTRACT`.

## The free plan cannot reach the editor, and no procedure checks for it

The phase requires that "a free workspace cannot reach the editor, server-side
included". That is satisfied by **where the router is mounted**, not by a check
anybody could forget.

`timelineEditor` is a registry entry with a `flag` whose `free` is `false`. The
procedure factory fires the flag gate on **every verb** of a flag resource —
queries as well as mutations — so mounting the router under that key refuses the
read too. One registry entry is the whole enforcement.

That is also why the editor reads through its own `timelineEditor.open` rather
than reusing `projects.preview`: preview is a read every plan is entitled to, so
routing the editor's data through it would leave the screen ungated. `open`
composes the same four helpers preview does (`tryMigrate`, `resolveWordAnchors`,
`signDocumentAssets`, `planComposition`) and adds the two things an editor needs
and a player does not — the revision to save against, and the narration lines.
Grep `GATE_IS_THE_WHOLE_ROUTER`.

## It touched shared code four times

### 1. `addItem` registers its own asset handle

An item naming a `doc.assets` handle the document has never heard of fails
validate()'s `UNKNOWN_ASSET` rule — so "insert from the media library" was
simply impossible before this. The op gained an optional `asset`.

It is part of the same op rather than an op of its own because the two halves
are one intent and neither is valid alone, and because `ATOMIC_PER_OP` would
otherwise let the item land while the handle was refused. **Re-pointing an
existing handle is refused**: the handle is shared, so moving it would silently
change which media every other item using it plays. Grep
`ADD_REGISTERS_ITS_ASSET`.

### 2. `itemPatchSchema` gained `startWord` and `endWord`

This is the phase's "regroup words", and the contrast with what is still absent
from that allow-list is the point. `start` and `duration` remain off it, because
a caption's **range is its position** (`WORD_RANGE_NOT_TEXT`) — setting a time
that contradicts the range is precisely what validate() calls
`STALE_RESOLUTION`. Moving the boundary is the only honest way to say "this word
belongs to the next caption".

### 3. Everything that moves a word drops the cached pair

A caption caches `start` and `duration` derived from its word range. Three ops
now invalidate that cache — `setCaptionText` (which already did),
`setWordTiming`, and a `setItemProps` that changes the range — and all three
**delete** it rather than recomputing it. That keeps `resolveWordAnchors` the
only code in the product that turns a word range into seconds, instead of
growing a second one that can disagree with it. Grep
`CACHE_IS_DROPPED_NOT_RECOMPUTED`.

### 4. The export panel became global

`RenderPanel` moved out of the preview route into `components/global/`, because
the editor ends in the same "export this" and already needs the per-plan
resolution set, the cost on the button, the watermark notice and the poll. A
second copy beside the editor would have been the same 450 lines with its own
drift. `components/global/asset-picker/` is new, and is the component the assets
router's own notes have called "the editor's asset picker in Phase 15" since
Phase 02.

## The regeneration policy, finally enforced

`architecture.md` lists this as decide-early-or-suffer, Phase 01 settled the
data shape, and until now nothing read it. `projects.generate` branches when
`manualEdited` is true: a new `Project` with `parentId`, the document copied,
the run pointed at the **branch**, and the edited version untouched down to its
revision.

The merge that is not offered is the interesting part. A regeneration rewrites
the words, and every manual caption regroup, overlay position and trim is
expressed against the words it replaced. A merge would keep some of them and
drop others, silently — which is the worst of the three possible behaviours. So
the UI says "Regenerate as a new version" and means it.

It takes the same explicit plan-cap check `duplicate` does, for the same reason:
the factory's automatic cap fires on the path segment `create` and nothing else,
so without it a workspace at its limit would branch past the cap and leave the
counter one short of reality. Grep `EXPLICIT_GATE_ON_A_BRANCH`.

## Snapshots

`timeline_revision` is written in the **same transaction** as the save that
produced it. Not afterwards and not in a job — a snapshot that can be missing is
not a recovery point, and recovering from a bad autosave is the only reason the
table exists.

They are snapshots, not an event log. Replaying ops to recover requires every op
in the chain to still apply cleanly against a document whose schema has since
migrated, which is exactly the situation somebody recovering from a bad autosave
is in. Grep `SNAPSHOTS_NOT_AN_EVENT_LOG`.

Two procedures beyond the phase's contract follow from it, both earned by its own
sentence that snapshots are "enough to recover from a bad autosave" — a table
nothing can read is not a recovery point. `revisions` lists them without their
documents (twenty copies of a 200KB document is 4MB, and a menu needs a number
and a time). `restore` goes through `apply()` carrying one `restoreDoc` rather
than writing the jsonb back, so it is validated and revision-checked like any
other edit — and it writes a **new** revision. History is appended to, never
rewound, which is what lets a restore itself be undone. Grep
`HISTORY_IS_APPENDED_NOT_REWOUND`.

The trail is pruned to `TIMELINE_REVISION_KEEP` inside the same call, by
revision rather than by age: an afternoon of editing produces hundreds of saves
in an hour, so an age cut-off would keep all of them and then drop the lot at
once.

## The decisions worth knowing

### Autosave sets the rate limit

`applyOps` is driven by a **debounced timer**, not a button — a completely
different shape from every other mutation in the app. It is sized at roughly one
save every two seconds for five solid minutes: tighter throttles a productive
session mid-edit, looser lets a stuck retry loop write a snapshot row per
request. Grep `AUTOSAVE_SETS_THE_RATE`.

It also carries `audit: false`, which is the first deliberate opt-out in the
codebase. An activity log taking a row every few seconds while somebody works
would bury every entry anybody reads it for. `timeline_revision` is this
feature's history and it stores the document rather than a sentence about it.

### Editing is free; exactly one control spends money

No credits, no usage counter. The money is in `renders`, and an edited project
pays there like any other. `resynthLine` is the single control on the screen
that spends anything, so it says so before it is pressed — and it posts to the
Phase 07 workflow rather than producing an op, because changing what a voice
*says* is a provider call, a re-alignment and a document patch, not a document
edit.

That is also why fixing a typo in a **caption** and fixing it in the **spoken
line** are two different controls. The first is `setCaptionText`, costs nothing,
and re-times the replacement words across the same span. The second re-records.
Conflating them would make every caption correction a bill.

### One save in flight, and the queue survives it

Ops made *while* a request is out are neither lost nor sent twice. The caller
sends a prefix and hands the count back to `confirmSession`, which drops exactly
that prefix and re-applies what is left **on top of the document the server
returned**. Taking the server's document rather than keeping the local one is
deliberate: a browser whose `apply()` somehow diverged converges on the next
save instead of drifting for a whole session. Grep `SERVER_IS_THE_TRUTH` and
`QUEUE_SURVIVES_A_FLIGHT`.

### A drag is a preview, then one op

Dragging a clip moves a CSS offset and nothing else; the document is untouched
until the pointer comes up, when **one** op is emitted for the whole gesture.
Two things fall out of that: the undo stack gets one entry per gesture rather
than one per mouse move, and the autosave posts one op rather than two hundred.
The same contract governs the overlay drag layer over the player. Grep
`DRAG_IS_A_PREVIEW_THEN_AN_OP` and `ONE_GESTURE_ONE_UNDO`.

Edges and bodies are **different handles**, not one handle with a modifier.
Dragging an edge changes the length without moving the other edge (`trim`);
dragging the body changes the start and keeps the length (`move`). `ops.ts`
names conflating them as the most common way a hand-rolled timeline gets edits
wrong. Grep `EDGE_IS_A_TRIM_BODY_IS_A_MOVE`.

Snapping is measured in **pixels**, not seconds, so the gesture feels identical
at every zoom level — and the dragged item's own edges are excluded from the
snap set, or every small drag would be pulled back to where it started.

### Deleting a scene asks

Both answers are right sometimes. Cutting a scene whose narration is also going
means its captions go with it; trimming a visual while keeping the voice means
they stay. The ops layer will not decide it — `delete` removes the item it names
and nothing else, deliberately — so the dialog asks, and whichever answer is
given, the ops go out in **one** call and cost one undo step. Grep
`DELETING_A_SCENE_ASKS`.

### The canvas drag is normalized, because the box is

An overlay's box is stored in 0–1 units of the canvas, so the gesture is
measured as a *fraction* of the layer's size rather than in pixels. A pixel
delta would be wrong the moment the preview is a different size from the canvas,
which it always is. It is also what keeps an overlay in place when the project's
aspect ratio changes. Grep `CANVAS_DRAG_IS_NORMALIZED`.

### A nudge is one frame of the document's own fps

Not a tenth of a second. A caption is drawn per frame, so a sub-frame nudge
changes nothing visible and makes the button feel broken — and a 24fps project
needs a different step from a 30fps one to move the same amount of picture. Read
off `doc.canvas.fps` rather than assumed. Grep `ONE_FRAME_IS_THE_UNIT`.

### The selection is derived, not synchronised

An item the last edit deleted resolves to "nothing selected" rather than being
cleared by an effect. The id in state is a *request*; the document is the
authority. There is no render in between where an inspector could be bound to a
missing item, and no `setState` in an effect for the React Compiler to complain
about. Grep `SELECTION_IS_DERIVED`.

## Narrowed or decided differently from the phase file

- **Drag-to-reorder within a lane is two buttons** — send back, bring forward.
  Both produce the same `reorder` op, moving one step is the whole of what the
  gesture is for, and a draggable list would be a second way to express an op
  that already has one.
- **There is no music picker separate from the media picker.** A music bed is an
  audio item with `duck` on, so the phase's "music picker" and "insert from the
  media library" are the same gesture against the same lane. One control that
  reaches every lane is less to learn than four that each reach one. Grep
  `MUSIC_IS_AN_AUDIO_LANE`.
- **The editor resolves word anchors on the way in and stores absolute times.**
  That is the phase's step 8 ("the editor begins writing absolute times instead
  of word anchors") implemented rather than intended: the ops refuse an anchored
  document, so every read and every save runs `resolveWordAnchors` first and the
  save stores the resolved result. Grep `RESOLVE_BEFORE_EDITING`.
- **Desktop-only is a notice at a CSS breakpoint**, not a measured width or a
  redirect. A width read on mount is wrong after the first resize, and somebody
  who opened a link on a phone should be told rather than bounced.

## Three findings about the phase file itself

- **The contract contradicts itself on conflicts.** It specifies a status union
  and then says the mutation "returns `{ doc, revision }` or throws CONFLICT".
  The union is right; see above for why the throw is not.
- **The undo requirement and the ops-only requirement are in tension, and the
  phase does not say so.** "Undo/redo in memory, 50 operations" plus "saving
  posts operations, not documents" plus a debounced autosave means undo reaches
  past the last save almost immediately. `restoreDoc` is the resolution; a
  reading that forbade it would cap undo at the debounce interval, which is not
  an editor anybody would use.
- **The registry snippet omits the rate limit**, which for a procedure driven by
  an autosave is the one setting most likely to be wrong.

## What is NOT in this phase

Multi-user collaboration, colour grading, keyframe curves and motion scene
editing, all of which the phase file excludes. Motion scenes are Phase 16's.

## What has never run

Be precise about this when reading the code, because the tests are green and the
green is narrower than it looks. The **pure** halves are genuinely verified: the
browser-equals-server comparison, the undo hash, the op refusals, the cache
invalidation and the asset-handle rules are all asserted over fixtures.

The **database** halves have never executed. Neon has been unreachable since
Phase 05, so no `timeline_revision` row has ever been written, no conflict has
ever been produced by two real tabs, and no project has ever branched. Scrubbing
a three-minute project on proxies is untested because R2 has never produced a
`proxy_480`. And `resynthLine` enqueues into Phase 07's workflow, which is still
blocked on `ELEVENLABS_API_KEY` — so no line has ever been re-recorded from this
screen.

The migration is pending alongside Phase 14's.
