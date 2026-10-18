# Phase 09 — The generate pipeline

**Depends on:** Phases 05, 06, 07, 08.

## Goal

One click turns a prompt into a previewable video. The `project.generate` workflow runs end to end
for the simplest kind — `voiceover` over a styled background — and the user watches it happen live.

## Registry

None new. `projects` and `renders` already carry the gates; this phase adds a daily cap:

```ts
projects: {
  // ... existing entry ...
  rateLimit: {
    generate: { count: 30, window: '1 h' },
  },
}
```

## Data

```prisma
model PipelineStage {
  id         String    @id @default(cuid())
  projectId  String
  stage      String
  status     String    @default("pending") // pending | running | completed | failed | skipped
  error      String?
  startedAt  DateTime?
  finishedAt DateTime?

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, stage])
  @@index([projectId])
  @@map("pipeline_stage")
}
```

**Stage names are fixed.** Adding one means adding it here and to the UI's ordered list:

```
moderate, script, voices, tts, align, visuals, storyboard, design, qa, timeline, render, finalize
```

A kind that skips a stage writes it as `skipped`, never omits it — the progress UI renders a stable
list rather than one that reshuffles as it runs.

## Build

1. **`src/lib/generators/`** with the contract `build(ctx): Promise<TimelineDoc>` and a registry
   mapping `Project.kind` to its module. The first generator is `voiceover`: styled background,
   narration track, music with ducking driven by word timings, caption track.
2. **The workflow.** `src/inngest/functions/project-generate.ts`, triggered by `project/requested`.
   Steps: `moderate` (stubbed until Phase 10) → `script` → `voices` validate → `tts` fan-out →
   `align` → kind-specific `build` → `timeline` save → `estimate`. Each step writes its
   `PipelineStage` row on entry and exit.
3. **Keep step payloads small.** Return ids, never documents or audio. A step that returns a
   timeline document will eventually exceed the payload limit on a long video, and the failure will
   look like something else.
4. **Controls.** Per-organization concurrency of 2 generations, `cancelOn` a `project/cancelled`
   event, `retries: 3` with exponential backoff on provider calls, and `onFailure` that marks the
   project `failed`, writes the failing stage, and **releases the credit hold**.
5. **Idempotency.** Every enqueue carries a key — `projectId + docHash` for generation,
   `lineId + textHash` for resynth. Two rapid identical requests must produce one run.
6. **Live progress is the first `.subscription()` procedure in this codebase.** The SSE transport is
   already fully configured and currently unused: `initTRPC` has the `sse` block with a 5-minute
   `maxDurationMs` and a 10s ping, the client has an `httpSubscriptionLink` behind a `splitLink`,
   and the route sets `maxDuration = 300` and `X-Accel-Buffering: no`. So this needs **no new
   infrastructure** — add `projects.progress` as a subscription yielding stage transitions.
7. **Fall back to polling.** Some clients and proxies will not hold a stream. Keep
   `projects.getStages` as a plain query and have the client fall back to a 2-second poll when the
   subscription drops. The REST API in Phase 17 uses the query, not the stream.
8. **Progress UI.** A vertical stage list with per-stage status and elapsed time, a thumbnail strip
   filling in, Cancel, "email me when done", and Retry on failure. Announce stage transitions to
   screen readers via an `aria-live` region — a progress UI that only communicates by colour is
   unusable for part of the audience.
9. **Failure is explained, not dumped.** A failed project shows the failing stage, a plain-language
   cause, "credits refunded", and Retry. Never surface a provider stack trace.
10. **Re-check ownership inside the workflow.** It runs outside `protectedProcedure` and gets none
    of its gates. Load the project by `(id, organizationId)`, never by id alone.

## Contracts

```ts
export interface Generator {
  kind: ProjectKind
  build(ctx: GeneratorContext): Promise<TimelineDoc>
}
export interface GeneratorContext {
  organizationId: string
  projectId: string
  words: Word[]
  lines: NarrationLine[]
  settings: Record<string, unknown>
  db: DbClient
}

// src/trpc/routers/projects.ts
progress: protectedProcedure({ ... })
  .input(z.object({ organizationId: z.string().min(1), projectId: z.string().min(1) }))
  .subscription(async function* ({ ctx, input }) { /* yields StageUpdate */ })
```

## Done when

- [ ] From a prompt, the app produces a narrated, captioned vertical video that previews and renders.
- [ ] Killing the dev server mid-run and restarting resumes from the failed step, not from the start.
- [ ] Cancelling stops the run, marks the project `cancelled`, and releases the hold.
- [ ] Two rapid identical generate requests produce exactly one run.
- [ ] Every stage transition appears in the UI without a page refresh, over SSE.
- [ ] Killing the subscription falls back to polling and the UI keeps updating.
- [ ] Closing the tab does not stop the job.
- [ ] With STT disabled the video still completes with degraded captions and a visible warning.
- [ ] A screen reader announces each stage transition.

## Not in this phase

Real moderation (Phase 10). Backgrounds beyond a styled solid (Phase 11). Other formats.
