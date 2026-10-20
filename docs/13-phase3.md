<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 03 — render core

`docs/11-phase1.md` describes the timeline document and `docs/12-phase2.md` the media behind its
asset handles. This page describes the thing that turns both into frames: one Remotion
composition, `TimelineRenderer`, which the browser preview and the final render share.

Read this before Phase 04 (cloud rendering runs this composition on Lambda), Phase 08 (captions
add a layer to it) and Phases 12–16 (each adds a component family). Read **Walk, don't branch**
first — it is the rule that decides whether those later phases are one file each or a growing
switch statement.

## The one-sentence version

The composition walks a flat, frame-addressed **plan** derived from the document and looks each
item's `render` value up in a **registry**; preview and output differ only in which asset variant
each handle resolves to; and nothing in the render path may read the clock or a random number.

## Where the code lives, and why it is split

| Folder | Contains | Imports Remotion? |
| --- | --- | --- |
| `src/lib/render/` | the frame plan, the ducking curve, the sanitiser | **no** |
| `src/remotion/` | the composition, the registry, the components | yes |
| `src/lib/types/render.ts` | every shared type and schema | no |

The split is the same argument as `src/lib/timeline`'s purity. `src/lib/render/` takes a document
and returns a draw list, so the questions worth asking about a renderer — *is this item on screen
at frame 412, what order do the layers stack in, where does a loop restart* — are answerable in a
unit test with no browser, no Chrome and no ffmpeg. Phase 15's editor needs those same answers to
draw its ruler and must not import a composition to get them.

It is also where determinism becomes enforceable: the plan is a pure function of the document, so
"two renders of one document are identical" reduces to "the components draw the plan faithfully",
which is a much smaller thing to trust.

Types live in `src/lib/types/render.ts` because CLAUDE.md puts every custom type there — and
because Phase 04 needs `AssetUrlMap` and `RenderQuality` without importing Remotion.

## Rule 1 — walk, don't branch

`TimelineRenderer` contains no `if (kind === 'redditCard')` and must never gain one. It walks the
plan, looks `render` up in `RENDER_COMPONENTS`, and renders what it finds:

```ts
// src/remotion/registry.ts — the whole extension point
export const RENDER_COMPONENTS: Partial<Record<RenderKind, ComponentType<RenderItemProps>>> = {
  media: MediaClip,
  text: TextOverlay,
}
```

Adding a format is a component plus a key here. Phases 12, 13, 14 and 16 each do exactly that and
none of them touches the composition. The moment a format name appears in the walker that property
is gone, and every future format pays for it.

Two things that look like exceptions and are not:

- **`Partial<Record<…>>`, not a full Record.** A `RenderKind` with no component yet is a
  documented gap rather than a compile error, so this phase ships `media` and `text` without four
  stub components that draw nothing — stubs would be indistinguishable from the fallback and would
  hide which families actually exist.
- **The walker branches on TRACK TYPE for audio.** An audio item has no `render` field at all
  (there is nothing to choose between), so it is dispatched directly to `AudioClip`. The rule
  forbids branching on FORMAT, which is what grows with every phase; track types have been fixed
  at five since Phase 01.

### Unknown kinds: two different failures, both handled

| What arrives | Handled by | Result |
| --- | --- | --- |
| `redditCard` — in the union, no component yet | the registry's fallback | warns once, draws nothing |
| `someFutureThing` — not in the union at all | `dropUnknownRenderKinds` | item removed before parsing, warns, rest renders |

The second needed a fix the brief did not anticipate. `timelineDocSchema` is `.strict()` with a
closed enum, which is right for everything that *writes* a document and wrong for the thing that
*renders* one:

> a document written by a newer release → rendered by a worker still on the old one →
> `render: 'newThing'` fails the whole parse → **the customer's video comes out black**

So the sanitiser drops those items *before* the strict parse. It drops rather than rewrites them
to a known kind: rewriting to `media` would draw the asset in a way the newer release never
intended, so instead of a missing element the customer gets a wrong one, which nobody can look at
and diagnose. Grep `ONE_BAD_ITEM_IS_NOT_A_BAD_DOCUMENT`.

Both paths were exercised in a real render, and both logged exactly one line.

