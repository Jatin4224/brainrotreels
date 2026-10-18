> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 06 — Voices and text to speech

## Goal
A voice catalog and per-line narration synthesis with caching and previews.

## Depends on
Phases 02, 05.

## Deliverables
- `voices`, `avatars`, `speakers`, `narration_lines` tables
- TTS adapter in `packages/providers`
- Voice library UI panel with previews

## Steps
1. Seed `voices(id, name, gender, accent, tone, providerVoiceId, minPlan, previewUrl)` with 40+ licensed library voices. No clones of real people or third-party characters.
2. Seed `avatars(id, name, assetSet{neutral,talking,reaction}, minPlan)` with original illustrated characters.
3. `narration_lines(id, projectId, position, speakerTag, voiceId, text, audioAssetId, textHash, durationSec)`.
4. `speakers(id, projectId, tag, voiceId, avatarId, state)` where `state` is `unassigned | ready`.
5. TTS adapter: `synthesize({ text, voiceId }) -> { assetId, durationSec }`, cached by `hash(text + voiceId)`; store output as an `audio_tts` asset.
6. Normalise loudness with FFmpeg after synthesis; store duration.
7. `assembleNarration(projectId)`: concatenates line audio with configurable inter-line pauses into one track asset.
8. Preview endpoint: short sample per voice, cached, no credit cost.
9. UI: searchable, filterable voice grid (gender, accent, tone, plan badge) with play buttons and ARIA labels; speaker assignment panel showing unassigned speakers in red.

## Contracts
```ts
validateAssignments(projectId): { ok: boolean; unassigned: string[] }   // blocks generation
```

## Acceptance criteria
- Re-synthesising unchanged text costs nothing (cache hit by `textHash`).
- Editing one line invalidates only that line's audio.
- Generation is blocked while any speaker is `unassigned`.
- Premium voices are hidden behind a plan badge for free users.

## Out of scope
Custom voice cloning, avatar animation (Phase 15).
