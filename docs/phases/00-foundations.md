# Phase 00 — Foundations and seams

**Depends on:** nothing.

## Goal

Put every seam in place that later phases plug into, and close the gaps the boilerplate docs claim
are already closed. Nothing video-specific ships here. At the end: the repo is under version
control with CI, the database has a migration baseline, a signup lands in a usable personal
workspace without losing the payment funnel, a job can run, a file can reach R2, and a list can be
rendered without hand-rolling pagination for a third time.

## Before you start — environment

The repo as shipped does not run. Four things, in order:

1. `npm install` — **note this is npm.** There is a `package-lock.json`, no `pnpm-lock.yaml`, and no
   workspace file. Any doc that says `pnpm` is wrong.
2. `cp .env.example .env` and fill `DATABASE_URL` and `BETTER_AUTH_SECRET`. Those two are the only
   hard requirements; everything else fails soft. **Use `.env`, not `.env.local`** —
   `prisma.config.ts` reads env through `dotenv/config`, which only loads `.env`, so a
   `.env.local` gives you a working `next dev` and a permanently broken `prisma migrate`.
3. `npx prisma generate` — **postinstall will have failed** without `DATABASE_URL`, because
   `prisma.config.ts` declares `datasource: { url: env("DATABASE_URL") }`. The variable must be
   set; a reachable database is not required for generate.
4. `npx prisma migrate dev --name init` — see the baseline note under **Data**.

## Registry

Two existing entries get a producer in later phases; leave them alone for now: `storage` (a byte
cap per plan, nothing writes it — Phase 02) and `apiCalls` (nothing writes it — Phase 17).

**Remove three entries that advertise features with no code behind them.** The pricing table and
upgrade modal are generated from the registry, so `customDomain` and `customBranding` currently
render as sellable paid-plan features that do not exist, and `integrations` mints permission
strings and owner grants for a router and page that were never built. Delete all three from
`src/lib/resources.ts`. Re-add when something is actually scheduled.

## Data

**There is no `prisma/migrations/` directory — the database has never been initialised.** Before
any schema change, create the baseline with `npx prisma migrate dev --name init`, which emits one
migration covering all existing models. Decide and record whether you are on migrations or
`db push`; the phase docs assume migrations.

On Neon, `migrate dev` needs shadow-database rights — typically a second branch or an explicit
`shadowDatabaseUrl`. Neither is configured. Sort that out at the same time.

Then one schema change:

```prisma
model Member {
  // ... existing fields ...
  @@unique([organizationId, userId])
}
```

Nothing creates duplicate members intentionally — all three `member.create` call sites are guarded.
But the guards are check-then-act with no constraint behind them, so `invitation.accept` can race
across two tabs and may already have produced duplicates in a dev database. The migration needs a
dedupe step before the constraint. Note also that Better Auth's own organization endpoints write
`member` rows through `prismaAdapter`, outside the guarded tRPC paths — the constraint protects
those too, but a previously-silent duplicate insert will now surface as a raw `P2002` from the auth
API.

`UsageMetrics.lastResetAt` already exists. It is never written **and never read**; see step 8.

## Build

1. **Version control and CI.** There is no `.git/` and no `.github/` — this is an unpacked archive.
   `git init`, commit the baseline, then author the workflow from scratch: install, `typecheck`,
   `lint`, `test`. Phase docs that say "add it to CI" mean "create CI".
2. **Fix the two pre-existing lint errors.** `npx eslint .` fails on redundant `as Route`
   assertions at `src/lib/config/auth-routes.ts:133` and `src/lib/config/portal.ts:46` — version
   drift, both auto-fixable. CI cannot be green until they are.
