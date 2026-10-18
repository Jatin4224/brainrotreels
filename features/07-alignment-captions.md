> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 07 — Alignment and caption styles

## Goal
Word-level timings for all narration, and a library of 30+ caption styles that render identically in preview and final video.

## Depends on
Phases 04, 06.

## Deliverables
- STT adapter returning word timings
- `alignments` table with caching by audio hash
- 30+ declarative caption styles and a style gallery UI

## Steps
1. STT adapter: `align({ audioUrl, scriptText }) -> Word[]` with `{ i, w, s, e, speaker }`.
2. Align the transcript back to the original script text so punctuation and spelling match what the user wrote.
3. Cache alignments by `hash(audio)`; store in `alignments(projectId, words, audioHash, engine)`.
4. Fallback: if STT fails twice, distribute words evenly across the known audio duration and mark the alignment `degraded`.
5. Define caption styles as JSON: font, weight, case, size, stroke, shadow, fill, highlight colour, animation (`pop`, `bounce`, `fade`, `slide`), max words per chunk, position.
6. Build 30+ styles; validate each for WCAG contrast against light and dark backgrounds.
7. `buildCaptionTrack(words, styleId)` returns caption items referencing word ranges only.
8. UI: caption style gallery with live preview over the chosen background, position slider, words-per-line control, on/off switch.

## Contracts
```ts
type Word = { i: number; w: string; s: number; e: number; speaker?: string }
```

## Acceptance criteria
- Captions on a 60-second sample land within ~50 ms of the spoken word.
- Changing style never changes timing.
- Long words and rapid speech wrap inside the safe zone, never overflowing.
- A forced STT failure still produces a renderable (degraded) video with a visible warning.

## Out of scope
Translation, manual timing edits (Phase 18).
