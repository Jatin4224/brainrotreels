<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 00 — foundations and seams

Docs 01–09 describe the boilerplate as it shipped. This page describes the first layer the
product added on top, and why each decision went the way it did.

Phase 00 contains no video code. It exists so that Phase 01 onward can be written without
stopping to invent infrastructure. If you are picking the project up, read this before
`docs/phases/01-timeline-document.md` — several things here contradict what the boilerplate
docs told you, and the contradictions are deliberate.

## What the repo looked like before

Worth stating plainly, because the first hour is otherwise confusing. As shipped, the repo
had no `node_modules`, no `.env`, no generated Prisma client, no `prisma/migrations/`, no
`.git/`, no CI and no test runner. `npm install` failed at its own `postinstall`, because
`prisma.config.ts` declares `datasource: { url: env("DATABASE_URL") }` and `prisma generate`
needs that variable *set* — though not pointing anywhere reachable.

None of that was a defect in the code. With dependencies installed and the client generated,
`tsc --noEmit` passed clean on the first try.

**This is an npm project.** There is a `package-lock.json`, no pnpm lockfile and no workspace
file. Any document that says `pnpm` is out of date.

## The five seams

### 1. Jobs — `src/lib/adapters/jobs/`

Durable background work, Inngest behind an interface.

The contract is deliberately tiny: `send` and `sendMany`. Workflows are defined in
`src/inngest/functions/` against Inngest's own step API, because a step/retry/fan-out
abstraction spanning engines would be a worse version of the engine. What stays
provider-neutral is the **call sites** — a router says "this happened", never "run this now".

That matters more than it sounds. A tRPC mutation runs inside a **10-second Prisma
transaction** alongside the audit row, so anything slower than a quick provider round-trip
must leave the request. `enqueue()` is the short call that makes doing the right thing
easier than doing the wrong one.

Event names are a closed union (`JOB_EVENT_NAMES`). A typo'd event name silently enqueues
something no workflow listens for, and the symptom — "the job never ran" — is indistinguishable
from a broken workflow.

### 2. Storage — `src/lib/adapters/storage/`

Cloudflare R2 behind `StorageAdapter`, plus `keys.ts`, which is the important file.

Keys encode tenancy. `orgs/{organizationId}/...` is what makes "this file belongs to that
workspace" true *at the storage layer*, not only in Postgres. If call sites build keys by
hand, one template-literal typo puts a customer's render under another customer's prefix and
no database constraint catches it. So `keys.ts` is the only module that knows the layout, it
is pure (no SDK, no env, importable anywhere), and every segment is validated against
traversal.

Signed PUTs sign `ContentType` **and** `ContentLength` into the URL, so the bucket rejects an
oversized or mistyped upload itself. Validating only in the app would leave the signed URL
usable for an arbitrary file until it expired — the difference between a size limit and a
suggestion.

The R2 client is lazy and throws on first *use*, matching `config/stripe.ts`. A module-scope
throw anywhere in the root layout's import graph would replace the setup checklist — the one
screen whose job is to say which variables are missing — with a stack trace.

### 3. Why these are not the auth seam

`docs/09-providers-and-adapters.md` describes the auth provider seam, and the obvious move is
to reuse it. **You cannot.** `assertProviderActive` is hard-typed to `AuthProviderId`,
`loadAdapter` returns an `AuthAdapter` with identity/tenancy/entitlement, and
`AdapterCapabilities` is three auth-shaped booleans. Adding `'inngest'` to `AUTH_PROVIDER_IDS`
would demand an auth implementation from a job queue and break the exhaustive switch.

So `src/lib/adapters/select-provider.ts` copies the *shape* — one env read, a validated id, a
module-scope assert, a dynamic import — without sharing the machinery. Nine seams are coming
(jobs, storage, llm, tts, stt, render, video, stock, moderation), so the factory pays for
itself immediately.

Two deliberate differences from auth:

- **Server-only env vars.** `JOBS_PROVIDER` and `STORAGE_PROVIDER` are not `NEXT_PUBLIC_`. No
  browser code enqueues a job or reads bucket config; the auth var is public only because the
  client wrappers must agree with the server on a provider.
- **No `@providers-active` alias.** That exists purely to keep a non-selected provider's
  *client* chunks out of the bundle. These seams have no client half, so it would buy nothing.

The auth seam keeps its own copy on purpose. It is the only client-reachable one, and
rewiring working auth code to remove a duplication would be risk without benefit.

### 4. The eslint fences

Each seam gets a `no-restricted-imports` group plus an override listing its sanctioned
folders. Both were **probed with throwaway violations** and confirmed to reject — an untested
fence is not a fence.

```
inngest        → only src/lib/adapters/jobs/inngest/**, src/inngest/**, src/app/api/inngest/**
@aws-sdk/*     → only src/lib/adapters/storage/r2/**
```

Note `keys.ts` sits *outside* the R2 folder and imports no SDK. That is what keeps it unit
testable and safe to import from a client component.

### 5. CI — and why it builds first

There was no CI. The workflow runs **`npm run build` before typecheck and lint**, which is not
the conventional order and is load-bearing. See "The `Route` trap" below.

