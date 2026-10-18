# Phase 07: Media library and video backgrounds

**Feature:** Feature 4
**Depends on:** phase 02

## Goal

Users can pick a library background or upload their own video, and it arrives in the timeline already vertical and loop-ready.

## Build

- `packages/media`: `ingest(file)`, `transcodeVertical(assetId)`, `signUrl(assetId)`.
- Direct-to-R2 uploads with presigned URLs and size/type limits.
- Workflow `asset.ingest` (trigger `asset/uploaded`): codec/payload scan -> transcode to 1080x1920 centre-crop -> `proxy_480` + thumbnail + waveform -> moderation -> mark ready.
- FFmpeg worker (container or Lambda) invoked from the workflow.
- Library backgrounds seeded from a manifest; each asset records its `license`; served through the CDN.
- Background picker grid (library + my uploads), keyboard navigable.
- Generators loop the background to the narration length (`loop: true`, `muted: true`).
- `GET /api/catalog/backgrounds` filtered by plan.

## Data

- Complete `assets`; add `min_plan` for library rows.
- `asset_variants` (id, asset_id, variant, storage_key, width, height) for `vertical_1080`, `proxy_480`, `thumb`, `waveform`.

## Decision needed from the owner first

Decide the gameplay-footage licensing position before seeding the library (see Legal and licensing in docs/architecture.md). Until then seed only abstract or self-recorded loops.

## Done when

- [ ] Uploading a landscape clip yields a vertical 1080 variant, a 480 proxy and a thumbnail.
- [ ] The preview uses the proxy; the cloud render uses the 1080 variant.
- [ ] A corrupt or disallowed file is rejected and never reaches a render.
- [ ] Private assets are only reachable through signed, expiring URLs.

## Not in this phase

- AI-generated footage (phase 18).
