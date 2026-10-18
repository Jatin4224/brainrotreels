> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 02 — Auth and accounts

## Goal
Users can sign up, verify their email, log in with email or Google, and can only ever see their own data.

## Depends on
Phase 01.

## Deliverables
- Better Auth with the Drizzle adapter on Neon
- Email + password with required verification, password reset, Google OAuth
- Session-protected routes and a strict data-access layer
- Minimal account settings page

## Steps
1. Add Better Auth in `packages/auth`; generate its tables with the CLI and apply via Drizzle migrations.
2. Extend the user record with `plan` (default `free`) and `creditBalance` (default 0).
3. Mount the handler at `apps/web/app/api/auth/[...all]/route.ts`.
4. Enable email+password with `requireEmailVerification`, password reset, and Google OAuth.
5. Wire verification and reset emails through Resend (plain templates for now).
6. Keep Better Auth's rate limiting on; store counters in Upstash Redis.
7. Build `packages/db/access`: every exported function takes `userId` as its first argument. Add an ESLint rule or a code review note forbidding raw `db.select` in `apps/web`.
8. Add `requireSession()` for server components and `requireApiSession()` for route handlers, returning 401 JSON.
9. Pages: `/signup`, `/login`, `/verify`, `/reset`, `/app/settings` (name, email, password, verification status, delete account).

## Contracts
```ts
// every data access function
export async function getProject(userId: string, projectId: string): Promise<Project | null>
```
API error envelope used from here on:
```json
{ "error": { "code": "unauthorized", "message": "..." }, "requestId": "..." }
```

## Acceptance criteria
- A new user must verify their email before reaching `/app`.
- Google sign-in works in production with the exact configured callback URL.
- User A requesting User B's project receives 404 (not 403, to avoid leaking existence).
- Repeated failed logins are rate limited.
- `BETTER_AUTH_SECRET` of at least 32 characters is validated at startup.

## Out of scope
Billing, teams, two-factor, API keys (Phase 20).
