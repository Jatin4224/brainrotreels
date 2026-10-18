# Phase 01: Timeline model package

**Feature:** foundation for all features
**Depends on:** phase 00

## Goal

`packages/timeline` is the single source of truth for the timeline document: schema, validation, migrations and edit operations, usable in the browser and on the server.

## Build

- Zod schema for the v4 document exactly as in `docs/architecture.md` (canvas, style, words, tracks of type video/scene/audio/caption/overlay, speakers, assets). Export the inferred `TimelineDoc` type.
- `validate(doc)`: no negative durations, items inside the video length, caption word ranges exist in `words`, every `assetId` exists in `assets`, unique item ids, sane z-order.
- `migrate(doc)`: version registry that upgrades older versions step by step; called on every read.
- `apply(doc, op)`: pure functions for `trim`, `split`, `move`, `delete`, `setCaptionText`, `addItem`, with optional `ripple`. Returns a new doc; never mutates.
- `resolveWordAnchors(doc)`: turn word-anchor timings into seconds and frames.
- `hashDoc(doc)`: stable hash (sorted keys) used later for `renders.doc_hash`.
- Fixture documents for each kind under `packages/timeline/fixtures`.

## Data

- `projects` (id, user_id, kind, status, aspect, manual_edited, settings jsonb, source_ref).
- `timelines` (project_id PK, doc_version, doc jsonb, revision, updated_at).
- Data-access functions that always filter by `userId`.

## Done when

- [ ] Unit tests cover every validation rule and every op, including ripple and split edge cases.
- [ ] A v1 fixture migrates to v4 and validates.
- [ ] The package has no Node-only imports (it must bundle for the browser).

## Not in this phase

- Rendering, UI, generators.
