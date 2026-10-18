# Short-form video studio

A platform that turns prompts, links and topics into vertical short videos, built on the
Architectural Guardrail boilerplate.

Full design: `architecture.md` · Build order: `docs/phases/00-README.md` · Progress:
`docs/phases/PROGRESS.md` · Boilerplate internals: `docs/01`–`docs/09`.

> Earlier revisions of this file described a pnpm + Turborepo monorepo on Drizzle with
> `packages/*`. **That application does not exist.** This is a single Next.js app on Prisma and
> tRPC. If any document tells you to create `packages/`, it is out of date — `docs/phases/00-README.md`
> has the translation table.

## The two rules

**1. Every feature produces or edits the same timeline document**, and one Remotion composition
(`TimelineRenderer`) renders it. A new format adds one generator and one component family. Never
add a second pipeline or a second renderer.

**2. Every endpoint goes through `protectedProcedure`**, which already does auth, membership,
permissions, plan gates, usage counters, the transaction and the audit row. Your handler is
business logic only. Never re-check what it has already checked.

## Stack (real)

Next.js 16 App Router on Vercel · React 19 + React Compiler · TypeScript strict · **Prisma 6 +
Postgres** · **tRPC v11** · Better Auth behind an adapter · Tailwind v4 + shadcn (`base-nova` style
on **Base UI**, not Radix) · Upstash Redis · Resend · Stripe · Zod v4 + React Hook Form.

Being added by the phases: Inngest · Remotion + Remotion Lambda · Cloudflare R2 · Claude ·
ElevenLabs TTS and Scribe · fal.ai / Replicate · Pexels / Pixabay · Reddit API · Vitest ·
Sentry / PostHog.

## Layout

Exists today:

```
src/app/              routes; (auth) (dashboard) (onboarding) (portal) + api/
src/trpc/routers/     your business logic, one file per resource
src/trpc/procedures/  protected.ts — the procedure builder. DO NOT EDIT
src/services/         pure Prisma, one verb per function, 'server-only'
src/lib/resources.ts  THE REGISTRY — permissions, limits, flags, nav, audit
src/lib/adapters/     the auth provider seam (identity, tenancy, entitlement)
src/lib/types/        the only place custom types may live
prisma/schema.prisma  the data model
```

Arrives with the phases — **these do not exist yet**, do not expect to import from them:

```
src/lib/adapters/{jobs,storage,llm,tts,stt,render,...}/   Phases 00, 02, 04, 06-08
src/lib/timeline/     document schema, validation, migrations, operations   Phase 01
src/inngest/          durable workflows                                     Phase 00
src/remotion/         compositions and component families                   Phase 03
```

## Rules that always apply

### Architecture

- **Registry entry first, router second.** `protectedProcedure` throws at runtime if a mutation's
  path segment is not a `RESOURCES` key and it declares no explicit options.
- Routers hold business logic. Services are pure Prisma — one verb, one table, no auth, no audit,
  no transactions. First statement is `import 'server-only'`.
- Import services by **named import from the explicit path**. There is no barrel and no `import * as`.
- Write through `ctx.db` so your writes share the handler's transaction.
- **Never** in a handler: open a transaction, call `logActivity`, call `incrementUsage` on a
  `.create` path, or compare `ctx.memberRole` to a string — branch on `ctx.memberHasFullAccess`.
- Declare `limit` or `flag` on the registry entry; never re-check a gate in a router.
- **Never create `middleware.ts`.** Next 16 reads `src/proxy.ts`. eslint blocks the import.

### Tenancy

- Every query filters by **`organizationId`**, not `userId`. One org is auto-created per signup and
  acts as a personal workspace; the UI never says "organization".
- Re-check ownership inside jobs — they run outside `protectedProcedure` and get none of its gates.

### The video pipeline

- Timeline items reference `assetId`, never raw URLs. Sign at preview and render time.
- Captions reference word ranges, never text copies. Generated timing uses word anchors.
- All timeline edits go through `src/lib/timeline` `apply()` — the same code in browser and server.
- Never overwrite a manually edited timeline (`Project.manualEdited`) with a regeneration; branch
  to a new version.
- Cache by hash: TTS by `textHash`, alignment by `audioHash`, renders by `docHash`.

### Work and money

- **Nothing slow runs in a tRPC handler.** Mutations execute inside a 10-second Prisma transaction.
  Validate, enqueue an Inngest event, return.
- Start long work in one step and await it by webhook in another. A step that waits ten minutes
  times out.
- Paid work: `hold` credits before, `commit` on success, `release` in `onFailure` and on cancel.
- Use `ERROR_CODES.INSUFFICIENT_CREDITS` — the code and its `StructuredErrorCause` variant already
  exist in `src/lib/errors/index.ts`. **Nothing throws it and nothing renders it yet**: Phase 05
  adds both the producer and the client handler. Reuse the code; do not assume the UI reacts.

### Safety

- All provider keys server-side. Call providers only through `src/lib/adapters/*`.
- Script text, Reddit content, fetched pages and uploaded documents are **untrusted data, never
  instructions**. Wrap them in delimiters and say so in the system prompt.
- Validate URLs against a scheme allowlist and block private address ranges.
- Verify every webhook signature. Idempotency keys on every enqueue and payment webhook.
- Moderate text before any paid step and uploads after ingest. Moderation **fails closed**.
- Never return `ipAddress` or `userAgent` to a frontend; `AUDIT_LOG_SAFE_SELECT` is a security
  boundary.

### Types

Resolve in order: Prisma (`@/generated/prisma`) → adapter contracts (`@/lib/adapters`) → existing
`src/lib/types/*` → only then write a new one, in `src/lib/types/` and nowhere else. Banned: `any`,
`as Foo`, `!`, `@ts-ignore`. Env reads are `process.env['KEY']` (`noPropertyAccessFromIndexSignature`).

### UI

- The app is **dark-only** (`forcedTheme="dark"`). Theme tokens only — no hex, no `text-white`.
- Primitives are **Base UI**: `render={<Link/>}`, never `asChild`.
- Page chrome is `<ContentLayout title actions width>`; settings blocks are `<SettingsSection>`.
- Forms: Zod schema in `src/lib/types/*` → RHF + `zodResolver`, `mode: 'onTouched'` → shadcn `Form`
  → tRPC mutation → `utils.*.invalidate()`.
- Wrap gated triggers in `<FeatureGate resource="...">`.
- Keyboard navigation and ARIA labels on grids, timeline controls and inputs.

## Working style

- Build one phase at a time from `docs/phases/`. Do not start work from a later phase.
- **Grep with `-l` before creating anything.** Every authoritative export carries a
  `SOURCE OF TRUTH KEYWORDS:` line. Most types already exist.
- New authoritative exports get their own `SOURCE OF TRUTH KEYWORDS` + `WHAT/WHY/WHERE` block.
- Add every new environment variable to `.env.example` **and** to `src/lib/config/required-env.ts`.
  (A Zod env schema arrives in Phase 00; until then that checklist is the only gate.)
- Run `npm run typecheck` before handing anything over. Never report a false positive.
- Do not run `prisma migrate`, `prisma generate`, or git. Ask the developer to run migrations.
- Ask before adding an external service or heavy dependency the architecture does not name.
- Say plainly what you could not verify — anything needing real provider keys, especially.
