> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 04 — Render core (local Remotion)

## Goal
Turn a timeline document into an MP4 locally, with captions landing exactly on the spoken word.

## Depends on
Phase 03.

## Deliverables
- `packages/video` with a single `TimelineRenderer` composition
- Components: `MediaClip`, `Captions`, `TextOverlay`, `AudioTracks`
- A CLI script rendering a sample document to `out.mp4`

## Steps
1. Set up Remotion in `packages/video`; composition 1080×1920 at 30 fps, duration derived from the document.
2. `TimelineRenderer` walks `tracks` and maps each item's `render` type to a component. Unknown types render nothing and log a warning (never crash a render).
3. `MediaClip`: video or image with `fit: cover`, looping, muting, and optional Ken Burns motion.
4. `Captions`: reads `words[]` plus a caption style, groups 2–4 words, breaks on punctuation, highlights the active word, respects a safe-zone offset.
5. `AudioTracks`: narration items plus music with a ducking volume curve derived from word timings.
6. Bundle fonts locally (no network fonts) and preload all media before the first frame.
7. Add `scripts/render-sample.ts` rendering a committed fixture document.
8. Snapshot-test 3 frames (first, middle, last) of the fixture.

## Contracts
```tsx
<TimelineRenderer doc={resolvedDoc} assets={signedUrlMap} />
```
Captions never store text: they reference word ranges and read from `doc.words`.

## Acceptance criteria
- `pnpm render:sample` produces a playable 9:16 MP4.
- Captions visibly match the audio when checked by ear on a 30-second sample.
- Removing the music track or captions still renders correctly.
- Rendering is deterministic: the same document produces byte-identical frames.

## Out of scope
Cloud rendering, motion graphics components, quiz cards.
