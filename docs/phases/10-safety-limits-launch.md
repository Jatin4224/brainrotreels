# Phase 10 — Safety, limits and launch

**Depends on:** Phases 05, 09.

## Goal

Make the product safe to open to the public, and make its costs and failures visible before they
surprise anyone. **This phase ships the public beta.**

## Registry

This is the first phase that actually declares `rateLimit` on registry entries. The mechanism has
existed since the boilerplate shipped — `getResourceLimiter` in `src/lib/rate-limit.ts` and step 8
of the procedure builder — and **no resource has ever used it**, so that path is currently dead
code. Wake it up:

```ts
projects: {
  // ... existing entry ...
  rateLimit: {
    create:   { count: 20, window: '1 m' },
    generate: { count: 30, window: '1 h' },
  },
}

renders: {
  // ... existing entry ...
  rateLimit: { create: { count: 20, window: '5 m' } },
}

assets: {
  // ... existing entry ...
  rateLimit: { create: { count: 60, window: '1 m' } },
}

scripts: {
  // ... existing entry ...
  rateLimit: { create: { count: 20, window: '1 m' } },
}
```

Daily generation caps are per plan and live on the `projects` limit, not here — a rate limit stops
a burst, a plan cap stops a month.

## Data

```prisma
model ModerationRecord {
  id             String   @id @default(cuid())
  organizationId String
  subjectType    String   // project | asset | prompt | script
  subjectId      String
  status         String   // approved | rejected | flagged
  categories     Json?
  reason         String?
  engine         String
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([subjectType, subjectId])
  @@index([status, createdAt])
  @@map("moderation_record")
}
```

`Project` and `Asset` already carry `moderationStatus`; this table is the audit trail behind those
booleans, and the queue the admin console reads.

## Build

1. **The moderation adapter.** `src/lib/adapters/moderation/` with `classify(text, context)`.
   Ship a Claude implementation. **It fails closed**: if the provider is unreachable, the work is
   refused, not allowed through. Every other adapter in this system degrades; this one does not,
   because the failure mode is publishing something that should never have been published.
2. **Replace the Phase 09 `moderate` stub** with the real call. Classify input text, generated
   scripts, and every prompt, **before any paid step**. Write a `ModerationRecord`, set
   `moderationStatus`, and block with a clear policy message naming the category — not a generic
   refusal the user cannot act on.
3. **Moderate uploads after ingest** (you cannot classify a video before transcoding it), and keep
   the asset out of any render until it is approved.
4. **Correct the false documentation.** `docs/06-audit-and-rate-limit.md` and the header comment of
   `src/lib/rate-limit.ts` both state that `apiLimiter` and `authLimiter` run at `src/proxy.ts`
   ingress. **They do not.** `src/proxy.ts` only bypasses static paths, bounces `/sign-up` when
   registration is closed, and stamps `x-pathname` / `x-hostname`. The real enforcement is in
   `baseProcedure` and in the POST branch of `src/app/api/auth/[...all]/route.ts`. Fix both comments
   rather than leaving the next person to discover it as I did.
5. **Per-plan daily generation caps** in Redis, plus per-IP signup limits. Free workspaces require a
   verified email before generating — Better Auth already enforces verification at sign-in; this is
   the generation-time check.
6. **Sentry** across the app, the Inngest functions and the webhooks, with `requestId` attached from
   the API call through the event, the steps and the render. The procedure builder already emits
   structured JSON logs with `durationMs` — extend that rather than introducing a second logger.
7. **PostHog** funnel: signup → first script → first render → purchase.
8. **Extend the existing `/portal` console.** There is already a platform-admin surface —
   `src/app/(portal)/`, `src/services/portal.service.ts`, `PortalSidebar` with a static `PORTAL_NAV`
   array. Add video operations to it; do not build a second admin app. New pages: videos per day by
   kind, failure rate by stage, p95 render time, **real cost per video versus credits charged**
   (this is why Phase 05's estimate returns a breakdown), provider error rates and spend, queue
   depth, and a flagged-moderation queue. Add the nav entries to `PORTAL_NAV`, which is
   deliberately static and not registry-derived.
9. **Transactional emails** via Resend, following the existing convention in
   `src/lib/email-templates/` — a props interface, a named export plus a default, wrapped in
   `<BaseLayout>` with `emailStyles`, re-exported from the barrel. Three new templates: video ready,
   render failed with credits refunded, low balance.
10. **Cost alerts per provider** (AWS, Anthropic, ElevenLabs, Inngest) with a daily spend threshold
    notification. Generative work can run up a bill faster than a dashboard gets checked.
11. **Legal and marketing**: landing page with real sample videos, pricing page driven by the
    registry's `getPlanFeatureRows` rather than a hand-typed list, terms, privacy, refund policy,
    takedown contact, cookie banner if required.
12. **Uptime monitoring and a status page.**

## Contracts

```ts
export interface ModerationAdapter {
  classify(args: { text: string; context: 'input' | 'script' | 'prompt' }): Promise<ModerationVerdict>
}
export interface ModerationVerdict {
  status: 'approved' | 'rejected' | 'flagged'
  categories: string[]
  reason?: string
}
```

## Done when

- [ ] A disallowed prompt is refused before any provider is called, with a message naming why.
- [ ] Taking the moderation provider offline refuses the work rather than allowing it through.
- [ ] A script hammering the generate endpoint is rate limited with a 429 and a JSON body carrying
      a reset hint.
- [ ] The rate-limit claims in `docs/06` and `src/lib/rate-limit.ts` match what the code does.
- [ ] A free workspace with an unverified email cannot generate.
- [ ] The portal answers "what did yesterday's videos cost us, and what did we charge?" without
      anyone writing a query.
- [ ] A forced error appears in Sentry with its `requestId`, traceable to the render it came from.
- [ ] A stranger can sign up, pay, generate and download without assistance.

## Not in this phase

SOC 2, advanced fraud detection, team billing.