3. **Auto-create the personal workspace, and keep the funnel.** The current onboarding wizard
   (`src/app/(onboarding)/onboarding/_components/onboarding-flow.tsx:55`) is three steps — details,
   plan, payment — and it creates the organization on the **plan** step, then runs a real Stripe
   Elements card flow calling `billing.createSubscription`. It is the only place a new user can
   start a paid subscription, which `onboarding/page.tsx:45-51` flags as `ONBOARDING_IS_THE_ONLY_FUNNEL`.
   So this is two pieces of work, not one:
   - **Extract `ensurePersonalWorkspace(db, userId, name)`** into
     `src/services/organization.service.ts`. It must wrap `createOrganizationWithOwner` **and** the
     `onboardingComplete` write, because both currently live in the tRPC mutation
     (`src/trpc/routers/organization.ts:67-85`) and a server layout cannot call a mutation. Keep
     `createOrganizationWithOwner` itself untouched.
   - **Hook it in the dashboard layout**, at `src/app/(dashboard)/layout.tsx:57-62`. That is already
     the single place detecting zero memberships, it already excludes the portal owner at `:60`, it
     runs server-side with the adapter resolved, and it is provider-neutral. Do **not** use a Better
     Auth `databaseHooks.user.create.after`: `AuthAdapter` has no `onUserCreated` seam, so a second
     provider would silently never get a workspace; a throw there aborts signup; and it would fire
     for the portal owner, who must not get a tenant org.
   - On success fall through to the dashboard; on failure redirect to `/onboarding`, which stays
     reachable as the recovery path.
   - **Move plan selection to a post-signup step** — a dismissible plan/upgrade step on first
     dashboard visit or first generate, reusing the existing `PlanSelector` and
     `StripeElementsProvider` components unchanged. The wizard's step-2 and step-3 code is the
     source material; do not delete it.
4. **Know what the real onboarding gate is.** `User.onboardingComplete` is written in two places
   and **read in none**. The actual gate is "has ≥1 membership", enforced at
   `src/app/(dashboard)/layout.tsx:57` and by `protectedProcedure` throwing `ONBOARDING_INCOMPLETE`.
   Keep writing the flag for display, or delete it — but do not treat it as the switch.
5. **Hide org vocabulary.** Wider than it looks: `org-switcher.tsx` (":112 Organizations",
   ":132 Create organization"), `onboarding-flow.tsx:153,162,164`, and the whole
   `src/app/(dashboard)/dashboard/settings/organization/` tree. The settings **route path itself**
   is `/dashboard/settings/organization`, declared at `resources.ts:249` under `typedRoutes: true` —
   renaming it is a typed-route change, not a string change. Do not delete the switcher; it is the
   team-plan upsell later.
