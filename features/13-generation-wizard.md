> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 13 — Generation wizard

## Goal
One guided flow that creates any format, with a cost estimate before anything is spent.

## Depends on
Phases 06, 07, 08, 11, 12.

## Deliverables
- `/app/new` format picker
- Wizard steps: input → script → voices → look → review
- `/app/projects/:id/progress` screen

## Steps
1. Format picker tiles with looping samples, typical length, credit cost, and plan badges on locked formats.
2. Step 1 Input: per-format panel (Phase 14–16 add theirs). Autosave a draft project on first input.
3. Step 2 Script: the Phase 08 editor with speaker tags, duration total and a >60s warning.
4. Step 3 Voices: speaker list plus voice library panel; Next disabled while any speaker is unassigned.
5. Step 4 Look: tabs for background (library grid, lock badges, upload tile), style, and caption style with live preview.
6. Step 5 Review: preview of the opening seconds, summary list, cost breakdown, balance after, primary button `Generate (N credits)` or `Top up credits`.
7. Progress screen: vertical stage list with per-stage status and elapsed time, thumbnail strip filling in, Cancel, "email me when done", retry on failure.
8. Navigation is resumable: leaving and returning restores the draft at the same step.

## Acceptance criteria
- A user can go from the dashboard to a finished render without typing anything except the topic.
- The cost shown on the review step matches the credits actually held.
- Closing the tab during generation does not stop the job.
- Every step is keyboard navigable with visible focus states.

## Out of scope
Format-specific inputs beyond a plain text field (added in Phases 14–16).
