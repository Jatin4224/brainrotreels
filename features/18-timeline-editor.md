> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 18 — Timeline editor

## Goal
A multi-track editor so users can fix anything the generator got wrong, without leaving the product.

## Depends on
Phases 03, 12.

## Deliverables
- `/app/projects/:id/edit` with canvas, inspector and multi-track timeline
- Operation-based saving with revision conflict handling

## Steps
1. Layout: canvas preview (top left), inspector (right), tracks (bottom, full width): Scenes, Overlays, Captions, Voice, Music.
2. Playback: Remotion Player driven by the same document, using `proxy_480` variants for smooth scrubbing.
3. Interactions: scrub, zoom, snap to boundaries, trim edges, split (S), delete, drag to reorder, ripple toggle, drag and resize overlays on the canvas, inline caption text editing, word-level timing nudges.
4. All edits go through `packages/timeline` operations — the same code the server uses. No parallel implementation.
5. Saving: `POST /api/projects/:id/timeline/ops` with the loaded `revision`; mismatch returns `conflict` and the UI offers reload. Autosave with a visible Saving/Saved indicator.
6. Undo/redo in memory, 50 operations, with keyboard shortcuts.
7. Guards: no zero or negative durations; deleting a scene asks what to do with its captions; overlapping overlays resolve by explicit z-order.
8. Set `manualEdited = true` on the project at the first edit, so regeneration warns.
9. Export button shows the re-render cost; desktop-only with a clear notice on small screens.

## Acceptance criteria
- Trim, split and ripple produce the same result in the UI as the server-side operations do in tests.
- A conflicting edit from two tabs never silently overwrites; the user is asked to reload.
- Undo restores the exact previous document.
- Scrubbing a 3-minute project stays smooth using proxies.

## Out of scope
Multi-user collaboration, colour grading, keyframe curves.
