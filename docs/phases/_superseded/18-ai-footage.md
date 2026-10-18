# Phase 18: Prompt-to-video AI footage

**Feature:** Feature 7
**Depends on:** phases 07 and 10

## Goal

A text prompt creates a video clip in the media library that can be placed on any timeline.

## Build

- Video-model adapter (fal.ai / Replicate) in `packages/providers`.
- Workflow `footage.generate` (trigger `footage/requested`): moderate prompt -> call model -> poll in separate steps -> store asset -> notify UI.
- Prompt moderation for trademarks and real people before any model call.
- Store `model_version` and prompt on the asset; ingest the clip through `asset.ingest` for variants.
- Metered separately from normal credits (its own price and hold), since it costs far more than the rest of the pipeline.
- UI: prompt box in the media library, progress state, insert into timeline on completion.
- Fallback to a stock clip or styled background if generation fails.

## Data

- `assets.kind = 'ai_footage'` with model metadata; ledger kind `footage`.

## Decision needed from the owner first

Confirm the chosen model's terms allow commercial use.

## Done when

- [ ] A prompt yields a clip in the library with a vertical variant and a proxy.
- [ ] A prompt naming a real person or brand is blocked before the model is called.
- [ ] A failed generation releases its hold.
- [ ] Closing the browser does not cancel the job.

## Not in this phase

- Long-form generation.
