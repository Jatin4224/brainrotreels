# Phase 13: Quiz video maker

**Feature:** Feature 6
**Depends on:** phase 06

## Goal

A topic becomes a quiz video with question, countdown and reveal scenes.

## Build

- Topic -> Q&A JSON with the LLM (schema validated); also accept the user's own questions.
- `quiz` generator: for each question a scene with question, options, countdown and reveal, timed by word anchors.
- `QuizCard` component family with auto-shrink for long text.
- TTS with SSML: pauses for the countdown, phonetic overrides for acronyms.
- Quiz wizard UI: topic or manual questions -> edit Q&A -> voice and style -> generate.

## Data

- Quiz content lives in `projects.settings` and the timeline; no new tables.

## Done when

- [ ] A topic produces a renderable quiz of N questions with correct answers revealed after the countdown.
- [ ] A very long question still fits inside the safe zone.
- [ ] An acronym with a phonetic override is pronounced as specified.

## Not in this phase

- Editor features.
