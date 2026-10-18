# Phase 17: Motion studio: storyboard and visual QA

**Feature:** Feature 8 (part 2)
**Depends on:** phases 06 and 16

## Goal

A prompt becomes a motion graphics video designed by the model and checked before the user sees it.

## Build

- Storyboard step: script -> beats (what is shown per narration segment).
- Beat design step: for each beat the LLM emits a scene in the scene language, constrained to existing layouts and primitives.
- QA loop per beat: deterministic checks, then a still render reviewed by a vision model; up to 2 repair attempts, then a safe fallback beat.
- `motion` generator assembling scenes, narration, music and captions.
- Motion wizard UI with per-beat regenerate.
- WebM export option.

## Data

- No new tables; store storyboard in `projects.settings`.

## Done when

- [ ] A prompt produces a renderable motion video where every scene passes the deterministic checks.
- [ ] A deliberately broken scene is repaired or replaced by the fallback, never shown broken.
- [ ] Regenerating one beat leaves the others unchanged.

## Not in this phase

- Generative video footage.