It also uses `npm ci --legacy-peer-deps`, matching local installs, because npm 10.9.3 crashes
resolving Vitest's peer set (`Cannot read properties of null (reading 'edgesOut')` in
arborist's `#loadPeerSet`).

## Registry changes

### Three resources removed

`customDomain`, `customBranding` and `integrations` are gone. The pricing table and upgrade
modal are generated from `RESOURCES`, so the first two rendered as sellable paid-plan features
with **zero code behind them** — a refund request waiting to happen. `integrations` minted
permission strings and owner grants for a router and page that were never built.

A test asserts they cannot quietly return.

### `ResourceLimit.period`

New optional field, currently used only by `apiCalls`.

```ts
period?: 'month'   // omitted ⇒ absolute
```

Absolute is the default deliberately, because the two mistakes fail very differently. Marking
an absolute resource periodic **silently refills it** — a free workspace could invite one
member per month forever, and `storage` would detach from the bytes actually in R2. Marking a
periodic resource absolute strands customers at their cap, which at least generates a support
ticket. The dangerous direction has to be typed out on purpose.

## Periodic usage — the cron is not the mechanism

`UsageMetrics.lastResetAt` existed since the boilerplate shipped and was **never written and
never read**.

It is now both, but the ordering matters: **readers** treat a counter from a closed window as
zero (`effectiveUsage` in `src/lib/usage-period.ts`, wired into both `checkFeatureGate` for
server enforcement and `getAllUsageMetrics` so the UI agrees). The cron merely tidies the
stored rows. A cron that silently stopped would otherwise hand every customer a permanently
exhausted quota.

Two judgement calls, both revisitable:

- **Calendar month, UTC** — not each organization's Stripe billing date. The quota reads as a
  product promise ("500,000 API calls a month"), and a free workspace has no subscription to
  anchor to; anchoring only paid plans would mean two reset rules in one system. Revisit if
  usage is ever invoiced.
- **The cron runs hourly, not monthly.** A once-a-month job has exactly one chance to fire; a
  deploy at the wrong hour costs every customer a month of quota. The
  `lastResetAt < periodStart` filter makes it idempotent — the first run after the boundary
  does the work, the next 23 match nothing.

## The env schema, and a live bug it fixed

`agents.md` had always claimed a Zod env schema existed. It did not —
`src/lib/config/required-env.ts` is a presence-only checklist.

`src/lib/config/env.public.ts` now reads every `NEXT_PUBLIC_*` variable **literally**, and the
`LITERAL_ENV_READ` comment on it is a warning against refactoring those reads into a loop.

Here is why. Next.js substitutes `process.env.NEXT_PUBLIC_X` in the **client** bundle only for
a *literal* member or index access. `plans.ts` read them through a helper taking a key —
`process.env[key]` — which Next leaves alone, so in the browser it evaluated against an empty
object and silently returned the fallback. Every env-configured plan name, description,
`showPlan` and `trialDays` was **correct on the server and wrong in the browser**.

This was confirmed by A/B build, not reasoning: with `NEXT_PUBLIC_PRO_NAME="CreatorPlus"`, the
sentinel appears in the client chunks with the fix and is **absent** with the original code.

The helpers (`envString`, `envBoolean`, `envInteger`, `envOptional`) take a **value, never a
key** — taking a key is precisely what reintroduces the bug.

The schema is also deliberately *advisory*. Only the genuinely required variables throw;
Stripe and Resend still fail at call time, Upstash still fails open, the dev auth secret still
falls back with a warning. Turning any of those into a boot crash would break local
development and hide the setup checklist.

`required-env.ts` keeps its computed `process.env[key]` read, which is correct **there and
only there** — it runs solely from the root layout and `SetupChecklist`, both server
components, where `process.env` is the real object. A `SERVER_ONLY_READ` comment says so.

## The DataTable

`.claude/CLAUDE.md` holds a slot-based table up as its exemplar global component, and it did
not exist — nor did `src/components/ui/table.tsx`. Pagination had been hand-rolled twice and
the copies had already diverged.

`src/components/global/data-table/` owns search, pagination, loading, empty, error and row
expansion. Three contract decisions, each one the opposite of the obvious API:

| Decision | Why the obvious version is wrong |
| --- | --- |
| `toolbar` is **one** slot holding search *and* filters | The audit filter bar contains its own search input, and its Clear button needs that value. A separate `search` prop renders two boxes. |
| `expandedRow` slot exists | The audit log row expands to a full-width detail panel. A columns-only API cannot express that, and migrating without it would have silently deleted the feature. |
| `totalPages` is optional and **preferred** | `auditLogs.list` computes it server-side. Deriving from `total / pageSize` instead re-implements it against a page size the client merely *asserts* matches the server's. |

`usePaginatedFilters` carries the subtle part: the page reset is derived **during render** via
a serialised filter key, not in an effect. An effect would let one request fire for "page 4 of
the new filter" before the reset landed — the user sees an empty page, then the right one.
Only free text is debounced; selects apply immediately, because picking an option is one
deliberate act rather than a keystroke stream.

