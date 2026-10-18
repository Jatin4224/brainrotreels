> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Build phases — index and conventions

Twenty phases, each a self-contained brief you can hand to a coding agent. Start a session with:

> Implement Phase 04 from `docs/phases/04-render-core.md`. Follow the acceptance criteria exactly. Ask before changing anything in `packages/timeline`.

Each phase file has: Goal · Depends on · Deliverables · Steps · Contracts · Acceptance criteria · Out of scope.

## Order

| # | Phase | Ships |
|---|---|---|
| 01 | Foundations and infrastructure | Deployable empty app |
| 02 | Auth and accounts | Login, ownership rules |
| 03 | Timeline document package | The core data contract |
| 04 | Render core (local Remotion) | MP4 with synced captions |
| 05 | Media library and asset pipeline | Uploads, transcode, proxies |
| 06 | Voices and text to speech | Per-line narration, previews |
| 07 | Alignment and caption styles | Word timings, 30+ styles |
| 08 | Script generator | Idea / URL / PDF to script blocks |
| 09 | Job orchestration (Inngest) | Durable pipeline, progress |
| 10 | Cloud rendering (Lambda) | Renders at scale |
| 11 | Credits, entitlements, billing | Money works |
| 12 | App shell, dashboard, project view | Usable product surface |
| 13 | Generation wizard | Guided creation flow |
| 14 | Reddit story format | First complete format |
| 15 | Character explainer format | Two-voice dialogue videos |
| 16 | Quiz video format | Third format |
| 17 | Safety, limits, observability, launch | **Public beta** |
| 18 | Timeline editor | Manual editing |
| 19 | Motion graphics studio | Premium format (largest phase) |
| 20 | AI footage, REST API, MCP | Platform surface |

## Stack (fixed — do not substitute)

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui · Neon Postgres + Drizzle · Better Auth · Inngest · Remotion + Remotion Lambda · Cloudflare R2 · Upstash Redis · Claude API · ElevenLabs (TTS + Scribe) · Stripe · Resend · Sentry + PostHog · Vercel.

## Repository layout

```
apps/web/              Next.js app (UI + API routes + Inngest handler)
packages/timeline/     Timeline document schema, migrations, operations
packages/video/        Remotion compositions and components
packages/db/           Drizzle schema and migrations
packages/providers/    LLM, TTS, STT, stock, video-model, reddit adapters
packages/core/         Entitlements, credits, cost estimates, shared types
packages/ui/           Shared React components
docs/phases/           These files
```

## Rules that apply to every phase

1. **The timeline document is the only contract** between generators, the editor, the preview, and the renderer. Never bypass it.
2. **Generated timing uses word anchors**, resolved to seconds when the document is built. Never guess seconds.
3. **Every database read goes through a data-access function that takes `userId`.** No raw queries in route handlers.
4. **Provider calls live in `packages/providers` behind an interface.** No vendor SDK imported anywhere else.
5. **Long work never runs inside an Inngest step.** Start it, then wait for a webhook or poll.
6. **Credits: estimate, hold, commit, release.** Any failure releases automatically.
7. **No cloned voices or likenesses of real people or third-party characters.** Licensed or original only.
8. **Every schema validated with Zod at the boundary.** Parse, don't assume.
9. **Tests:** unit tests for schema/ops/pricing, one integration test per pipeline phase.
10. **Never commit secrets.** All keys server-side only.
