# Phase 04: AI script generator

**Feature:** Feature 1
**Depends on:** phase 00

## Goal

A user gives a prompt, a URL or a PDF and gets an editable script split into hook, body and CTA blocks.

## Build

- `packages/providers`: one interface per provider type; implement the LLM adapter (Claude) with retries, timeouts and JSON-schema validated output.
- `packages/script`: `generate(input)` returns `{hook, body[], cta}` blocks with duration estimates; `regenerateBlock(id)` rewrites one block only.
- Ingestion: URL text extraction and PDF parsing. Validate URLs against an allowlist of schemes and block private address ranges (SSRF).
- Treat extracted text as data, never instructions: wrap it in delimiters and say so in the system prompt.
- Text moderation step before the LLM call.
- Script editor UI: create project, edit blocks, reorder, regenerate one block, see total estimated duration.
- Internal API routes for projects and script blocks.

## Data

- `script_blocks` (id, project_id, position, section_type, narration_text, duration_estimate, speaker_tag).

## Done when

- [ ] Prompt, URL and PDF inputs each produce a valid script.
- [ ] A URL pointing at localhost or a private IP is rejected.
- [ ] Regenerating one block leaves the others byte-identical.
- [ ] LLM output that fails the schema is retried once with the validation error, then the step fails cleanly.

## Not in this phase

- Voices, audio, video.