Both existing screens were migrated, which fixed a real bug in `portal-users.tsx`: no
`placeholderData` and no `isFetching` guard meant rows blanked out on every page change.

Note this was a **visual redesign**, not a refactor — neither screen previously rendered a
`<table>` at all; both were `Card` + `divide-y` rows.

## Personal workspaces, and keeping the funnel

`protectedProcedure` requires an `organizationId` on every call and the dashboard requires an
active organization, so a user with zero memberships can do nothing. For a solo creator there
is no team to name. Every signup now gets one workspace created for them, and the UI never
says "organization".

**Where the hook lives, and why not elsewhere.** It is in the dashboard layout, at the branch
that already detects zero memberships and already excludes the portal owner. It is *not* a
Better Auth `databaseHooks.user.create.after` for three reasons: `AuthAdapter` has no
`onUserCreated` seam, so a second provider would silently never get a workspace; a throw in
that hook aborts sign-up, turning a transient database blip into "registration is broken"; and
it fires for the portal owner, who must **not** get a tenant org.

**The cache trap.** The first working version created the workspace correctly and *still*
bounced to onboarding. `createTRPCContext` and its membership lookups are React `cache()`d for
the **request**, so calling `getActiveOrganization()` again after creating the org returns the
same memoised `null` that sent you down that branch. The database was right; the page was
wrong. The fix is to `redirect()` so a fresh request gets a fresh cache — placed **outside**
the try/catch, because `redirect()` signals by throwing and the catch would swallow it.

**The funnel.** The onboarding wizard was three steps — name, plan, **and a live Stripe
Elements card form**. It was the only place a new user could start a paid subscription.
Auto-creating the workspace would have deleted it. The plan choice now lives in
`PlanSetupCard` on the dashboard: dismissible, built on the existing `useUpgradeNudge` (decides
whether there is anything to sell, and to whom) and `useUpgradeModal` (runs the real Stripe
flow). There is no second checkout path, because a parallel payment surface is how two of them
drift.

Dismissal is per-browser `localStorage` via `useSyncExternalStore` — the server snapshot
renders hidden, the client snapshot reads storage. The obvious `setState`-in-an-effect version
is rejected by the React Compiler lint, correctly: it schedules a second render on every
mount.

`ensurePersonalWorkspace` is idempotent. Two tabs opening `/dashboard` at once both see zero
memberships; the new `Member` unique constraint makes the loser fail rather than duplicate,
and the re-read turns that into "already had one".

## Traps worth knowing before you hit them

### The `Route` trap — read this one

`typedRoutes: true` means `Route` is a **literal union generated into `.next/types` by
`next build`**. Without build output present, `Route` degrades to `string`, and then:

- `tsc --noEmit` passes code the build rejects, and
- eslint reports necessary `as Route` casts as *unnecessary*.

Phase 00 removed two such casts on eslint's advice and broke `next build`. They are restored
with `NECESSARY_DESPITE_LINT` comments, and **CI runs the build first** so this cannot recur.
If lint tells you an `as Route` is redundant, build before you believe it.

### npm 10.9.3

`npm install <pkg>` can fail with `Cannot read properties of null (reading 'edgesOut')`. Use
`--legacy-peer-deps`. This also breaks the shadcn CLI's internal install, which is why
`table.tsx` was written by hand rather than generated.

A related gotcha: `--legacy-peer-deps` skips peers, so Vitest's `vite` peer had to be installed
explicitly.

### Inngest v4

`createFunction` takes **two** arguments with the trigger inside options. The v3
`(config, trigger, handler)` form does not type-check.

Dev mode is derived from `NODE_ENV` rather than requiring `INNGEST_DEV=1`, so a fresh clone
works with just `npx inngest-cli@latest dev`. Without it the SDK assumes cloud mode and every
request to `/api/inngest` 500s with "no signing key found".

### Testing

`vitest.config.mts` carries three load-bearing resolutions: a `server-only` stub (every
service imports it, and it throws outside Next), and `@providers-active` — where
`tsconfig.json` and `next.config.ts` **disagree** (`active.tsx` vs `active.better-auth.tsx`).
Vitest is pinned to the concrete surface that actually runs.

Also: `RESOURCES` is `as const`, so `RESOURCES.member.limit.period` is a **compile error**
rather than `undefined`. That is the type system proving an invariant, but it means tests
asking the question generically must widen through the declared interface.

## What Phase 00 did not finish

- **The `Member` unique migration.** The schema has
  `@@unique([organizationId, userId])`; run `npx prisma migrate dev`. Checked for existing
  duplicate pairs first — there were none.
- **The R2 round-trip.** Adapter, keys and tests are in. The smoke test needs a real bucket and
  the five `R2_*` variables, plus **a lifecycle rule deleting `tmp/` after 24 hours** — the key
  convention assumes it exists and nothing in code enforces it.
- **Visual review** of the two migrated list screens.

## Where to go next

`docs/phases/00-README.md` for the conventions and the full phase list;
`docs/phases/01-timeline-document.md` for the next piece of work. The timeline document is
pure and isomorphic by design — the same `apply()` runs in the browser editor and on the
server — and two implementations drifting apart is the documented way this architecture fails.
