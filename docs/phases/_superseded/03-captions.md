# Phase 03: Auto-synced captions

**Feature:** Feature 3
**Depends on:** phase 02

## Goal

Word-timed captions render from the `words` list in any of the declarative styles.

## Build

- `packages/captions`: `buildCaptionTrack(words, styleId)` groups words into caption items that reference word ranges (never text copies).
- Style definitions as data (tokens: font, size, stroke, highlight colour, animation, words per group, position). Ship 30+ styles as config, not code.
- Safe-zone placement for TikTok / Reels / Shorts and a contrast check against the background.
- `Captions` component family in the renderer: one component that reads `words` + style tokens and highlights the active word.
- Caption style picker UI with live preview; keyboard navigable with ARIA labels.
- `GET /api/catalog/caption-styles`.

## Data

- `styles` (id, owner_id, tokens jsonb, caption_style_id, is_library).

## Done when

- [ ] Given a fixture `words` list, captions appear on the exact word timings in preview and in a cloud render.
- [ ] Switching style changes the look without changing timing.
- [ ] Unit tests for grouping rules and safe-zone placement.

## Not in this phase

- Producing word timings from audio (phase 06).
