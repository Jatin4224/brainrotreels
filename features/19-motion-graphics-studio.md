> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, written against the real Next.js + Prisma + tRPC codebase.

# Phase 19 — Motion graphics studio (largest phase)

## Goal
Animated explainers where the AI designs every frame: no keyframing, no templates, nothing overlapping.

## Depends on
Phases 07, 10, 13.

## Deliverables
- Scene language and layout engine
- 8–10 animated primitive components
- Style token system
- Storyboard, beat designer and quality checks

**Work this phase in four commits: 19a layout engine, 19b primitives, 19c styles, 19d AI designer. Each is independently reviewable.**

## Steps
### 19a — Scene language and layout engine
1. Extend the timeline scene item with `layout` plus `elements[]`, where every element times itself by word anchor.
2. Named layouts only: `stack-center`, `split-2`, `grid-3`, `hero-plus-caption`, `flow-graph`. No coordinates from the model.
3. Text measuring with the real bundled fonts; safe zones per aspect ratio; auto-layout for graphs using elkjs or Dagre.

### 19b — Primitives
4. Build `Title/KineticText`, `Counter`, `Meter`, `BarChart`, `Compare`, `List`, `FlowGraph`, `Icon`, `Callout`. Typed props, entrance and exit animations, style tokens.
5. Build a gallery page of hand-written scenes to review each primitive before any AI is connected.

### 19c — Styles
6. Style tokens: palette, two fonts, radius, stroke, motion personality, caption treatment, music mood. 6–10 library styles.
7. "Design one for me": three questions → LLM proposes tokens → code validates contrast and bundled fonts.

### 19d — AI designer
8. Storyboard: split the aligned transcript into beats (1.5–6 s, snapped to words) with an intent (`title`, `stat`, `meter`, `flow`, `compare`, `list`, `emphasis`). Validate full coverage, no gaps.
9. Beat designer: per beat, the LLM receives words, intent, style, aspect and the primitive catalog, and returns a scene. Fan out in Inngest; cache the long system prompt; throttle to stay inside API rate limits.
10. Checks: schema, anchors exist, measured text fits, no overlaps, safe zones, element count. Then render 2–3 stills and ask a vision model to flag clutter, cut-off text or off-topic visuals.
11. Repair loop: send specific errors back, maximum two attempts, then fall back to a safe `emphasis` beat so the pipeline always finishes.
12. Beat strip on the project page: each beat as a still, with "redesign this beat" re-running one beat only.
13. Separate credit pricing for motion, since cost per video is several times higher.

## Acceptance criteria
- Across 20 test videos, no rendered beat has overlapping or cut-off content.
- Every number or diagram appears on the word that introduces it.
- A 60-second motion video finishes in under 10 minutes.
- Redesigning one beat does not re-run the others.
- Motion videos are priced and metered separately from other formats.

## Out of scope
Generated animation code, 3D, presenter characters.
