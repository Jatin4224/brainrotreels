# Phase 05: Character voices and TTS

**Feature:** Feature 2 (voices)
**Depends on:** phase 04

## Goal

Every script line has a speaker, every speaker has a voice, and each line has a cached audio file.

## Build

- `packages/voices`: catalog of 40+ voice profiles (gender, accent, tone, linked avatar, `min_plan`), `listVoices(plan)`, `preview(voiceId)`, `validateAssignments(project)`.
- TTS adapter (ElevenLabs) in `packages/providers`, with a backup model fallback.
- Split script blocks into narration lines by speaker.
- TTS per line as an Inngest fan-out; cache by `text_hash` + `voice_id` so unchanged lines are never paid for twice.
- Normalise loudness with FFmpeg; store audio under `users/{userId}/projects/{projectId}/audio/{lineId}.mp3`.
- Workflow `line.resynth` (trigger `line/changed`): TTS one line only.
- Voice picker grid with previews and speaker -> voice mapping UI.
- `GET /api/catalog/voices`.

## Data

- `voices` (id, name, gender, accent, tone, provider_voice_id, min_plan).
- `speakers` (id, project_id, tag, voice_id, avatar_id nullable, state).
- `narration_lines` (id, project_id, position, speaker_tag, voice_id, text, audio_asset_id, text_hash, duration_sec).

## Done when

- [ ] A two-speaker script produces one audio asset per line with the right voices.
- [ ] Editing one line re-synthesises only that line.
- [ ] Generation refuses to start if any line has no voice.
- [ ] Seed script loads the voice catalog.

## Not in this phase

- Avatars (phase 08), word timings (phase 06).
