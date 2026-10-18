# Phase 02: Render core

**Feature:** foundation for all features
**Depends on:** phase 01

## Goal

A timeline document renders to an MP4 in the cloud and plays in the browser from the same components.

## Build

- `packages/renderer`: Remotion composition `TimelineRenderer` that walks tracks and maps each item to a component family.
- Component families for this phase: `MediaClip` (video/image with fit, loop, Ken Burns), `TextOverlay`, audio items with gain. Leave a registry so later phases add `Captions`, `RedditCard`, `QuizCard`, `MotionScene`, `AvatarOverlay`.
- Asset resolution: items carry `assetId`; a resolver signs URLs at preview and render time.
- Preview page `/projects/[id]/preview` using Remotion Player.
- Remotion Lambda deploy script (versioned site per deploy).
- Inngest workflow `project.render`: validate doc -> resolve assets -> start Lambda -> wait for webhook -> finalize. The render is started in one step and awaited in another; never block inside a step.
- `/api/webhooks/remotion` with signature verification.
- Output: MP4 H.264/AAC 1080x1920 at 30 fps plus a poster frame, stored under `users/{userId}/projects/{projectId}/renders/{renderId}/`.

## Data

- `renders` (id, project_id, provider_render_id, doc_hash, status, progress, output_asset_id, credits_charged, cost_breakdown jsonb), unique (project_id, doc_hash).
- `assets` minimal version (id, user_id, kind, source, storage_key, bytes, duration_sec, license, moderation_status).

## Done when

- [ ] A fixture document with a background video, a text overlay and an audio file previews in the browser.
- [ ] Clicking Render produces an MP4 in R2 and the page shows a signed download link.
- [ ] Rendering the same unchanged document twice reuses the first render (doc_hash).
- [ ] A failed Lambda render marks the row `failed` and can be retried with a new render id.

## Not in this phase

- Captions, credits, watermark.
