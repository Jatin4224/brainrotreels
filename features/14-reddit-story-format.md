> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 14 — Reddit story format

## Goal
The first complete format end to end: a Reddit thread or pasted text becomes a narrated gameplay video with captions.

## Depends on
Phases 09, 10, 13.

## Deliverables
- Reddit ingestion adapter
- `reddit-story` generator producing a timeline document
- Wizard input panel and background selection for this format

## Steps
1. Reddit adapter using the official API with an OAuth app: fetch title, body and top comments; respect rate limits; handle deleted, private and removed threads with specific errors.
2. URL validation: scheme allowlist, Reddit host check, block private address ranges (SSRF).
3. Condensation: LLM trims and cleans the thread into narration lines, keeps the original voice, splits by speaker where the thread has multiple participants, and warns above 60 seconds.
4. Generator `build(projectId)`: background track (selected loop, muted, looping), narration track from Phase 06, caption track from Phase 07, optional title card scene for the post title.
5. Wizard input panel: Reddit URL field with live validation, or paste raw text; "condense long threads" toggle.
6. Background step defaults to a sensible gameplay loop and remembers the user's last choice.
7. Retention policy: outputs of this kind expire after the configured window; show the expiry on the project page.

## Acceptance criteria
- A real public thread URL produces a complete 9:16 video with synced captions and looping background.
- A private or deleted thread produces a clear message offering raw-text entry.
- A thread longer than the limit is condensed, with the final duration shown before generation.
- A background shorter than the narration loops seamlessly.

## Out of scope
Avatars and character dialogue (Phase 15).
