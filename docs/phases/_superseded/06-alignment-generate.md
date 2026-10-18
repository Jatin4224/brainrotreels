# Phase 06: Alignment and the generate workflow

**Feature:** Features 1-3 joined end to end
**Depends on:** phases 03 and 05

## Goal

One click turns a script into a previewable video: the `project.generate` workflow runs end to end for the simplest kind (`voiceover` with a plain styled background).

## Build

- STT adapter (ElevenLabs Scribe) returning word timings; cache by `audio_hash`. Keep the adapter interface ready for a second provider.
- Fallback when alignment fails: even-split timings, flagged as degraded.
- Inngest workflow `project.generate`: moderate -> script -> voices validate -> tts (fan-out) -> align -> kind-specific build -> captions -> timeline save -> estimate check.
- `packages/generators` with the contract `build(projectId): TimelineDoc` and a first generator: `voiceover` with a styled background, narration track, music with ducking, captions.
- Per-user concurrency (2 generations), `cancelOn` a cancel event, idempotency keys on enqueue, exponential backoff on provider calls.
- Progress UI driven by `pipeline_stages`, with status announcements for screen readers.
- Extend `line.resynth` to re-align and patch the timeline.

## Data

- `alignments` (project_id PK, words jsonb, audio_hash, engine).
- `pipeline_stages` (id, project_id, stage, status, error).

## Done when

- [ ] From a prompt, the app produces a narrated, captioned vertical video that previews and renders.
- [ ] Killing the process mid-run and retrying resumes from the failed step, not from the start.
- [ ] Cancel stops the run and marks the project cancelled.
- [ ] With STT disabled, the video still completes with degraded captions.

## Not in this phase

- Backgrounds from a library, Reddit, credits.
