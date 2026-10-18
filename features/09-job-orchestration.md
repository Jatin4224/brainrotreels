> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 09 — Job orchestration (Inngest)

## Goal
A durable, resumable generation pipeline with live progress, cancellation and automatic cleanup.

## Depends on
Phases 05, 06, 07, 08.

## Deliverables
- Inngest set up with the serve route and the dev server
- `project.generate`, `asset.ingest`, `line.resynth` workflows
- `pipeline_stages` table driving a progress UI

## Steps
1. Install the Inngest SDK; add `apps/web/app/api/inngest/route.ts` and an Inngest client in `apps/web/inngest/client.ts`.
2. `pipeline_stages(id, projectId, stage, status, startedAt, finishedAt, error)` with unique `(projectId, stage)`.
3. `project.generate` steps: `moderate` (stub until Phase 17) → `script` → `validate-voices` → `tts` (fan-out per line) → `align` → `build-timeline` → `save`. Each step writes its stage row.
4. Configure: `concurrency` keyed by `userId` (limit 2), `retries: 3`, `cancelOn` a `project/cancelled` event, and `onFailure` marking the project failed (credit release arrives in Phase 11).
5. `asset.ingest`: move the Phase 05 inline processing here (probe → transcode → proxy → thumb → ready).
6. `line.resynth`: regenerate one line's audio, re-align, patch the timeline document.
7. Keep step payloads small: return IDs, never documents or audio.
8. Idempotency: every enqueue carries a key of `projectId + docHash` or `lineId + textHash`.
9. Progress API: `GET /api/projects/:id/stages`, polled by the UI every 2 seconds.

## Contracts
```ts
inngest.send({ name: "project/requested", data: { projectId, userId, plan } })
```
Stage names (fixed): `moderate, script, voices, tts, align, visuals, storyboard, design, qa, timeline, render, finalize`.

## Acceptance criteria
- Killing the dev server mid-run and restarting resumes without repeating completed steps.
- Cancelling sets the project to `cancelled` and stops further steps.
- Two rapid identical generate requests produce exactly one run.
- Every stage transition is visible through the progress endpoint.

## Out of scope
Cloud rendering (Phase 10), credits (Phase 11).
