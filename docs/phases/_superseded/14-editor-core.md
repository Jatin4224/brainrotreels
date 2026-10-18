# Phase 14: Timeline editor: core

**Feature:** Feature 9 (part 1)
**Depends on:** phases 02 and 07

## Goal

Users can open any project in a multi-track editor and trim, split and move items, with safe saving.

## Build

- Editor page with a multi-track timeline, playhead, zoom and Remotion Player preview using `proxy_480` variants.
- Operations go through `packages/timeline` `apply()`: the same code runs in the browser and on the server.
- `POST /api/projects/:id/timeline/ops` taking `{revision, ops[]}`; the server applies them, bumps `timelines.revision`, and returns `conflict` on a revision mismatch.
- Client undo/redo stack (50 operations) and debounced autosave that posts operations, not whole documents.
- Trim, split, move and delete with optional ripple; snapping.
- First manual edit sets `manual_edited = true` and the editor writes absolute times.
- Keyboard shortcuts and ARIA labels for timeline controls.

## Data

- Uses `timelines.revision` and `projects.manual_edited`.

## Done when

- [ ] Trim, split and ripple behave the same in the browser and after reload from the server.
- [ ] Two tabs editing the same project: the second save gets `conflict` and reloads.
- [ ] Undo and redo restore the exact document.
- [ ] Scrubbing stays smooth on a 60-second project.

## Not in this phase

- Caption text editing, overlays, regeneration policy (phase 15).
