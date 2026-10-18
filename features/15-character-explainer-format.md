> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 15 — Character explainer format

## Goal
Two original characters explain any topic as a dialogue, with per-speaker voices and avatars that react as they talk.

## Depends on
Phase 14.

## Deliverables
- Character pair catalog
- Dialogue script generation
- `CharacterOverlay` component and the `character-explainer` generator

## Steps
1. Seed `character_pairs(id, name, explainer{characterId,voiceId}, interrupter{characterId,voiceId}, tone, minPlan)` with at least 4 original pairs. Each character needs `neutral`, `talking` and `reaction` artwork.
2. Dialogue generation: LLM returns ordered lines `{ speakerRole, text, beat }` with `beat` ∈ `hook | setup | question | payoff | cta`.
3. Pacing rules enforced in code: lines under ~12 words, speaker alternation at least every ~4 seconds, hook in the first 3 seconds, punchline ending. Re-prompt once if the model returns a monologue, then fall back to alternating by sentence.
4. Generator: one narration item plus one `characterOverlay` item per line, sharing start and duration; coalesce avatar state changes shorter than the flicker threshold.
5. `CharacterOverlay` component: positions the avatar, switches `neutral`/`talking`, plays `reaction` on marked beats, with a name tag.
6. Optional per-speaker caption colouring, always paired with a name tag so colour is not the only signal.
7. Wizard: pair picker with a sample exchange preview; line-level speaker reassignment in the script step.
8. Paid tier: custom character from uploaded original artwork plus a library voice, with an ownership attestation and moderation.

## Acceptance criteria
- A topic produces an alternating two-speaker dialogue with no monologue blocks.
- Each avatar is in the `talking` state exactly during its own lines.
- Generation is blocked if any line's speaker has no voice or avatar.
- Editing one line regenerates only that line's audio and overlay timing.

## Out of scope
Lip sync, full-body animation, cloned or third-party character voices (never).
