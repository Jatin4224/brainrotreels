> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 01 — Foundations and infrastructure

## Goal
A deployable, empty monorepo with database, storage, CI and environment management working end to end.

## Depends on
Nothing.

## Deliverables
- pnpm + Turborepo monorepo with the layout in `00-README.md`
- Next.js app (App Router, TypeScript, Tailwind, shadcn/ui) deployed on Vercel
- Neon Postgres connected via Drizzle, with migrations running in CI
- Cloudflare R2 bucket with a signed-upload helper
- Health check page proving database and storage connectivity

## Steps
1. Create the monorepo and workspaces; set strict TypeScript, ESLint, Prettier.
2. Scaffold `apps/web` with Tailwind and shadcn/ui; add a basic layout shell.
3. Create `packages/db`: Drizzle config, `users` table only for now, `drizzle-kit` migrate script.
4. Set up Neon: production branch plus a development branch; connect the Vercel integration so each preview deploy gets its own branch.
5. Create `packages/core` with an env loader that validates all variables with Zod at startup and fails loudly.
6. Add R2: bucket, lifecycle rule deleting `tmp/` after 24 hours, and helpers `putObject`, `signedGetUrl`, `signedPutUrl`.
7. GitHub Actions: typecheck, lint, test, and `drizzle-kit migrate` before deploy.
8. Add `/api/health` returning database round-trip time and an R2 write/read check.

## Contracts
```
DATABASE_URL, DATABASE_URL_UNPOOLED
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
```
Storage key convention (use everywhere later):
```
users/{userId}/projects/{projectId}/{audio|footage|renders}/...
library/{backgrounds|music|sfx|avatars}/...
tmp/{jobId}/...
```

## Acceptance criteria
- `pnpm dev` runs the app locally against the Neon dev branch.
- Pushing to `main` deploys to Vercel with migrations applied first.
- `/api/health` returns success for both database and R2.
- Missing environment variables fail the build with a named error.

## Out of scope
Auth, UI design, any business logic.