6. **Zod env schema.** `src/lib/config/required-env.ts` is presence-only. Add `src/lib/config/env.ts`
   and have `required-env.ts` derive its checklist from it. Three constraints:
   - **The schema must not change any variable's throw/warn/soft classification.** Only
     `DATABASE_URL`, `BETTER_AUTH_SECRET` (production only) and conditionally
     `PORTAL_INITIAL_OWNER_EMAIL` may throw. Stripe and Resend throw *at call time, deliberately*
     (`config/stripe.ts:50-52`); Upstash fails open; the dev auth-secret falls back with a warning.
     Turning any of those into a boot crash breaks local development.
   - `env.ts` must not import from `@/lib/adapters`, or you close an import cycle through
     `required-env.ts`.
   - Google OAuth is an **inter-field** rule (both `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and
     `GOOGLE_CLIENT_SECRET`, or neither) — a `superRefine`, not two optional fields.
   - **This step fixes a live bug.** `src/lib/config/plans.ts:71-86` reads `NEXT_PUBLIC_*` through a
     computed key (`process.env[key]`). Next only inlines those for **literal** access, and `PLANS`
     is imported by client components — so every env-driven plan name, description, `showPlan` and
     `trialDays` silently falls back to its hard-coded default in the browser while being correct
     on the server. Literal reads in the schema are the fix.
7. **Vitest.** No runner, no config, no `test` script. Adding one has three known snags: services
   begin with `import 'server-only'`, which resolves to a throwing browser build unless aliased in
   `vitest.config.ts`; React `cache()` is used at module scope across `feature-gate.ts`,
   `usage.service.ts` and `trpc/init.ts`, so memoisation bleeds across tests without
   `vi.resetModules()`; and `@providers-active` needs a third alias copy — note `tsconfig.json`
   and `next.config.ts` currently **disagree** on what it resolves to (`active.tsx` vs
   `active.better-auth.tsx`). Reconcile that while you are in there.
8. **Periodic vs absolute limits.** Nothing in the codebase expresses periodicity;
   `UsageMetrics.lastResetAt` is never read, so a cron that moves it changes no behaviour until a
   reader exists. Add an optional field so no existing entry breaks:
   ```ts
   export interface ResourceLimit {
     // ... existing fields ...
     /** Omitted ⇒ absolute (a standing count, e.g. member seats). */
     period?: 'month'
   }
   ```
   Optional-defaulting-to-absolute is deliberate: a cron that zeroed `member` would let a free
   workspace invite one person per month forever, and zeroing `storage` would decouple the counter
   from actual bytes on disk. Both stay absolute. `apiCalls` is the one existing periodic
   resource — its own description already says "per month" — so it does get `period: 'month'`,
   which is the one amendment to the "leave it alone" note above.
   **Decide the anchor and write it down:** calendar month, or `Subscription.periodEnd`. They give
   different answers for every paying customer.
   Then add the `usage.reset` cron **and a reader** — `getAllUsageMetrics` in
   `src/lib/feature-gate.ts:126` must treat usage older than the window as zero, or the cron proves
   nothing.
9. **The jobs and storage adapters — a parallel seam, not the auth one.** The existing machinery is
   auth-shaped and cannot be reused: `assertProviderActive` is hard-typed to `AuthProviderId`,
   `loadAdapter` returns `AuthAdapter`, `AdapterCapabilities` holds three auth booleans, and
   `@providers-active` exists solely to keep a non-selected provider's **client** chunks out of the
   bundle — which jobs and storage do not have. Widening `AuthProviderId` to include `'inngest'`
   would demand auth implementations from a job queue.
   Copy the *shape*, not the machinery. Each folder gets its own small id tuple, its own
   `resolveXProvider()` reading a **server-only** env var (no `NEXT_PUBLIC_`), its own assert, its
   own dynamic-`import()` switch, and `import 'server-only'`. The one thing that genuinely
   generalises is the eslint fence: add `{ group: ['inngest', 'inngest/*'] }` and the S3 client
   group to `no-restricted-imports`, and add the two new folders to the override `files` array.
   Also amend `docs/09-providers-and-adapters.md`, whose "adding a provider" list is strictly
   auth-shaped and becomes wrong the moment a second *kind* of provider exists.
10. **Inngest.** `src/lib/adapters/jobs/` per step 9, plus `src/app/api/inngest/route.ts` and one
    `hello` function to prove the wiring.
11. **R2 storage.** `src/lib/adapters/storage/` per step 9, with `putObject`, `signedGetUrl`,
    `signedPutUrl`, `deleteObject`. Fix the key convention now, because later phases hard-code it:
    ```
    library/{backgrounds|music|sfx|avatars}/...
    orgs/{organizationId}/uploads/{assetId}/...
    orgs/{organizationId}/projects/{projectId}/{audio|footage|renders}/...
    tmp/{jobId}/...
    ```
    Add an R2 lifecycle rule deleting `tmp/` after 24 hours.
12. **The DataTable.** `.claude/CLAUDE.md:73` holds a slot-based table up as its exemplar global
    component and it does not exist; neither does `src/components/ui/table.tsx`. **Be honest about
    the scope: neither existing "table" is a table.** `audit-logs-table.tsx` and `portal-users.tsx`
    both render `Card` + `divide-y` `<div>` rows. Migrating them onto a `<Table>` primitive is a
    visual redesign of two screens, not a de-duplication.
    Behaviours to lift from `audit-logs-table.tsx`: 300ms debounced search, `placeholderData:
    (previous) => previous`, page reset **derived during render** via a `filterKey` comparison
    (`:110-115`), first-load skeletons distinguished from refetch dimming, empty state that
    branches on whether filters are applied, and Prev/Next disabled on `isFetching` as well as
    bounds. `portal-users.tsx` lacks the last two and blanks out on every page change — fix that by
    adopting the shared component.
    Three contract requirements the naive API misses:
    - **An `expandedRow?: (row: TRow) => React.ReactNode` slot.** `AuditLogRow` holds its own `open`
      state and renders a full-width `<dl>` detail panel; a columns-only API silently drops it.
    - **`search` and `filters` must not collide.** The audit filter bar *contains* its search input
      and its Clear button depends on the search value. Either make `search` a slot too, or rewrite
      `AuditLogFilters` to give it up. Pick one and state it.
    - **Normalise the server contracts first.** `auditLogs.list` returns server-computed
      `totalPages`; `portal.listUsers` returns only `{ items, total }` and the client recomputes.
      Add `totalPages` to `portal.listUsers` rather than throwing away the server's value.
13. **Migrate both call sites** onto the DataTable so it has two real consumers and cannot drift
    into a component nobody uses. Note `portal.listUsers` has **no search parameter** at all — so
    either add server-side search to that endpoint, or accept that portal users ships with
    pagination only. Decide explicitly; do not quietly skip it.
14. **Correct the stale comments you are standing next to.** `src/lib/rate-limit.ts:76` and `:88`
    both claim the limiters are "Applied at src/proxy.ts ingress". They are not — `src/proxy.ts`
    has no rate limiting. Enforcement is in `baseProcedure` and the auth route handler. A grep-first
    agent hits the source comment before the doc that flags it.
15. **Env and docs.** Add every new variable to `.env.example` **and** the new schema. Replace the
    template author's Loom placeholder at `src/lib/config/required-env.ts:82` or remove the row —
    it currently renders as a CTA on your setup checklist.

## Contracts

```ts
// src/services/organization.service.ts
export async function ensurePersonalWorkspace(
  db: DbClient,
  userId: string,
  name: string,
): Promise<{ organizationId: string; created: boolean }>

// src/lib/adapters/storage/types.ts
export interface StorageAdapter {
  putObject(key: string, body: Buffer | ReadableStream, contentType: string): Promise<void>
  signedGetUrl(key: string, ttlSeconds: number): Promise<string>
  signedPutUrl(key: string, contentType: string, maxBytes: number): Promise<string>
  deleteObject(key: string): Promise<void>
}

// src/lib/adapters/jobs/types.ts
export interface JobsAdapter {
  send(event: { name: string; data: Record<string, unknown>; id?: string }): Promise<void>
}

// src/components/global/data-table/data-table.tsx
export interface DataTableProps<TRow> {
  columns: DataTableColumn<TRow>[]
  rows: TRow[]
  total: number
  page: number
  pageSize: number
  totalPages?: number                              // prefer the server's value when given
  onPageChange: (page: number) => void
  isLoading?: boolean
  isFetching?: boolean
  toolbar?: React.ReactNode                        // slot — owns search AND filters together
  actions?: React.ReactNode                        // slot — create, bulk ops
  rowActions?: (row: TRow) => React.ReactNode      // slot
  expandedRow?: (row: TRow) => React.ReactNode     // slot — the audit log detail panel
  empty?: React.ReactNode
  emptyFiltered?: React.ReactNode
}
```

## Done when

- [ ] `npm install` completes including postinstall, and `npx prisma migrate dev` runs against a
      real database.
- [ ] `npm run typecheck`, `npm run lint` and `npm test` all pass locally, and CI runs all three on
      a fresh clone.
- [ ] A brand-new signup reaches `/dashboard` without typing a workspace name, and the word
      "organization" appears nowhere in that flow. *(Test with `RESEND_API_KEY` unset, or email
      verification will gate the session before you get there.)*
- [ ] A user who skipped the plan step can still reach plan selection and complete a paid
      subscription through the existing Stripe Elements flow.
- [ ] `customDomain`, `customBranding` and `integrations` no longer appear on the pricing page or
      in the upgrade modal.
- [ ] A missing required env var fails with a named error; a missing **optional** one still boots.
- [ ] Plan names set via `NEXT_PUBLIC_*_NAME` render correctly **in the browser**, not just on the
      server.
- [ ] The `hello` Inngest function runs from the Inngest dev server.
- [ ] A file round-trips to R2 through the adapter and a signed GET URL expires.
- [ ] Importing `inngest` or the S3 client outside its adapter folder fails lint.
- [ ] Audit logs and portal users both render through `<DataTable>`, pagination works on both, and
      the audit log's expandable detail row still works.
- [ ] `usage.reset` moves `lastResetAt` for `apiCalls`, **and** the gate reader treats a stale
      window as zero.
- [ ] A duplicate `member` row cannot be created, verified by attempting one.

## Not in this phase

Anything video. No timeline, no Remotion, no media upload, no credits.
