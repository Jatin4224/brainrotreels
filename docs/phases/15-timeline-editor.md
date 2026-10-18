# Phase 15 — Timeline editor

**Depends on:** Phases 01, 03, 09.

## Goal

A multi-track editor so users can fix anything the generator got wrong without leaving the product.
Every edit runs through the same `src/lib/timeline` operations the server runs — there is no second
implementation, because that is the documented way this design fails.

## Registry

```ts
timelineEditor: {
  name: 'Timeline editor',
  flag: {
    perPlan: { free: false, starter: true, pro: true, enterprise: true, portal: true },
    availableOnFreeTrial: true,
  },
}
```

## Data

```prisma
model TimelineRevision {
  id         String   @id @default(cuid())
  projectId  String
  revision   Int
  doc        Json
  createdAt  DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, revision])
  @@index([projectId, createdAt])
  @@map("timeline_revision")
}
```

Snapshots, not an event log — enough to recover from a bad autosave without rebuilding history from
operations. `Project.parentId` and `Project.manualEdited` from Phase 01 carry the branch policy;
nothing new is needed for it.

## Build

1. **Layout.** `/dashboard/projects/[id]/edit` — canvas preview top left, inspector right, tracks
   along the bottom full width: Scenes, Overlays, Captions, Voice, Music. Desktop only, with a clear
   notice on small screens rather than a broken layout. Use `<ContentLayout width="full">`.
2. **Playback** through Remotion Player on the same document, reading `proxy_480` variants so
   scrubbing a three-minute project stays smooth.
3. **Operations only.** Every interaction — scrub, zoom, snap to boundaries, trim edges, split (`S`),
   delete, drag to reorder, ripple toggle, canvas drag and resize of overlays, inline caption text
   editing, word-level timing nudges — produces an `Op` and goes through `apply()` from
   `src/lib/timeline`. **No editor-local mutation of the document, ever.** The server runs the same
   function on the same input, which is the only reason the preview and the render agree.
4. **Saving posts operations, not documents.** `timeline.applyOps` takes
   `{ organizationId, projectId, revision, ops[] }`. The server re-applies them against the current
   document, bumps `Timeline.revision`, and writes a `TimelineRevision` snapshot. A revision
   mismatch returns a `conflict` the UI handles by offering reload — it never silently overwrites.
   Two tabs editing the same project is a real scenario, not a hypothetical.
5. **Autosave** debounced, with a visible Saving / Saved indicator. Posting operations rather than
   whole documents keeps the request small and makes collision detection possible at all.
6. **Undo/redo** in memory, 50 operations, with keyboard shortcuts. Undo must restore the exact
   previous document — test it by hashing before and after.
7. **Guards.** No zero or negative durations. Deleting a scene asks what to do with its captions
   rather than orphaning them. Overlapping overlays resolve by explicit z-order, never by array
   position.
8. **First edit sets `manualEdited = true`** and the editor begins writing absolute times instead of
   word anchors. From that point the document is the user's, not the generator's.
9. **Caption, overlay and audio editing.** Change caption text, regroup words, restyle, reposition,
   per-caption overrides. Add text, image and clip overlays; move, resize, reorder by z. Per-item
   gain, music picker, ducking toggle. Insert from the media library into any track.
10. **Editing a narration line** triggers `line.resynth` from Phase 07 → re-align → patch the
    document. Only that line's audio, timings and captions change.
11. **The regeneration policy, enforced.** Regenerating a project whose `manualEdited` is true
    creates a **new `Project` row with `parentId` set** and leaves the edited version untouched. The
    UI states this plainly — "Regenerate as a new version" — rather than offering a merge that
    cannot be made correct. `architecture.md` lists this as decide-early-or-suffer; Phase 01 settled
    the data shape, this phase honours it.
12. **Export** shows the re-render cost from Phase 05 on the button.

## Contracts

```ts
// src/trpc/routers/timeline.ts
applyOps: protectedProcedure({ requirePermission: permissions.PROJECTS_UPDATE })
  .input(z.object({
    organizationId: z.string().min(1),
    projectId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    ops: z.array(opSchema).min(1).max(50),
  }))
  .mutation(/* returns { doc, revision } or throws CONFLICT */)

export type ApplyOpsResult =
  | { status: 'applied'; doc: TimelineDoc; revision: number }
  | { status: 'conflict'; serverRevision: number }
```

## Done when

- [ ] Trim, split and ripple produce the same result in the browser as the server produces for the
      same operations, proven by a test running both paths over one fixture.
- [ ] Two tabs editing the same project: the second save receives `conflict` and is offered a
      reload. Nothing is silently lost.
- [ ] Undo restores a document whose hash matches the pre-edit hash exactly.
- [ ] Scrubbing a three-minute project stays smooth on proxies.
- [ ] Editing one narration line updates that line's audio, timings and captions, and nothing else.
- [ ] Editing a caption's text never breaks its sync.
- [ ] Regenerating an edited project leaves the edited version intact and creates a new one with
      `parentId` set.
- [ ] Deleting a scene with captions prompts rather than orphaning them.
- [ ] A free workspace cannot reach the editor, server-side included.

## Not in this phase

Multi-user collaboration, colour grading, keyframe curves, motion scene editing.
