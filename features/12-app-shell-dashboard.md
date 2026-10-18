> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 12 — App shell, dashboard and project view

## Goal
The product surface: navigation, project list, project preview and export.

## Depends on
Phases 02, 10, 11.

## Deliverables
- App shell (sidebar, top bar with credit balance)
- `/app` dashboard with project cards and live status
- `/app/projects/:id` preview and export screen

## Steps
1. Shell: sidebar (Projects, Media, Billing, Settings), top bar (credit balance, New video, account menu). Collapses for full-width screens.
2. Dashboard: responsive grid of project cards (poster, kind badge, duration, status chip, menu: open, duplicate, rename, download, delete), filter by kind and status, loading skeletons, empty state with format tiles.
3. Live status on generating cards by polling the stages endpoint.
4. Project screen: 9:16 player, title inline edit, status, Download (resolution options by plan, watermark note), Open editor, Duplicate, Regenerate, details panel, scene strip for seeking.
5. Regenerate warns when `manualEdited` is true and offers "new version" or "keep edits".
6. Failed projects show the failing stage, plain-language cause, "credits refunded" and Retry.
7. Mobile: dashboard, project view and download work on phones.

## Acceptance criteria
- A generating project shows live progress on its card without a page refresh.
- Download respects plan resolution and watermark rules.
- Deleting a project removes its files from R2 within the cleanup window.
- Every screen has a usable empty, loading and error state.

## Out of scope
Wizard (Phase 13), timeline editor (Phase 18).
