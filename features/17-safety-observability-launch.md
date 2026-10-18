> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 17 — Safety, limits, observability and launch

## Goal
Make the product safe to open to the public, and make its costs and failures visible. **Ships the public beta.**

## Depends on
Phases 11, 13, 14.

## Deliverables
- Moderation on every paid path
- Rate limits and daily caps
- Error tracking, analytics, admin dashboard
- Transactional emails and legal pages

## Steps
1. Moderation service: classify input text, generated scripts and prompts before any paid step; store `moderationStatus` on projects and assets; block with a clear policy message.
2. Replace the Phase 09 `moderate` stub with the real implementation.
3. Rate limits in Upstash: per-user daily generations by plan, per-IP signups, per-route API limits. Free tier requires a verified email before generating.
4. Sentry across app, Inngest functions and webhooks, with `requestId` attached from API call through to render.
5. PostHog funnel: signup → first script → first render → purchase.
6. Admin dashboard `/admin`: videos per day by kind, failure rate by stage, p95 render time, real cost per video versus credits charged, provider error rates and spend, queue depth, flagged moderation items, user lookup with credit adjustment.
7. Emails via Resend: video ready, render failed with credits refunded, low balance.
8. Cost alerts per provider (AWS, Anthropic, ElevenLabs, Inngest); daily spend threshold notifications.
9. Legal and marketing: landing page with real sample videos, pricing page, terms, privacy, refund policy, cookie banner if required.
10. Uptime monitoring and a status page.

## Acceptance criteria
- A disallowed prompt is refused before any provider is called.
- A script hammering the generate endpoint is rate limited with 429 and a JSON body.
- The admin dashboard answers "what did yesterday's videos cost us?" without a query.
- A stranger can sign up, pay, generate and download without assistance.

## Out of scope
SOC 2, advanced fraud detection.
