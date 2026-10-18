# Phase 04 — Cloud rendering

**Depends on:** Phases 02, 03.

## Goal

Render in the cloud at scale, wait for completion by webhook rather than polling, and store outputs
as assets. Re-rendering an unchanged timeline costs nothing.

## Registry

```ts
renders: {
  name: 'Renders',
  description: 'Videos rendered per month',
  permissions: ['create', 'read'],
  limit: {
    perPlan: { free: 5, starter: 100, pro: 1000, enterprise: 'unlimited', portal: 'unlimited' },
    upgradeMessage: 'Upgrade to {nextPlan} to render more videos each month',
    availableOnFreeTrial: true,
    unit: 'renders',
  },
  audit: {
    describe: { create: 'Started a render for project {input.projectId}' },
  },
}

watermarkFree: {
  name: 'Watermark-free export',
  flag: {
    perPlan: { free: false, starter: true, pro: true, enterprise: true, portal: true },
    availableOnFreeTrial: false,
  },
}
```

`renders` is periodic — register it with the Phase 00 `usage.reset` cron so the monthly window
actually rolls.

## Data

```prisma
model Render {
  id               String   @id @default(cuid())
  organizationId   String
  projectId        String
  providerRenderId String?  @unique
  docHash          String
  status           String   @default("queued") // queued | rendering | completed | failed | timedOut
  progress         Float    @default(0)
  outputAssetId    String?
  posterAssetId    String?
  creditsCharged   Int?     // populated in Phase 05
  costBreakdown    Json?
  error            String?
  startedAt        DateTime?
  finishedAt       DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  project      Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, docHash])
  @@index([organizationId])
  @@index([projectId])
  @@map("render")
}
```

The `@@unique([projectId, docHash])` is what makes render reuse correct rather than best-effort.

## Build

1. **The render adapter.** `src/lib/adapters/render/` with `start(doc, opts)` and
   `getProgress(renderId)`, plus a Remotion Lambda implementation. Keep it an interface so a
   self-hosted renderer can replace Lambda later without touching a workflow. Follow the isolation
   pattern from `docs/09-providers-and-adapters.md` and add the eslint restriction.
2. **Deploy** the Lambda function and a versioned site from `src/remotion/`. Store
   `REMOTION_SITE_VERSION` in the env schema so a deploy is reversible and renders already in flight
   keep working against the version they started on.
3. **`renders.create`** — a `protectedProcedure` that validates the document, computes `docHash`,
   returns the existing completed render if one matches, and otherwise creates the row and sends
   `render/requested`. It does **not** start the render; it returns immediately. Mutations run
   inside a 10-second transaction.
4. **The `project.render` workflow** — `src/inngest/functions/project-render.ts`. Steps:
   `validate` → `resolve-assets` → `start-render` → `waitForEvent('remotion/render.finished',
   { timeout: '45m' })` → `finalize`. The render is started in one step and awaited in another;
   a step that blocks for ten minutes times out.
5. **Pre-resolve every asset** to a signed URL with a TTL longer than the render timeout, and
   confirm the media is actually in R2, before starting. A render that fails forty minutes in
   because an asset was missing is the expensive failure mode.
6. **The webhook.** `src/app/api/webhooks/remotion/route.ts`, `runtime = 'nodejs'`, verifying the
   signature before anything else. It stores the MP4 and poster as `render_output` assets, then
   sends `remotion/render.finished` carrying the `renderId`. Follow the Stripe webhook in
   `src/app/api/stripe/webhook/route.ts` for the signature and raw-body shape.
7. **Watermark by entitlement.** The composition reads a `watermark` prop; `finalize` sets it from
   `checkBooleanFeature(organizationId, 'watermarkFree')`. A generator must never decide this.
8. **Failure and timeout.** Mark the render `failed` or `timedOut`, keep the provider error, and
   allow exactly one retry with a fresh `providerRenderId` — the column is unique, so reuse would
   collide.
9. **Resolution by plan.** Download options are gated by entitlement; the UI shows locked options
   rather than hiding them, so the upgrade path is visible.
10. **Re-check ownership inside the workflow.** It runs outside `protectedProcedure` and inherits
    none of its gates.

## Contracts

```ts
export interface RenderAdapter {
  start(doc: TimelineDoc, opts: RenderOptions): Promise<{ providerRenderId: string }>
  getProgress(providerRenderId: string): Promise<{ status: RenderStatus; progress: number }>
}
export interface RenderOptions {
  assets: Record<string, string>
  watermark: boolean
  resolution: '720p' | '1080p'
  webhookUrl: string
}
```

## Done when

- [ ] A 60-second project renders on Lambda and the workflow completes without any polling step.
- [ ] Re-rendering an unchanged project returns the existing output immediately and creates no
      second `Render` row.
- [ ] A deliberately broken composition fails cleanly with a stored error, not a hung workflow.
- [ ] A render that exceeds the timeout is marked `timedOut` and can be retried once.
- [ ] Deploying a new site version does not break a render already in flight.
- [ ] A free workspace's output carries the watermark; a paid one does not.
- [ ] An unsigned or wrongly-signed webhook call is rejected.

## Not in this phase

Credits — `creditsCharged` and `costBreakdown` stay null until Phase 05. Draft and preview renders.
