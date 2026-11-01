> **SUPERSEDED AS A BUILD PLAN.** This file is retained as *product intent* — what this
> format should do and why. Its stack, repository layout and phase numbering describe a
> Turborepo/Drizzle monorepo that was never built. The authoritative build order is
> `docs/phases/00-README.md`, and this pack is built as **`docs/phases/18-product-explainer.md`**
> against the real Next.js + Prisma + tRPC codebase.

# Phase 19e — Product explainer pack

## Goal
Generate motion graphics explainers in the "how this product is built" style: a persistent top HUD of section chips and a running counter, a character pinned in the corner, word-chunk captions, and one designed artifact per beat (isometric stack, browser frame, terminal, pipeline, world map, app mockup, list rows, section title).

Reference output: a 24-second reel, roughly 25 beats, one visual per second of narration, cream and amber art direction.

## Depends on
Phase 19a (layout engine), 19b (primitives), 19c (styles), 19d (AI designer), Phase 15 (character overlay).

## Deliverables
1. Timeline document changes: a persistent HUD track and a section model.
2. Ten new primitives (the product explainer catalog).
3. A storyboard prompt and intent vocabulary for product walkthroughs.
4. A `cream-amber` style preset.
5. QA rules extended for persistent elements.

---

## 1. Timeline document changes (`packages/timeline`)

### 1.1 Sections
Scenes are grouped into ordered sections so the HUD and title cards stay in sync.

```ts
type Section = {
  id: string;
  index: number;          // 1-based, used by SectionTitle ("LAYER 03 / 05")
  label: string;          // "FRONTEND"
  title: string;          // "Cloudflare Pages"
  startWord: number;
  endWord: number;
};
```
`doc.sections: Section[]`. Every scene item gains `sectionId`. Validation: sections cover all words, no overlaps, every scene belongs to exactly one section.

### 1.2 Persistent track
A new track type `persistent` whose items render above every scene for a word range, not inside one scene.

```ts
{ "id": "hud", "type": "persistent", "items": [
  { "id": "chips", "render": "sectionChips", "anchor": "top", "props": { "showIndex": true } },
  { "id": "bill",  "render": "valueCounter", "anchor": "top-right",
    "props": { "label": "BILL", "format": "currency", "keyframes": [
      { "at": { "wordIndex": 0 }, "value": 0 }, { "at": { "wordIndex": 180 }, "value": 0 } ] } },
  { "id": "char",  "render": "characterOverlay", "anchor": "bottom-right",
    "props": { "characterId": "ch_01", "state": "talking" } }
]}
```

Rules:
- Persistent items reserve space. The layout engine subtracts their boxes from the usable area so scene content can never sit under the HUD, the character, or the caption zone.
- Persistent items are excluded from the per-beat overlap check against each other, but scene elements overlapping them is still an error.
- `resolveAnchors` handles `keyframes` the same way as element timing.

### 1.3 Reserved zones
Add to the layout engine: `zones = { hudTop, captionBottom, characterCorner }`, each a fraction of the canvas, configurable per style. Scene layouts receive the remaining rectangle.

---

## 2. Primitives (extends Phase 19b)

All take `style` tokens, a `box` from the layout engine, and `enterAt` / `exitAt` word anchors. All must render legibly at 1080×1920 and 1920×1080.

| Component | Props | Animation |
|---|---|---|
| `SectionChips` | `sections[]`, `activeSectionId`, `showIndex` | Row of monospace chips; active chip fills with accent; row scrolls horizontally so the active chip stays visible; inactive chips dim |
| `ValueCounter` | `label`, `value`, `format` (`currency`/`number`/`percent`), `keyframes[]`, `tone` | Pill with label and value; digits roll on change; brief accent flash on update |
| `IsoStack` | `layers[{ label, caption, iconId, highlighted }]`, `spread`, `activeIndex` | Isometric stacked planes drawn back to front; each enters on its own anchor; active layer lifts and brightens, others fade |
| `BrowserFrame` | `url`, `typedUrl`, `secure`, `content` (child mockup or image asset), `chrome` (`full`/`urlOnly`) | URL types character by character; padlock fades in when `secure` flips; window scales in |
| `AppMockup` | `windowTitle`, `layout` (`board`/`list`/`settings`/`dashboard`), `columns[]`, `rows[]`, `accent` | Structured fake UI built from props only — never free-form generated layout; items stagger in; optional cursor move and click |
| `Terminal` | `lines[{ prompt, command, output, at }]`, `cwd` | Monospace window; commands type out at their anchors; output appears after a short beat; cursor blinks |
| `PipelineStepper` | `steps[{ label, iconId }]`, `activeIndex`, `connector` (`line`/`arrow`) | Horizontal steps; connector draws between them; active step scales and tints; completed steps tick |
| `WorldMap` | `points[{ x, y, label?, pulse? }]`, `routes[{ from, to }]`, `density` | Dotted-grid map; points pop in; routes animate along a path; optional slow drift |
| `ListRows` | `title`, `rows[{ label, meta, status, tone }]`, `highlightIndex` | Card with rows entering top to bottom; status pills colour by tone; highlighted row tints |
| `SectionTitle` | `index`, `total`, `label`, `title`, `iconId` | Full-bleed chapter card: small monospace eyebrow (`LAYER 03 / 05`), serif title, optional icon; cross-fades into the next scene |

