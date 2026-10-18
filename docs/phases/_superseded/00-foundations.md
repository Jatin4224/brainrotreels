# Phase 00: Foundations

**Feature:** none (setup)
**Depends on:** nothing

## Goal

An empty but deployable app: sign-in works, the database migrates, a file can be put in R2, and a test Inngest function runs.

## Build

- Create a pnpm + Turborepo monorepo: `apps/web` (Next.js App Router, TypeScript strict) and `packages/*` (start with `db`, `config`).
- `packages/db`: Drizzle ORM on Neon Postgres, migration scripts, a single `db` client export.
- Better Auth at `/api/auth/*` with email sign-in; a `getSessionUser()` helper for server code.
- `packages/storage`: Cloudflare R2 client (S3 API) with `putObject`, `getSignedUrl(key, ttl)`, `deleteObject`.
- Inngest client and `/api/inngest` route with one `hello` function to prove the wiring.
- Upstash Redis client in `packages/config` (used later for quotas).
- `.env.example` listing every variable; env validation with Zod that fails fast at boot.
- CI (GitHub Actions): install, typecheck, lint, unit tests (Vitest).

## Data

- `users` (id, email, plan default 'free', credit_balance default 0) plus the tables Better Auth needs.

## Done when

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
- [ ] Signing up and signing in works locally; `/dashboard` shows the signed-in email and redirects when signed out.
- [ ] A script `pnpm smoke:r2` uploads and reads back a small file.
- [ ] The `hello` Inngest function runs from the Inngest dev server.

## Not in this phase

- Any video, script, voice or billing code.
