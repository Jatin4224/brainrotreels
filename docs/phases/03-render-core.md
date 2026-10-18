# Phase 03 — Render core

**Depends on:** Phases 01, 02.

## Goal

One Remotion composition turns a timeline document into frames, and the same components drive the
browser preview. Preview and final output match because they are the same code over the same
document — only the media differs.

## Registry

None.

## Data

None.

## Build

1. **Set up Remotion** in `src/remotion/`. Composition `TimelineRenderer`, 1080×1920 at 30fps, with
   duration derived from the document rather than hard-coded.
2. **Walk, don't branch.** `TimelineRenderer` iterates `doc.tracks` and maps each item's `render`
   field through a **component registry** — `src/remotion/registry.ts`, a plain record from render
   type to component. Later phases add `Captions`, `RedditCard`, `QuizCard`, `MotionScene` and
   `AvatarOverlay` by adding a key. Nobody edits `TimelineRenderer` again.
3. **Unknown types draw nothing.** An unrecognised `render` value logs a warning and renders `null`.
   A malformed item must never crash a paid render; a missing element is recoverable, a failed
   render is money gone.
4. **Component families for this phase:** `MediaClip` (video or image, `fit: cover`, looping,
   muting, optional Ken Burns), `TextOverlay`, and audio items with gain and an optional ducking
   curve.
5. **Asset resolution.** Items carry `assetId`, never a URL. A resolver takes the document, collects
   every `assetId`, and produces a signed-URL map passed into the composition. Signing happens at
   preview time and at render time separately, with different TTLs.
6. **Fonts are bundled locally.** No network fonts — a font that fails to load mid-render produces a
   silently wrong video. Preload all media before the first frame.
7. **Preview page.** `/dashboard/projects/[id]/preview` using Remotion Player, reading `proxy_480`
   variants so scrubbing stays smooth. The page is a server component; the player is a client child.
8. **Deterministic output.** Given the same document and the same assets, rendering twice must
   produce identical frames. Anything reading `Date.now()` or `Math.random()` inside a component
   breaks Phase 04's render reuse — forbid it and note why.
9. **A local render script** rendering a committed fixture to an MP4, so the pipeline is testable
   without Lambda.
10. **Snapshot tests** on three frames — first, middle, last — of the fixture.

## Contracts

```tsx
<TimelineRenderer doc={resolvedDoc} assets={signedUrlMap} />

// src/remotion/registry.ts
export const RENDER_COMPONENTS: Record<RenderKind, React.ComponentType<RenderItemProps>> = { ... }
export type RenderKind = 'media' | 'motion' | 'quizCard' | 'redditCard' | 'characterOverlay' | 'text'
```

Captions never store text. They reference word ranges and read from `doc.words`.

## Done when

- [ ] A fixture document with a background video, a text overlay and an audio track renders to a
      playable 9:16 MP4 locally.
- [ ] The same fixture previews in the browser through Remotion Player using proxies.
- [ ] Removing the music track, or the overlay, still renders correctly.
- [ ] An item with an unknown `render` value logs a warning and the render completes.
- [ ] Rendering the same document twice produces byte-identical frames.
- [ ] Adding a new component family requires editing only `src/remotion/registry.ts`.

## Not in this phase

Cloud rendering (Phase 04), captions (Phase 08), motion scenes, quiz and Reddit cards, watermarks.
