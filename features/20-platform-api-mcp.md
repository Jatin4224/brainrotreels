> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 20 — AI footage, public API and MCP

## Goal
Open the platform: prompt-to-video footage, a public REST API, and an MCP server so AI agents can use the product.

## Depends on
Phases 05, 09, 17.

## Deliverables
- `footage.generate` workflow and AI footage studio
- `/api/v1` with API keys and quotas
- `/api/mcp` MCP server
- OpenAPI document and developer settings page

## Steps
### AI footage
1. Video model adapter in `packages/providers/video`: `generate({ prompt, durationSec, aspect }) -> jobId`, `poll(jobId)`.
2. `footage.generate` workflow: moderate prompt → call model → poll with sleep steps → store the clip as an `ai_footage` asset → notify the UI.
3. Store `promptText`, `modelVersion` and `createdAt` on the asset for auditing.
4. `/app/footage` studio: prompt box with examples, duration and aspect controls, cost on the button, results grid, regenerate, insert into project.
5. Meter footage separately: it is the most expensive operation in the product.

### Public API
6. API keys via the Better Auth API key plugin: hashed storage, visible prefix, per-key daily quota in Redis, last-used tracking, revoke.
7. `/api/v1` routes: `POST /projects`, `POST /scripts`, `POST /projects/:id/voices`, `POST /renders`, `GET /renders/:id`, `GET /outputs/:id` (signed expiring URL), `GET /catalog/*`.
8. Conventions: `{ data, requestId }` or `{ error: { code, message }, requestId }`, `Idempotency-Key` on POSTs, cursor pagination, standard status codes including 429.
9. Reuse the exact handlers the web app uses; entitlements and credits apply identically.
10. Publish an OpenAPI 3.1 document and a docs page.

### MCP
11. `/api/mcp` exposing tools: `create_project`, `generate_script`, `assign_voices`, `list_backgrounds`, `start_render`, `get_render`, `fetch_output`.
12. Tool results return structured JSON plus a one-line human summary. Client disconnects never cancel server-side work.
13. Developer settings page: keys, quota usage, MCP endpoint with copy-paste config for Claude and Cursor, link to docs.
14. Share quotas and concurrency per user across web, API and MCP so one surface cannot starve another.

## Acceptance criteria
- An API key can create a project, generate a script, render, and download the output.
- Unauthorised requests return 401; over-quota requests return 429 with a reset hint.
- An MCP client connects, lists tools and completes a generation end to end.
- A revoked key stops working immediately.

## Out of scope
Webhooks for customers, team API keys, SDK packages.
