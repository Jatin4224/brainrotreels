# Phase 16: Motion studio: scene engine

**Feature:** Feature 8 (part 1)
**Depends on:** phase 02

## Goal

A scene described as data renders as a designed, animated scene. No AI yet.

## Build

- Scene language (Zod): layout + elements + animations, timed by word anchors or scene-relative time.
- Layout engine: named layouts (for example stack-center, split, grid, lower-third) that place elements inside the safe zone.
- Primitive library for `MotionScene`: text reveals, counters, charts, lists, icons, shapes, image frames, transitions. Quality here decides the feature; invest in easing and spacing.
- Palette and typography tokens from `styles`.
- Deterministic checks: text overflow, overlap, contrast, element count.
- A gallery page that renders every primitive and layout for visual review.

## Data

- Scenes live inside timeline `scene` items (`render: 'motion'`); no new tables.

## Done when

- [ ] Each primitive and layout renders in the gallery in every palette.
- [ ] Deterministic checks catch an overflowing text element.
- [ ] A hand-written three-scene document renders to MP4 (and WebM).

## Not in this phase

- LLM storyboard and design (phase 17).