## Rule 2 — the plan, and the order things stack in

`planTimeline(doc)` flattens every track into `PlannedItem`s carrying frames rather than seconds.
Converting once, here, is what stops two components rounding the same boundary differently and
producing a one-frame flicker between them.

**Composite order is per-type first, then document order.** `LAYER_ORDER` gives video → scene →
overlay → caption a fixed floor, because a generator is free to list its tracks in any order (the
Reddit fixture puts its scene track before its audio) and relying on authoring order alone would
let one accidentally bury its captions under a background. Within a type, ties break on the item's
position in the document, and overlays additionally sort by their own `z`.

Sorting everything globally by `z` was the obvious alternative and it is wrong: only overlays
declare `z`, so every other item would collapse to one depth and the lane structure the document
spent five track types describing would stop meaning anything.

The comparator is **total** — layer, then `z`, then document order — and that matters more than it
looks. Phase 04 reuses a render when the document hash matches, so an unstable sort would produce
two different videos from one hash.

Two items never reach the plan:

- **An item whose span does not resolve.** `resolveWordAnchors` deliberately leaves a dangling
  anchor in place, so the renderer must not invent a time for it: an item at frame 0 that belongs
  at 0:42 is a *wrong* video, while a missing one is a visibly incomplete one. Grep
  `SKIP_UNRESOLVED_ITEM`.
- **A zero-length item**, which would draw nothing anyway and would make the frame-visibility
  maths lie about what is on screen.

`planFrame(doc, frame)` filters that list with a **half-open** window, `[from, from + duration)`,
matching `<Sequence>` exactly. An inclusive end would double-draw one frame wherever two items sit
back to back — the normal case for captions.

## Rule 3 — frames inside a component are relative

The walker mounts each item in its own `<Sequence from={plan.from}>`, so `useCurrentFrame()` inside
a component starts at **0 for that item**. An animation's progress is therefore
`frame / (durationInFrames - 1)` with no offset arithmetic.

This is written on `RenderItemProps` as `FRAMES_ARE_RELATIVE_INSIDE` because the first version of
`MediaClip` subtracted `frames.from` as well and pushed every Ken Burns progress negative. The
only thing that needs the absolute frame is a comparison against a window elsewhere in the
document — which is exactly what audio ducking does.

## Rule 4 — looping, and why audio is different

| Case | Mechanism |
| --- | --- |
| video shorter than its item | Remotion's `<Loop>` |
| ducked audio shorter than its item | explicit `<Sequence>` per repetition |

Never the element's own `loop` attribute: Remotion renders frames out of order and in parallel, so
an element with an internal playhead has nothing reliable to read. `<Loop>` mounts the repetition
belonging to the current frame, which keeps a frame a pure function of its number.

Ducked audio cannot use `<Loop>` at all, and the reason is worth remembering because it is
invisible until you listen: a `<Loop>` child cannot tell *which* repetition it is — the frame it
sees restarts at 0 each time — so a ducking curve inside one would reset every few seconds and duck
against the wrong part of the narration. Laying the repetitions out by hand is what makes each
one's absolute offset knowable. Grep `EXPLICIT_REPETITIONS_FOR_DUCKED_LOOPS`.

## Rule 5 — ducking is computed, never stored

The document stores `duck: true`, not a volume curve, and the timeline schema says why: encoding
the curve would freeze it against narration that has not been recorded yet. `duckingVolumeAt()`
computes it from where the narration actually is, so re-recording a line re-ducks the music with no
document change.

Three decisions inside it:

- **Narration is an audio item that names a `speaker`.** Not a track called "narration" — that
  would make the mix depend on a label a generator can change and the editor lets a customer
  rename.
- **An item that asks to be ducked is excluded from its own windows**, so it cannot duck against
  itself and sit at 25% for its whole duration. That happens the first time someone marks a
  narration line `duck: true` by mistake.
- **The deepest duck wins** when windows overlap, and the ramp is 150ms. Taking the last window,
  or averaging, would let the bed swell in the gap between two sentences — audible as a pump; a
  hard switch would be audible as a click.

## Rule 6 — determinism, guarded twice

