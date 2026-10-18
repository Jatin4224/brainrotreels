# Phase 17 — Platform surface

**Depends on:** Phases 10, 14.

## Goal

Open the platform three ways: prompt-to-video footage, a public REST API, and an MCP server so
agents can use the product. All three share quotas, entitlements and handlers with the web app, so
behaviour cannot drift between them.

## Registry

```ts
aiFootage: {
  name: 'AI footage',
  description: 'Generated video clips per month',
  limit: {
    perPlan: { free: 0, starter: 0, pro: 20, enterprise: 'unlimited', portal: 'unlimited' },
    upgradeMessage: 'Upgrade to {nextPlan} to generate video footage',
    availableOnFreeTrial: false,
    unit: 'clips',
  },
  nav: { label: 'AI footage', href: '/dashboard/footage', icon: 'Folder', section: 'main', requireFlag: false },
}

apiAccess: {
  name: 'API access',
  flag: {
    perPlan: { free: false, starter: false, pro: true, enterprise: true, portal: true },
    availableOnFreeTrial: false,
  },
}

apiKeys: {
  name: 'API keys',
  permissions: ['create', 'read', 'delete'],
  nav: { label: 'Developers', href: '/dashboard/settings/developers', icon: 'Settings', section: 'settings', requireFlag: false },
  audit: {
    describe: { create: 'Created API key {output.prefix}', delete: 'Revoked API key {input.id}' },
  },
  rateLimit: { create: { count: 5, window: '1 h' } },
}
```

`apiCalls` already exists in the registry as a declared quota with no producer. This phase is its
producer — do not add a second one.

## Data

```prisma
model ApiKey {
  id             String    @id @default(cuid())
  organizationId String
  createdByUserId String
  name           String
  prefix         String    // shown in the UI, e.g. "sk_live_a1b2"
  hash           String    @unique
  dailyQuota     Int       @default(1000)
  lastUsedAt     DateTime?
  revokedAt      DateTime?
  createdAt      DateTime  @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([prefix])
  @@map("api_key")
}
```

**Recommendation: an app-owned `ApiKey` model, not the Better Auth apiKey plugin.** Three reasons.
The plugin list in `src/lib/better-auth/auth.ts` has a documented mandatory order (`admin` before
`organization`, `nextCookies()` last) and adding a plugin is a real regression risk for a feature
that needs none of Better Auth's session machinery. Keys here are scoped to an **organization**,
not a user, which is not the plugin's model. And `docs/09-providers-and-adapters.md` is explicit
that per-tenant concerns stay app-owned so a provider switch cannot take them hostage — the same
argument that keeps roles in `OrganizationRole`.

## Build

### AI footage

1. **The video-model adapter.** `src/lib/adapters/video/` with `generate({ prompt, durationSec,
   aspect })` returning a job id, and `poll(jobId)`. Ship fal.ai or Replicate. **Confirm the chosen
   model's terms permit commercial use before building on it** — ask the owner, do not assume.
2. **The `footage.generate` workflow.** Moderate the prompt → call the model → poll in **separate
   steps** with sleeps between → store the clip through `asset.ingest` → notify. Polling inside one
   step times out.
3. **Moderate before the model call**, specifically for trademarks and real people. This is the
   most expensive operation in the product and the most legally exposed; the check is not optional
   and it fails closed.
4. **Audit trail.** Store `promptText`, `modelVersion` and `createdAt` on the asset — the columns
   exist from Phase 02.
5. **Meter separately** with its own hold and price, per Phase 05.
6. **`/dashboard/footage`** — prompt box with examples, duration and aspect controls, cost on the
   button, results grid, regenerate, insert into project.
7. **Fall back** to a stock clip or the styled background when generation fails, so a failure
   degrades the video rather than the job.

### Public REST API

8. **Keys**: generate, show once, store hashed with a visible prefix, track `lastUsedAt`, revoke.
   A revoked key stops working immediately — check `revokedAt` on every request, do not cache the
   lookup past a few seconds.
9. **`/api/v1` routes**: `POST /projects`, `POST /scripts`, `POST /projects/:id/voices`,
   `POST /renders`, `GET /renders/:id`, `GET /outputs/:id` (signed expiring URL),
   `GET /catalog/{voices,backgrounds,caption-styles}`.
10. **Share the handlers, genuinely.** The tRPC routers are already thin — business logic sits in
    the handler body, and the gates live in the procedure builder. Extract each operation into a
    plain async function in `src/lib/api/operations/` taking an explicit
    `{ organizationId, plan, db }` context; the tRPC router and the REST route both call it. The
    REST layer's only extra job is translating a Bearer key into that context and applying the same
    `checkFeatureGate` / credit calls the procedure builder would have applied. **If the REST route
    reimplements a rule, the surfaces have already drifted.**
11. **Conventions**: `{ data, requestId }` or `{ error: { code, message }, requestId }`,
    `Idempotency-Key` on POSTs, cursor pagination, and the standard codes including 429 with a
    reset hint.
12. **Quotas shared per organization**, in Redis, across web, REST and MCP. `architecture.md` lists
    surface-local quotas as a weak point precisely because a user's own API key starving their own
    UI jobs is an infuriating bug to diagnose.
13. **OpenAPI 3.1 document** and a docs page, generated from the Zod schemas rather than hand-typed.

### MCP

14. **`/api/mcp`** exposing `create_project`, `generate_script`, `assign_voices`,
    `list_backgrounds`, `start_render`, `get_render`, `fetch_output` — calling the same operation
    functions as REST.
15. **Results are structured JSON plus a one-line human summary.** An agent needs the data; the
    person watching the agent needs the sentence.
16. **Client disconnects never cancel server-side work**, because the work lives in Inngest. Say so
    in the tool descriptions so an agent does not retry a render it already started.
17. **Developer settings page**: keys with usage, quota consumption, the MCP endpoint with
    copy-paste config for Claude and Cursor, and a link to the docs.

## Contracts

```ts
export interface VideoAdapter {
  generate(args: { prompt: string; durationSec: number; aspect: '9:16' }): Promise<{ jobId: string }>
  poll(jobId: string): Promise<{ status: 'pending' | 'completed' | 'failed'; url?: string; modelVersion?: string }>
}

// src/lib/api/operations/ — the shared seam
export interface OperationContext {
  organizationId: string
  plan: PlanKey
  userId: string | null      // null for key-authenticated calls
  db: DbClient
  requestId: string
}
export async function createProjectOperation(ctx: OperationContext, input: CreateProjectInput): Promise<Project>
```

## Done when

- [ ] A prompt yields a clip in the library with a vertical variant and a proxy.
- [ ] A prompt naming a real person or a brand is blocked before the model is called.
- [ ] A failed footage generation releases its hold.
- [ ] Closing the browser does not cancel a footage job.
- [ ] An API key alone can create a project, generate a script, assign voices, render and download
      the MP4.
- [ ] The same flow completes from an MCP client.
- [ ] Repeating a POST with the same `Idempotency-Key` does not create a second render.
- [ ] Exceeding the daily quota returns 429 with a reset hint.
- [ ] A revoked key stops working immediately.
- [ ] A plan without API access gets a clear, specific 403.
- [ ] Burning the API quota does not block the same workspace's UI jobs beyond the shared cap —
      and the shared cap is the intended behaviour, not a bug.
- [ ] A rule changed in an operation function changes behaviour on web, REST and MCP at once.

## Not in this phase

Customer-facing webhooks, team API keys, published SDK packages, long-form video generation.
