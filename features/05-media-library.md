> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 05 — Media library and asset pipeline

## Goal
One assets system for everything: library backgrounds, user uploads, generated audio, generated footage, and render outputs.

## Depends on
Phases 01, 02.

## Deliverables
- `assets` and `asset_variants` tables
- Upload flow with validation, transcoding, proxies and thumbnails
- Background library with tier gating
- `/app/media` page

## Steps
1. Tables: `assets(id, userId, kind, source, storageKey, bytes, durationSec, width, height, license, moderationStatus, minPlan)` and `asset_variants(assetId, variant, storageKey, width, height)`.
2. `kind`: `background | upload | ai_footage | image | audio_tts | audio_music | sfx | render_output | avatar`.
3. Signed upload: `POST /api/uploads/sign` returns a presigned PUT with content-type and size limits (MP4, MOV, WebM; images; audio).
4. On upload completion, emit an event handled in Phase 09; for now run the processing inline in a route: probe with ffprobe, reject unsupported codecs, transcode to `vertical_1080` (center-crop or pad to 9:16), create `proxy_480` and `thumb`.
5. Looping metadata: store `durationSec` so shorter backgrounds can loop at render time.
6. Seed a library of background loops and music under `library/`; mark `source='library'` with `minPlan`.
7. `signAssetUrl(assetId, userId)` enforces ownership or library status, returns a short-lived URL.
8. `/app/media`: tabs (All, Uploads, Backgrounds, Audio), grid with status chips, upload tile with progress, delete, rename.

## Contracts
```ts
ingestAsset(userId, file) -> { assetId, status: 'processing' }
getAssetVariants(assetId) -> { vertical_1080, proxy_480, thumb }
```

## Acceptance criteria
- A 16:9 MP4 upload becomes a 9:16 `vertical_1080` variant plus a proxy and a thumbnail.
- Oversized or wrong-codec uploads are rejected with a specific message.
- A free user cannot open a `minPlan: creator` background; it shows as locked.
- Asset URLs expire and cannot be shared across users.

## Out of scope
AI footage generation (Phase 20), moderation scanning (Phase 17).