Phase 04 reuses a render whenever the document hash matches. A component that reads the clock or a
random number therefore makes a **cached** render differ from a **fresh** one: two customers paying
for the same video and receiving different files, with nothing in the document to explain it. The
same values are not even stable *within* one render, because frames are rendered out of order
across several processes.

So `Date.now`, `new Date()`, `Math.random`, `performance.now`, `crypto` and locale formatting are
banned across `src/remotion/**` and `src/lib/render/**` by:

1. an **eslint rule**, which names the reason in the error message, and
2. **`determinism.test.ts`**, which reads the files and asserts the same thing — because a lint
   rule is skippable by a disable comment, a config that stops matching the path, or
   `--no-verify`, and this one must not be.

Both were probed with a throwaway `Math.random()` in a component: eslint rejected it by rule name
and the test failed naming the file.

The test **strips comments before scanning**, which is not a convenience: every file on this path
documents the determinism rule, so the forbidden calls appear by name in the very comments
explaining why they are forbidden, and a raw scan fails on the most careful files.

**Verified empirically:** rendering the fixture twice produced byte-identical MP4s — stronger than
the brief's "identical frames".

## Assets: the document never holds a URL

`doc.assets` holds Asset row ids and licences, never URLs, because a URL is signed per request and
a stored one is a leak with an expiry date. The renderer therefore takes a **second input**: the
document says *which* asset, the `AssetUrlMap` says *where it is right now*.

```
collectAssetHandles(doc)        pure — every handle in doc.assets
  → signDocumentAssets(…)       one query, then a signature per handle
    → { [handle]: ResolvedAsset }
```

`VARIANT_BY_QUALITY` is the pairing architecture.md calls the reason preview and output match:

| Quality | Variant | TTL | Used by |
| --- | --- | --- | --- |
| `preview` | `proxy_480` | 30 min | the browser Player |
| `final` | `vertical_1080` | 6 hours | Phase 04's render |

The TTLs differ for a concrete reason: a preview URL only has to outlive a scrubbing session,
while a final URL is handed to a renderer that may queue behind other jobs and then spend minutes
fetching — and Phase 04 runs that render somewhere this process cannot re-sign for.

**A missing variant falls back to the original**, and for audio that is the *normal* path, not a
degradation: the ingest builds a waveform for audio and nothing else, so narration and music have
no proxy and no master by design. The returned `variant` field records which happened, so a
deliberate fallback is distinguishable from an accidental one.

**`url` is nullable and every component handles it.** An ingest still running, an asset deleted
after the document referenced it, and a signing refusal all produce it. A renderer that threw on
any of them would turn one missing clip into a failed paid render. Grep
`MISSING_ASSET_IS_NOT_AN_ERROR`.

## Fonts are bundled, and they block the first frame

`public/fonts/` holds two Geist woff2 files, copied from the pinned `@fontsource/geist-sans` dev
dependency rather than downloaded — the same typeface `next/font/google` self-hosts for the app UI,
so a caption in the editor and the same caption in the finished video are the same face.

There is **no network font and there must never be one**. A font that 404s or times out mid-render
produces a video that is silently wrong — every text element falls back to a different face, the
render succeeds, and nobody notices until a customer does. Phase 04 renders on Lambda, where a font
CDN is one more thing that can be unavailable per invocation.

`loadRenderFonts()` uses `delayRender()`, which is what makes it correct rather than merely likely:
without it Remotion screenshots frame 0 while the face is still loading, so the first frames use
the fallback and the rest do not. The handle is cleared in **both** the success and failure paths —
an uncleared handle hangs the render at 0% until a Lambda timeout, which costs money and produces
nothing.

Verified in the browser: both faces report `GeistRender:loaded`.

## The studio, the local render, and the dev media

```bash
npm run remotion:studio    # all four fixtures, playable
npm run remotion:render    # out/reddit-story.mp4
```

The compositions **are** the timeline fixtures. `src/lib/timeline/fixtures/` already declares
itself production data with three consumers, and this is the third — so the studio renders the same
documents the validation tests assert on, and a schema change cannot pass the tests while breaking
the renderer. Iterating `FIXTURES_BY_KIND` means a fifth project kind appears automatically.

