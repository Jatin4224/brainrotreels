# Build plan — index and conventions

This is the **authoritative build order** for the short-form video studio, written against the
code that actually exists in this repository.

> **If you read only one thing, read "Translation table" below.** Three older planning documents
> (`architecture.md` before this revision, `features/*.md`, and the previous `docs/phases/*`)
> described a pnpm + Turborepo monorepo on Drizzle with REST route handlers. **That app does not
> exist and is not being built.** This repository is a single Next.js 16 app on Prisma + tRPC, and
> every phase below is expressed in its vocabulary.

`features/00-20*.md` is retained as the **product-intent reference** — what each format should do,
and why. It is not a build order and its stack claims are superseded by this file.

## Read before your first phase

1. `docs/01-architecture.md` — the registry + procedure-builder model
2. `docs/02-the-registry.md` — `src/lib/resources.ts`, the file that wires everything
3. `docs/03-procedures-and-routers.md` — where your code goes
4. `docs/07-adding-a-feature.md` — a full end-to-end feature
5. `architecture.md` — the video system design, in this codebase's terms

## Translation table

Every row is a thing the old plans named and the thing you actually write.

| Old plan said | In this codebase |
| --- | --- |
| `packages/timeline` | `src/lib/timeline/` |
| `packages/providers` | `src/lib/adapters/<kind>/` behind an interface in `src/lib/adapters/types.ts` |
| `packages/db` + Drizzle | `prisma/schema.prisma` + `@/generated/prisma` |
| `packages/core` entitlements | `src/lib/resources.ts` (the registry) + `src/lib/feature-gate.ts` |
| `packages/credits` | `src/lib/credits/` + `src/services/credits.service.ts` |
| `packages/ui` | `src/components/global/<folder>/` |
| `apps/web/app/api/*` REST routes | tRPC procedures in `src/trpc/routers/*` |
| `can(user, feature)` | **Nothing.** Declare `limit`/`flag` on the registry entry; the gate is automatic |
| "every query filters by `userId`" | every query filters by `organizationId` |
| Better Auth `getSessionUser()` | `getServerSession()` (`src/lib/adapters/session.ts`) |
| `middleware.ts` | `src/proxy.ts` — **never create `middleware.ts`**, Next 16 will not read it |
| Vitest unit tests | no test runner is installed; see "Testing" below |

## Decisions already made

These were settled before the plan was written. Do not relitigate them inside a phase.

**Tenancy — orgs are a personal workspace.** The boilerplate scopes every protected procedure to an
`Organization` and there is no cheap way out: `protectedProcedure` extracts `organizationId` from the
input, checks membership, and resolves plan tier per org. So **every signup gets exactly one
auto-created organization** and the UI never says the word "organization". Projects, assets, renders
and credits all hang off `organizationId`. Team/agency plans then cost nothing to add later.

**Credits sit beside usage counters, not inside them.** `UsageMetrics` stays for countable things
(projects, renders per month) because the registry wires those for free. Money-shaped work gets a new
append-only `CreditLedger`, because a render's true cost is unknown until it finishes and a counter
cannot express a hold or a refund. `ERROR_CODES.INSUFFICIENT_CREDITS` and its `StructuredErrorCause`
variant **already exist** in `src/lib/errors/index.ts` with zero producers — the client contract is
built; wire to it rather than inventing a code.

**Inngest for durable work.** Reached through an adapter, like every other provider.

**Prisma `String` columns, not Prisma enums.** The schema has zero `enum` blocks today; enum-like
values are strings validated in TypeScript. Match that.

## The one rule that will bite you

`protectedProcedure` resolves `<resource>.<verb>` from the procedure path and **throws at runtime**
if a *mutation*'s first path segment is not a key in `RESOURCES` and it declares none of
`audit` / `requirePermission` / `requireRole` (`src/trpc/procedures/protected.ts:415-426`).

So the order is always: **registry entry first, router second.** Not the reverse.

## Phases

Ship to public beta at the end of Phase 10. Everything after is additive.

| # | Phase | Ships |
| --- | --- | --- |
| 00 | Foundations and seams | Personal workspaces, Inngest, R2, DataTable, provider seam |
| 01 | Timeline document | `src/lib/timeline/` — the core contract |
| 02 | Media assets and storage | Upload, ingest job, variants, signed URLs |
| 03 | Render core | Remotion composition, preview player |
| 04 | Cloud rendering | Lambda, webhook, render reuse by `docHash` |
| 05 | Credits and entitlements | Ledger, hold/commit/release, plan gates |
| 06 | Script generation | LLM adapter, idea/URL/PDF to blocks |
| 07 | Voices and TTS | Catalog, per-line synthesis, caching |
| 08 | Alignment and captions | Word timings, 30+ styles |
| 09 | The generate pipeline | Inngest orchestration + live progress over SSE |
| 10 | Safety, limits, launch | Moderation, rate limits, observability — **public beta** |
| 11 | Backgrounds library | Curated loops, uploads, tier gating |
| 12 | Reddit story format | First complete format |
| 13 | Quiz format | Second format |
| 14 | Voiceover visuals | Stock and generated imagery per block |
| 15 | Timeline editor | Manual editing, revision conflicts |
| 16 | Motion graphics studio | Scene engine, then AI designer |
| 17 | Platform surface | AI footage, public API, MCP |

Phase files are `NN-<slug>.md`. Each has: Goal · Depends on · Registry · Data · Build · Done when ·
Not in this phase. Tick it in `PROGRESS.md` when the checks pass.

## House conventions every phase must follow

**Every file opens with the licence block, then a doc comment:**

