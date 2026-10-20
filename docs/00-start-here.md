<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Start here

These docs explain how this boilerplate is shaped and why. The README tells you what to do. These docs tell you how things fit together.

## Read order

1. `01-architecture.md` — the big picture in one page
2. `02-the-registry.md` — the one file that drives almost everything
3. `03-procedures-and-routers.md` — where your code goes
4. `04-auth-and-tenancy.md` — Better Auth, organizations, roles
5. `05-feature-gates.md` — plan limits and flags
6. `06-audit-and-rate-limit.md` — automatic audit logs and abuse protection
7. `07-adding-a-feature.md` — a full end-to-end walkthrough
8. `08-types-and-grep.md` — type rules and how to navigate the code
9. `09-providers-and-adapters.md` — the provider seam, and how to plug in a new auth/billing provider
10. `10-phase0.md` — what the product added on top, and the traps it found
11. `11-phase1.md` — the timeline document: the contract every generator, editor and renderer shares
12. `12-phase2.md` — media assets: uploads, signed URLs, the ingest job, and where ffmpeg runs
13. `13-phase3.md` — render core: one composition, the component registry, and determinism

## If you only have five minutes

Read `01-architecture.md` for the mental model, then jump to `07-adding-a-feature.md`. Come back for the rest later.

## What this is

Every multi-tenant SaaS needs the same plumbing: auth, organizations, roles, plan tiers, audit logs, rate limiting. This boilerplate gives you that, and nothing else. Forms, payments adapters, file storage, landing pages — those belong in your app, not here.

## A note on `.claude/CLAUDE.md`

That file is the pattern rulebook for AI agents. It is intentionally terse — "when you see X, do Y" with no explanation. These docs explain the why behind those rules.