Every fixture goes through `resolveWordAnchors()` first (`voiceover` is deliberately anchored), and
`durationInFrames` comes from `planComposition()` rather than a constant — a hard-coded length
silently truncates any document longer than the guess, and the failure is a video that ends
mid-sentence.

`public/dev-assets/` holds ~110 KB of synthetic ffmpeg output (test-pattern video, sine tones, a
flat PNG) standing in for the fixtures' handles, which point at Asset rows that exist in nobody's
database. They resolve **by asset kind, not by handle name**, so every present and future fixture
works with no maintenance. The video is deliberately *shorter* than the narration, because that is
what exercises looping.

### Two wrinkles

- **`remotion render --props=<file>` builds a bundle whose `public/` is missing**, so
  `staticFile()` URLs 404 under that flag while the identical URL resolves in a normal render. It
  does not affect `npm run remotion:render`, the studio, the Player or Phase 04's Lambda path.
- **The studio says "Can't save default props"** for every composition, because they are registered
  in a `.map()` rather than as static literals. That only stops the studio writing prop edits back
  into `root.tsx`.

## The preview page

A server component renders the layout; a client child mounts `<Player>`. The player is handed
**`TimelineRenderer` itself** — the identical component the CLI and Lambda use — so the preview is
not an approximation of the output, it *is* the output at a different resolution.

`compositionWidth`/`compositionHeight` are the **document's** canvas, with the on-screen size
handled by `style`. Passing the on-screen pixels instead would render the document at 400×711,
silently changing every normalized box's pixel result and making the preview disagree with the
render.

The page is gated with no code of its own: `ROUTE_AUTHORIZATION` in the dashboard layout matches
the pathname against the registry's nav entries, longest href first, so `/dashboard/projects/...`
inherits `projects` and its default `read` permission.

Its two empty states are deliberately **not** merged: a project with no timeline has simply not
been generated yet, while a timeline that cannot be migrated is a broken record the customer cannot
fix and support needs to hear about. Collapsing both into "no preview" is how the second goes
unreported.

## Status

Phase 03's box in `docs/phases/PROGRESS.md` is **unticked**, and the reason is narrow.

What is verified: a real 1080×1920/30fps/228-frame MP4 with audio, rendered from a
document-derived duration and **looked at**; byte-identical output across two renders; all four
fixtures rendering, including ones with no music bed, no overlay track, and no spine at all; both
unknown-kind paths logging and continuing in a real render; both determinism guards probed with a
real violation; browser playback in the studio with video decoding, two audio elements and both
font faces loaded; and the preview page returning 200 against a real project.

What is not: **the `<Player>` has never been handed a real document**, because nothing in the
product can create a `Timeline` row yet — `projects.create` writes the project only, and generation
is Phase 06/09. The preview page always shows its empty state today. The composition it would mount
is the one the CLI renders and the studio plays, so what is untested is the binding in
`project-preview.tsx`, not the rendering. And **no render has used a real R2 asset**, for the same
reason Phase 02 is unticked.

## What Phase 03 did not finish

- **Captions are planned but not drawn.** A caption item has no `render` field
  (`WORD_RANGE_NOT_TEXT`), so it reaches the composition with `render: null` and draws nothing. It
  is still in the plan, and a test locks that — Phase 08 adds the caption layer and will read those
  same spans.
- **Four render kinds have no component:** `motion` (Phase 16), `quizCard` (Phase 13), `redditCard`
  (Phase 12), `characterOverlay` (Phase 14). Each warns once and draws nothing.
- **Preloading is partial.** Fonts block the first frame; media does not, so Remotion's own
  buffering is what covers it. If a cold first frame ever shows a gap on Lambda, this is the thing
  to add.

## Where to go next

`docs/phases/04-cloud-rendering.md` — the same composition on Lambda, behind an interface so a
self-hosted renderer can replace it. Three things from this phase it depends on directly:

- **`planComposition()`** gives the frame count to bill on.
- **`final` quality** gives `vertical_1080` URLs with a six-hour TTL, because a queued render may
  fetch its media hours after the URLs were signed.
- **Determinism is what makes render reuse safe.** `docHash` deduplication assumes the same
  document produces the same file; the two guards in this phase are what keep that assumption true.