```ts
/**
 * SOURCE OF TRUTH KEYWORDS: Symbol1, Symbol2, TypeA (~10 keywords)
 *
 * WHAT:  One sentence on inputs and outputs.
 * WHY:   The gotcha or constraint. Skip when trivial.
 * WHERE: Who calls this and what it calls.
 */
```

**Grep with `-l` before creating anything.** Most types already exist.

**Types** resolve in this order: Prisma (`@/generated/prisma`) → adapter contracts
(`@/lib/adapters`) → existing `src/lib/types/*` → only then write a new one, in `src/lib/types/`
and nowhere else. Banned: `any`, `as Foo`, `!`, `@ts-ignore`. The tsconfig has
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature`
(that last one is why env reads are `process.env['KEY']`).

**Services** are pure Prisma — one verb, one table, no auth, no audit, no transactions. First
statement is `import 'server-only'` (eslint enforces it). Import them by **named import from the
explicit path**: `import { listProjects } from '@/services/projects.service'`. There is no barrel
and no `import * as` anywhere in this codebase — `.claude/CLAUDE.md` says otherwise and the code
wins.

**Business logic lives in the router handler**, not the service. Write through `ctx.db` so it
commits with the audit row.

**Never, in a handler:** open a transaction (you are in one), call `logActivity`, call
`incrementUsage` on a `.create` path, or compare `ctx.memberRole` to a string — branch on
`ctx.memberHasFullAccess`.

**Forms:** Zod schema in `src/lib/types/*` → `useForm({ resolver: zodResolver(schema), mode:
'onTouched' })` → shadcn `Form/FormField/FormItem/FormControl/FormMessage` → tRPC mutation →
`utils.*.invalidate()`. Errors render into local state, never thrown.

**UI:** the app is **dark-only** (`forcedTheme="dark"`). Primitives are **Base UI, not Radix** — use
`render={<Link/>}`, never `asChild`. Theme tokens only; `--success` is the app's only green. Page
chrome is `<ContentLayout title actions width>`; settings blocks are `<SettingsSection>`.

**Long work never runs in a procedure.** Mutations execute inside a 10-second Prisma transaction.
Enqueue an Inngest event and return; never await a provider call that can exceed a second or two.

## Testing

**No test runner is installed.** The old plans assumed Vitest and "25 unit tests". Phase 00 installs
Vitest and wires `npm test` into CI; phases that say "unit tests" depend on that. If Phase 00 has
not landed, a phase's test criteria are deferred, not skipped — say so in `PROGRESS.md`.

## The repo does not run as shipped

Verified, not assumed. Before Phase 00 there is no `node_modules`, no `.env`, no generated Prisma
client, no `prisma/migrations/`, no `.git/` and no CI. `npm install`'s postinstall step **fails**,
because `prisma.config.ts` declares `datasource: { url: env("DATABASE_URL") }` and `prisma generate`
needs that variable set — though not a reachable database.

The good news, also verified: with dependencies installed and the client generated,
**`tsc --noEmit` passes clean.** The codebase itself is sound; everything blocking is setup.

This is **npm**, not pnpm — there is a `package-lock.json`, no pnpm lockfile and no workspace file.

## Known drift in the existing docs

Found while mapping the code. Do not propagate these.

- `docs/06-audit-and-rate-limit.md` and the header of `src/lib/rate-limit.ts` claim rate limiting
  runs at proxy ingress. **It does not** — `src/proxy.ts` only stamps headers and bounces `/sign-up`.
  Limiting happens in `baseProcedure` and in the auth route handler.
- **No `RESOURCES` entry declares `rateLimit`.** The mechanism works; nothing uses it yet.
- **There is no Zod env schema**, despite `agents.md` having required one.
  `src/lib/config/required-env.ts` is a presence-only checklist. Phase 00 fixes this.
- **The Stripe webhook has no event-ID dedupe table.** Replay safety is incidental (upsert by
  subscription id), and trial-fingerprint marking re-runs on replay. Phase 05 fixes this.
- `UsageMetrics.lastResetAt` exists but **nothing resets it** — monthly quotas do not actually roll.
  Phase 00 adds the cron.
- There is **no table component and no `src/components/ui/table.tsx`**. Pagination is hand-rolled
  twice already. Phase 00 builds the real one — and note neither existing screen renders a `<table>`
  at all, so that migration is a visual redesign, not a refactor.
- **`User.onboardingComplete` is written twice and read nowhere.** The real onboarding gate is
  "has ≥1 membership".
- **Six `ERROR_CODES` are declared and never thrown**: `INSUFFICIENT_CREDITS`, `VALIDATION_ERROR`,
  `PENDING_INVITATION`, `INVITATION_NOT_FOUND`, `INVITATION_ALREADY_USED`, `INVITATION_EXPIRED`.
  `PENDING_INVITATION` is the most misleading — it carries a full payload and looks load-bearing
  for invitation acceptance. It is not; that flow throws plain `TRPCError`s.
- **2FA is half-installed.** The `twoFactor` plugin is enabled on both server and client and the
  Prisma model exists, but there is **no 2FA UI anywhere** — no enrolment, no QR, no challenge.
  `lastLoginMethod` is likewise enabled and never read.
- **`src/lib/config/plans.ts` reads `NEXT_PUBLIC_*` through a computed key**, which Next does not
  inline. Every env-driven plan name, description and trial length silently falls back to its
  default **in the browser** while being correct on the server. Phase 00 fixes it.
- **`tsconfig.json` and `next.config.ts` disagree** on what `@providers-active` resolves to
  (`active.tsx` vs `active.better-auth.tsx`).
