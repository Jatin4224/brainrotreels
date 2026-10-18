> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 08 — Script generator

## Goal
Turn an idea, a URL, a PDF or raw text into a structured, editable script of hook, body and CTA blocks.

## Depends on
Phases 01, 02.

## Deliverables
- `script_blocks` table
- LLM adapter plus URL and PDF extraction
- Script editor UI with per-block regeneration

## Steps
1. `script_blocks(id, projectId, position, sectionType, narrationText, durationEstimate, speakerTag)` with `sectionType` ∈ `hook | body | cta`.
2. Input normalisation: URL → readable article text; PDF → text with headers/footers stripped; raw text passes through. Cap input length and store `sourceText` on the project.
3. LLM adapter: `generateScript({ sourceText, kind, targetSeconds, tone })` returning strict JSON validated with Zod; retry once with the validation error appended.
4. Pacing: estimate duration at ~2.5 spoken words per second; warn above 60 seconds.
5. `regenerateBlock(blockId, instruction?)` rewrites one block only, preserving the others.
6. Treat all extracted text as untrusted data: never let it act as instructions to the model.
7. UI: blocks grouped by section, inline editing, drag to reorder, add/delete, per-block regenerate, running total duration.

## Contracts
```json
{ "title": "...", "blocks": [ { "sectionType": "hook", "narrationText": "...", "speakerTag": "A" } ] }
```

## Acceptance criteria
- A topic, a news URL and a 10-page PDF each produce a valid script.
- A paywalled or dead URL produces a clear error offering raw-text entry.
- Regenerating the hook leaves every other block untouched.
- Malformed model output never reaches the database.

## Out of scope
Dialogue scripts (Phase 15), quiz question generation (Phase 16).
