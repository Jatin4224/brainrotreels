> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 03 — Timeline document package

## Goal
The single data contract every other phase depends on: a versioned, validated multi-track timeline document with pure editing operations.

## Depends on
Phase 01.

## Deliverables
- `packages/timeline` with Zod schemas, version migrations, operations, and tests
- `timelines` table storing `doc` + `revision`

## Steps
1. Define the schema: `canvas`, `style`, `words[]`, `speakers`, `assets`, `tracks[]`.
2. Track types: `video`, `scene`, `audio`, `caption`, `overlay`. Item types carry `render` (`media`, `motion`, `quizCard`, `redditCard`, `characterOverlay`, `text`).
3. Support both timing forms: word anchors (`{ wordIndex }` or `{ word }`) for generated content, absolute seconds after resolution.
4. Implement `resolveAnchors(doc)`: converts anchors to seconds/frames using `words[]`. Pure, tested.
5. Implement operations as pure functions: `trim`, `split`, `move`, `delete`, `reorder`, `setCaptionText`, `setItemProps`, `addOverlay`, with an optional `ripple` flag.
6. Implement validation: no negative or zero durations, no gaps in the scene track, captions reference valid word ranges, z-order unique per overlapping overlay, items inside canvas bounds.
7. Implement `migrate(doc)` from older `version` values; always migrate on read.
8. Add `hashDoc(doc)` (stable JSON hash) used later to deduplicate renders.
9. Create the `timelines` table: `projectId` PK, `doc` jsonb, `revision` int, `updatedAt`.
10. Tests: at least 25 unit tests covering operations, ripple behaviour, validation failures, migration.

## Contracts
```ts
type TimelineDoc = { version: number; kind: ProjectKind; canvas: {...}; words: Word[]; tracks: Track[]; ... }
export function apply(doc: TimelineDoc, ops: Op[]): { doc: TimelineDoc; errors: ValidationError[] }
export function resolveAnchors(doc: TimelineDoc): TimelineDoc
export function hashDoc(doc: TimelineDoc): string
```

## Acceptance criteria
- Every operation is pure: given the same input it returns the same output and never mutates.
- Invalid documents are rejected with field-level errors, never thrown raw.
- A v1 document migrates to the current version without data loss.
- 100% of operations have tests; `pnpm test` passes.

## Out of scope
UI, rendering, persistence beyond the table.
