> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 10 — Cloud rendering (Remotion Lambda)

## Goal
Render documents in the cloud, wait for completion by webhook, and store outputs as assets.

## Depends on
Phases 04, 09.

## Deliverables
- Deployed Remotion Lambda function and versioned site
- `renders` table and render workflow
- Webhook route resuming the waiting workflow

## Steps
1. Deploy the Lambda function and a site from `packages/video`; store `REMOTION_SITE_VERSION` in env so deploys are reversible.
2. `renders(id, projectId, providerRenderId, docHash, status, progress, outputAssetId, posterAssetId, creditsCharged, costBreakdown)`; unique `(projectId, docHash)` and unique `providerRenderId`.
3. Render adapter in `packages/providers/render`: `start(doc, opts) -> { renderId }`, `getProgress(renderId)`. Keep it an interface so a self-hosted renderer can replace Lambda later.
4. Pre-resolve every asset to a signed URL and ensure media is in R2 before starting the render.
5. `project.render` workflow: `validate` → `resolve-assets` → `start-render` → `waitForEvent('remotion/render.finished', timeout 45m)` → `finalize`.
6. `POST /api/webhooks/remotion`: verify the signature, store the output and poster as `render_output` assets, then send `remotion/render.finished` with the `renderId`.
7. On timeout or failure: mark the render failed, keep the error, allow one retry with a fresh render ID.
8. Reuse: if a render already exists for the same `docHash` and succeeded, return it instead of rendering again.

## Acceptance criteria
- A 60-second project renders in the cloud and the workflow completes without polling.
- Re-rendering an unchanged project returns the existing output instantly.
- A deliberately broken composition fails cleanly with a stored error, not a hung workflow.
- Deploying a new site version does not break renders already in flight.

## Out of scope
Draft/preview renders, watermarks (Phase 11).