Implementation notes:
- Icons come from the bundled MIT icon set; `iconId` is validated against a catalog so the model cannot invent names.
- `AppMockup` is deliberately prop-driven. Generating arbitrary interfaces is out of scope: the model picks a layout and supplies text, nothing more.
- Every component must render with missing optional props (no crash, no empty frame).
- Build a gallery page with hand-written scenes for all ten before wiring the AI designer.

---

## 3. Storyboard and designer changes (extends 19d)

### 3.1 Intents
Add to the intent vocabulary: `sectionTitle`, `stack`, `browser`, `terminal`, `pipeline`, `map`, `mockup`, `rows`, `counterUpdate`.

### 3.2 Storyboard prompt
For `kind: product-explainer` the storyboard step must:
1. Detect the enumerated items in the script (the "five tools") and emit one section each, plus an intro and an outro section.
2. Open every section with a `sectionTitle` beat of about 1.2 seconds.
3. Keep beats at roughly one per second of narration, between 0.8 and 3 seconds.
4. Prefer a concrete artifact over text: when the script names a command, a URL, a dashboard or a place, choose `terminal`, `browser`, `mockup` or `map` rather than `emphasis`.
5. Emit `counterUpdate` events when the script mentions cost, count or progress.
6. Never repeat the same primitive in three consecutive beats.

### 3.3 Beat designer
The catalog passed to the model includes the ten primitives above with their exact prop schemas. The model fills props with content drawn from the script only. Validation rejects invented `iconId`s, URLs not present in the script, and prop sets that exceed the element budget per beat.

---

## 4. Style preset (extends 19c)

`cream-amber`:

```json
{
  "palette": { "bg": "#F4F1EA", "surface": "#FFFFFF", "line": "#DAD5C9",
               "ink": "#1A1917", "muted": "#8A8578", "accent": "#D96F32", "ok": "#2F7D5B" },
  "fonts": { "display": "serif-display", "body": "sans", "mono": "mono" },
  "radius": 10, "stroke": 1, "shadow": "soft",
  "motion": "snappy",
  "captions": { "preset": "pill-white-bold", "positionY": 0.74 },
  "zones": { "hudTop": 0.08, "captionBottom": 0.20, "characterCorner": 0.22 },
  "musicMood": "light-electronic"
}
```
Validate contrast for ink-on-bg, ink-on-surface and accent-on-bg; all must pass WCAG AA. (The
original draft carried `muted` as a placeholder string; `#8A8578` is the real value.)

---

## 5. QA additions (extends 19d checks)

Deterministic:
- No scene element intersects a reserved zone.
- The active chip in `SectionChips` always matches the current section.
- `ValueCounter` keyframes are monotonic in time and inside the video duration.
- Terminal and browser text fits without wrapping mid-token.

Visual (vision model):
- The HUD, character and captions are all simultaneously legible.
- The artifact on screen matches what the narration says at that moment.
- No two consecutive beats look near-identical.

---

## 6. Acceptance criteria

- A product-walkthrough script with five named tools produces five sections, each opening with a numbered title card, with the chip row advancing correctly.
- The HUD and character stay on screen for the entire video and never overlap scene content or captions.
- At least six of the ten new primitives appear across a 25-beat test video, with no primitive repeated three beats in a row.
- A spoken URL appears in a `BrowserFrame` and a spoken command appears in a `Terminal`, with typing synced to the words.
- The `cream-amber` preset renders with AA contrast on every text element.
- A 25-beat, 25-second video finishes generating in under 10 minutes and passes all QA checks without manual fixes.

## 7. Out of scope

- Generating arbitrary product UI screenshots (use `AppMockup` props, or let the user upload a real screenshot as an asset).
- Animated 3D or camera moves through the isometric stack.
- Lip-synced characters (the corner character uses discrete state swaps).
- Importing a real dashboard by URL.

## 8. Effort

About 1.5–2 weeks on top of Phase 19: roughly one week for the ten primitives, two to three days for the HUD and section model in the timeline package, and two to three days tuning the storyboard prompt, style preset and QA rules.
