# Phase 08: Character avatars

**Feature:** Feature 2 (avatars)
**Depends on:** phases 05 and 07

## Goal

Each speaker has a consistent avatar that appears on screen while that speaker talks.

## Build

- `packages/avatars`: `getAvatarSet(avatarId)` returning the neutral, talking and reaction images.
- Seed original illustrated avatar sets under `library/avatars/{id}/{state}.png`.
- `AvatarOverlay` component family: shows the active speaker's avatar, swaps to the talking state on word timings.
- Generators add overlay items aligned to each narration line.
- Avatar picker in the speaker mapping UI; voices suggest a default avatar.
- `GET /api/catalog/avatars` filtered by plan.

## Data

- `avatars` (id, name, asset_set jsonb, min_plan); `speakers.avatar_id` now used.

## Done when

- [ ] In a two-speaker video the right avatar is visible for each line and switches on the line boundary.
- [ ] The same avatar looks identical across two renders.

## Not in this phase

- User-uploaded likenesses (not allowed).
