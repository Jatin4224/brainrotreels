# Phase 18 — Product explainer pack

**Depends on:** Phases 08, 09, 12, 16.

> The old plan called this **19e**, a tail commit on its Phase 19. In this repository Phase 16 is
> the motion studio and all four of its commits are built, so the pack is its own phase and its own
> number. `features/19e-product-explainer-pack.md` is the product-intent reference; this file is the
> build order.

## Goal

Motion explainers in the "how this product is built" style: a persistent top HUD of section chips
and a running counter, a character pinned in the corner, word-chunk captions, and **one designed
artifact per beat** — an isometric stack, a browser frame, a terminal, a pipeline, a world map, an
app mockup, list rows, a chapter card.

Reference output: a 24-second reel, roughly 25 beats, one visual per second of narration, cream and
amber art direction.

Phase 16 proved the model can design a *scene*. This phase makes it design a *walkthrough*: the
frame now carries furniture that outlives the beat, and a beat's job becomes "draw the thing the
narration just named" rather than "render this sentence attractively".

**Land it in four reviewable commits** — 18a the section model and the persistent lane, 18b the ten
artifact primitives and their gallery entries, 18c the `cream` palette and the `cream-amber` style,
18d the storyboard and designer changes. 18a–18c are testable with no model attached, exactly as
16a–16c were.

## Registry

**No new resource.** The pack is gated by `motionStudio` and metered by `motionVideos`
(`src/lib/resources.ts:1061` and `:1126`), unchanged.

That is a decision, not an omission. `motionVideos` exists because motion's cost shape is per-beat
model calls plus still renders plus a vision pass — and a product explainer is *the same shape*,
just more beats of it. A second limit would ration the same spend twice and let a workspace with
motion videos left be refused a product explainer for no reason a user could explain. If per-beat
cost ever diverges, the lever is the credit rate in Phase 05, not a new registry key.

`motionStudio.rateLimit` already covers `designStyle` and `redesignBeat`, which are the two
procedures this phase re-uses. Add no keys; a `rateLimit` key that names no procedure is a limit
that silently never applies.

## Data

**No migration.** Two Prisma columns absorb everything:

- `Project.kind` is a `String` column (`STRING_NOT_ENUM`), so the new format is a tuple entry in
  `PROJECT_KINDS`, not a schema change.
- `Project.settings.motion` already stores the storyboard (`readMotionSettings`,
  `src/lib/generators/motion.ts`). Sections go in the same block, beside `beats`.

**No timeline document version bump either** — verify this before you rely on it, then keep it true.
`ADDING_A_KIND_IS_NOT_A_MIGRATION` (`src/lib/timeline/schema.ts`) holds that a new enum value or a
new *optional* field does not bump `TIMELINE_DOC_VERSION`. Everything 18a adds is one of those two:
`doc.sections` is optional, `sectionId` on a scene item is optional, and `persistent` is a new value
in `TRACK_TYPES`. A v4 document written by Phase 16 stays valid and renders identically. If you find
yourself reaching for a required field, stop and argue it in `PROGRESS.md` first — a version bump
costs a migration step, a fixture and a round-trip test, and this phase does not need one.

---

## Build

### 18a — The section model and the persistent lane

1. **`Section` in `src/lib/types/scene.ts`**, beside `Beat` — the two are the same kind of thing at
   two scales, and splitting them across files is how a storyboard ends up with two sources of
   truth.

   ```ts
   export const sectionSchema = z.object({
     id: idSchema,
     index: z.number().int().min(1),   // 1-based; SectionTitle renders "LAYER 03 / 05"
     label: z.string().trim().min(1).max(40),   // "FRONTEND"
     title: z.string().trim().min(1).max(80),   // "Cloudflare Pages"
     startWord: z.number().int().min(0),
     endWord: z.number().int().min(0),
   }).strict();
   ```

2. **`doc.sections`** — optional on `timelineDocSchema`, and `sectionId` optional on
   `sceneItemSchema`. Validation in `src/lib/timeline/validate.ts`, using the existing error
   vocabulary where it fits and new codes where it does not: sections cover every word with no gap
   and no overlap, `index` values are `1..n` with no duplicates, every word range is inside
   `doc.words`, and a scene item's `sectionId` names a section that exists. A scene that belongs to
   no section is **legal** — the intro and outro furniture does not need one — but a scene whose
   `sectionId` is dangling is an error, the same asymmetry `UNKNOWN_ASSET` already has.

3. **The `persistent` track type.** A sixth lane in `TRACK_TYPES` whose items draw above every scene
   for a word range rather than inside one scene.

   ```ts
   export const persistentItemSchema = z.object({
     ...itemBaseShape,
     render: renderKindSchema,
     anchor: persistentAnchorSchema,   // "top" | "top-right" | "bottom-right" | "bottom-left"
     z: z.number().int(),
     props: z.record(z.string(), jsonValueSchema).optional(),
   }).strict();
   ```

   Three rules the lane has to carry, each of which is a test:

   - **It does not extend the video.** `SPINE_TRACKS` in `src/lib/timeline/time.ts` stays video plus
     audio, so `documentLength()` is unchanged and a persistent item past the spine is a validation
     error, exactly as an overlay past it already is (`VIDEO_LENGTH_RULE`).
   - **It reserves space** (step 4).
   - **It is excluded from the per-beat overlap check against its own siblings** — two HUD items at
     different anchors never overlap by construction, and `ELEMENT_OVERLAP` between them would be a
     false positive. A *scene* element overlapping a persistent item stays an error, which is the
     whole point of reserving the space.

4. **Reserved zones in the layout engine.** `safeRectFor()` (`src/lib/scene/layouts.ts:103`) gains
   the zones and returns the rectangle that is left:

   ```ts
   export interface ReservedZones { hudTop: number; captionBottom: number; characterCorner: number }
   ```

   Fractions of canvas height (and width, for the corner), subtracted *after* the Phase 08 safe-zone
   insets, because the safe zone is the platform's constraint and the zones are ours. Default every
   zone to `0`, so every existing caller — all ten Phase 16 primitives, the gallery, the still
   renderer — keeps its current geometry with no edit. Then prove it: a test that `layoutScene()`
   over a 16b fixture with zeroed zones returns rectangles **byte-identical** to today's.

5. **`resolveSceneAnchors` handles keyframes.** The counter's `keyframes[]` time themselves by word
   anchor like every other element (`sceneTimeValueSchema` already accepts `{ wordIndex }`), so they
   resolve through the same path rather than a second one.

6. **Baking, because a render component never sees the document.** `RenderItemProps` hands a
   component its *item* (`src/lib/types/render.ts:236`), so `SectionChips` cannot read
   `doc.sections` — the generator must write the section list onto the chips item's `props`, the way
   `src/lib/generators/reddit-story.ts` bakes avatar state spans. Snapshot the `{ id, index, label }`
   of every section plus the word range that makes each one active. This is the single easiest thing
   in the phase to get wrong, because it type-checks either way and only shows up as an empty HUD.

### 18b — The ten artifact primitives

7. **Extend `SCENE_PRIMITIVES` from ten to twenty** and add a schema per primitive to
   `sceneElementStrictSchema`. `MOTION_PRIMITIVES` in
   `src/remotion/components/motion-scene/canvas.tsx:73` is a `Record`, not a `Partial<Record>`, so
   the compiler will not let a name exist without a component. Keep that property.

   | Element kind | Props | Animation |
   |---|---|---|
   | `sectionChips` | `sections[]`, `activeSectionId`, `showIndex` | Row of mono chips; the active one fills with accent, the row scrolls so it stays visible, the rest dim |
   | `valueCounter` | `label`, `value`, `format`, `keyframes[]`, `tone` | Pill; digits roll on change, brief accent flash on update |
   | `isoStack` | `layers[{ label, caption, icon, highlighted }]`, `spread`, `activeIndex` | Isometric planes back to front, each on its own anchor; the active layer lifts and brightens |
   | `browserFrame` | `url`, `typedUrl`, `secure`, `content`, `chrome` | URL types character by character; padlock fades in when `secure` flips; window scales in |
   | `appMockup` | `windowTitle`, `layout` (`board`/`list`/`settings`/`dashboard`), `columns[]`, `rows[]` | Structured fake UI **from props only**; items stagger in; optional cursor move and click |
   | `terminal` | `lines[{ prompt, command, output, at }]`, `cwd` | Commands type at their anchors, output lands a beat later, cursor blinks |
   | `pipelineStepper` | `steps[{ label, icon }]`, `activeIndex`, `connector` | Connector draws between steps; the active one scales and tints; completed ones tick |
   | `worldMap` | `points[{ x, y, label?, pulse? }]`, `routes[{ from, to }]`, `density` | Dotted-grid map; points pop; routes animate along a path |
   | `listRows` | `title`, `rows[{ label, meta, status, tone }]`, `highlightIndex` | Card, rows top to bottom; status pills take their colour from `SCENE_TONE_COLOURS` |
   | `sectionTitle` | `index`, `total`, `label`, `title`, `icon` | Full-bleed chapter card — mono eyebrow, display title, optional glyph; cross-fades out |

8. **Obey the Phase 16 contracts, all of them.** Every component takes exactly
   `MotionPrimitiveProps`; `seconds` arrives as a **prop**, never `useCurrentFrame()`
   (`TIME_IS_A_PROP`, `PREVIEW_IS_THE_RENDER`); no file under `motion-scene/` imports `remotion`;
   every string draws through `TextBlock` so it is measured by the same code that checked it; the
   model emits **no coordinate** — `worldMap`'s `x`/`y` are normalised points *inside* a rectangle
   the engine computed, which is data, not layout, and the distinction is worth stating in the
   header comment because the next reader will mistake it for a hole in the rule.

9. **One new layout, `full-bleed`** — `LAYOUT_SLOTS` entry `{ min: 1, max: 1 }`. A terminal, a
   browser frame or a chapter card wants the whole safe rectangle; forcing it through
   `hero-plus-caption`'s 62/38 split shrinks it for a caption slot it never uses.

10. **Icons: extend, do not import.** The field is `icon`, typed by `SCENE_ICONS` (12 names), and
    `SCENE_ICON_PATHS` is a `Record<SceneIcon, …>` of inline SVG paths — so adding a name without
    geometry is a compile error (`BUNDLED_GLYPH_ONLY`, `INLINE_SVG_NOT_AN_ICON_PACKAGE`). The pack
    wants a handful more (`server`, `cloud`, `terminal`, `database`, `code`, `rocket`); draw them.
    **Do not reach for `lucide-react`** — it appears in dashboard chrome and in no render component,
    deliberately.

11. **Every component renders with its optional props missing** — no crash, no empty frame. A model
    that omits `typedUrl` should get a browser frame with a static URL, not a blank rectangle.

12. **Gallery entries before any AI.** Add hand-written `GALLERY_SCENES` for all ten, at both
    aspects, in `cream-amber` and in one dark style. The 16b review is still outstanding; this phase
    must not add ten more unreviewed primitives to that debt. `GALLERY_IS_THE_REVIEW_SURFACE`.

### 18c — The `cream` palette and the `cream-amber` style

13. **`paletteSchema` needs more than four colours.** It is `{ from, to, accent, text }` today, which
    is enough for a gradient backdrop and nothing else. A browser chrome, a terminal body and a row
    card need a surface, a hairline and a muted ink. Add `surface`, `line` and `muted` as
    **optional** keys with code-derived fallbacks from the existing four, so the five shipped
    palettes keep working untouched and only the pack's primitives read the new ones. `ok` is not
    needed — `SCENE_TONE_COLOURS` (`src/lib/palettes/tones.ts`) already owns status colour, and a
    second green would be two sources of truth for "good".

14. **The `cream` palette**, light where all five existing ones are dark: `bg #F4F1EA`,
    `surface #FFFFFF`, `line #DAD5C9`, `ink #1A1917`, `muted #8A8578`, `accent #D96F32`. The intent
    doc ships `muted` as `#8A8madeup`, a deliberate placeholder — `#8A8578` is the real value, and it
    is the one the contrast check has to pass with.

15. **The `cream-amber` motion style** via `defineMotionStyle`, making nine. Display serif, body
    sans, mono for chips and terminals, `radius: "soft"`, `strokeWeight: "hairline"`,
    `motionPersonality` snappy, `captionTreatment` a white-pill preset from the Phase 08 library,
    `musicMood: "light-electronic"` — **which does not exist**; `MUSIC_MOODS` is
    `none|ambient|upbeat|tense|warm` and the licence question behind it is still open
    (`MUSIC_LICENCE_IS_NOT_RESOLVED_YET`), so use `upbeat` and leave the catalogue alone.

16. **`zones` on the style**, optional, defaulted in `MOTION_STYLE_BASE` so eight presets are
    untouched: `{ hudTop: 0.08, captionBottom: 0.20, characterCorner: 0.22 }` for `cream-amber`.

17. **Contrast is checked, not eyeballed.** `checkMotionStyle` (`src/lib/motion-styles/validate.ts`)
    must assert AA for ink-on-bg, ink-on-surface, muted-on-surface and accent-on-bg. A light palette
    is the first one where accent-on-bg can plausibly fail, so this is a real test, not a formality.

18. **The mono slot is a third font, and only one family is bundled.** `MotionStyle.fonts` is
    `{ display, body }`, both resolving to one bundled family at 400/700 (`TWO_FONTS_ONE_FAMILY`,
    `BUNDLED_FONT_ONLY`) — so chips and terminal text will render in a proportional face unless a
    mono face is bundled and its glyph advances are extracted into
    `src/lib/scene/metrics-data.ts` the same way Geist's were. **A terminal in a proportional font
    is not a terminal.** Either bundle it in this commit, with the advance table, or write the gap
    into `PROGRESS.md` in the words a reader can act on — not as a style bug found later.

### 18d — The storyboard and the designer

19. **The new project kind.** `"product-explainer"` into `PROJECT_KINDS`, a generator into
    `GENERATORS` (`THE_ONLY_EXTENSION_POINT` — the kind name must not appear inside
    `project-generate.ts`), composed from `src/lib/generators/motion.ts` rather than copied from it:
    same beats, same scene track, plus the sections and the persistent lane.

20. **Beat bounds become a parameter.** `SCENE_BEAT_SECONDS` is a module constant of `1.5..6`; this
    format wants `0.8..3`, roughly one beat per second of narration. Thread bounds into
    `buildStoryboard` with the existing constant as the default, and add
    `PRODUCT_EXPLAINER_BEAT_SECONDS`. Do not fork the splitter —
    `THE_SPLIT_IS_DETERMINISTIC` is the property that makes the storyboard testable.

21. **Sectioning is the model's judgement; the arithmetic is not.** Finding the enumerated items in
    a script ("the five tools") is a reading task, so it belongs with `labelBeatIntents` in
    `src/lib/script/motion-intents.ts` — one call for the whole video, returning a label and a title
    per section plus the word index each one starts at. Turning those into `Section[]` with
    contiguous, gapless ranges is arithmetic, so code does it, and `checkStoryboard` proves it.
    **Default to one section covering everything** when no call is made, so the format works with no
    model attached, the way `INTENT_HAS_A_FREE_DEFAULT` already does for intents.

22. **Nine new intents** — `sectionTitle`, `stack`, `browser`, `terminal`, `pipeline`, `map`,
    `mockup`, `rows`, `counterUpdate` — into `BEAT_INTENTS`. `toBeatIntent()` already falls back to
    `emphasis` on anything unrecognised, so an older stored storyboard keeps loading.

23. **Storyboard rules for this kind**, each one a test over generated transcripts:
    - One section per enumerated item, plus an intro and an outro section.
    - Every section opens with a `sectionTitle` beat of about 1.2 seconds.
    - Prefer the concrete artifact: a named command becomes `terminal`, a URL `browser`, a dashboard
      `mockup`, a place `map` — never `emphasis` when a specific one fits.
    - A `counterUpdate` wherever the script mentions cost, count or progress.
    - **No primitive three beats running.** Check it in code after design, not by asking the prompt
      nicely; a prompt rule with no check is a hope.

24. **The beat prompt stays generated, not written.** `motion-beat-prompt.ts` builds the catalogue
    from `SCENE_PRIMITIVES` and `LAYOUT_SLOTS` so it cannot drift from the schema — the ten new
    primitives land in the prompt for free, and that is the property to protect when extending it.

25. **Validation rejects invention.** Beyond the Phase 16 checks: an `icon` outside `SCENE_ICONS`
    (the enum does this), a URL or a command **not present in the script** (this needs writing —
    a model that invents a plausible URL is the failure mode most likely to ship, because it looks
    right), and a prop set over the element budget.

26. **New `SCENE_ERROR_CODES`:** `RESERVED_ZONE`, `SECTION_COVERAGE`, `SECTION_INDEX`,
    `CHIP_MISMATCH`, `KEYFRAME_ORDER`, `TOKEN_WRAP`, `UNSCRIPTED_CONTENT`. Deterministic checks:
    no scene element intersects a reserved zone; the active chip matches the current section at every
    beat; counter keyframes are monotonic in time and inside the duration; terminal and browser text
    fits without breaking mid-token.

27. **Extend the vision pass, do not add a second one.** `src/lib/script/motion-review.ts` samples up
    to eight beats and never throws (`SAMPLED_NOT_EXHAUSTIVE`, `REVIEW_NEVER_FAILS_THE_RUN`). Add to
    its prompt: are the HUD, the character and the captions *simultaneously* legible; does the
    artifact on screen match what the narration says at that moment; do two consecutive beats look
    near-identical. The existing verdict vocabulary covers the first and third (`clutter`, `cutoff`);
    the second needs `mismatch`.

28. **The corner character reuses the Reddit pipeline.** `characterOverlay` → `AvatarOverlay` is
    registered, `AVATAR_STATES` is `neutral|talking|reaction`, state spans are computed by
    `src/lib/generators/avatar-windows.ts` and baked onto the item, and transitions are hard cuts by
    design (`NO_CROSSFADE_BETWEEN_STATES`). Emit it as a persistent item at `bottom-right` and
    change none of that. **No avatar artwork exists** — the same gap Phase 12 carries — so this
    renders as a reserved corner drawing nothing (`MISSING_ASSET_DRAWS_NOTHING`) until art lands.
    That is a content gap, not a code gap, and it must be ticked as such.

## Contracts

```ts
// src/lib/types/scene.ts
export const sectionSchema: z.ZodType<Section>
export type Section = { id: string; index: number; label: string; title: string
                        startWord: number; endWord: number }

export interface ReservedZones { hudTop: number; captionBottom: number; characterCorner: number }

export const PERSISTENT_ANCHORS = ["top", "top-right", "bottom-right", "bottom-left"] as const
export type PersistentAnchor = (typeof PERSISTENT_ANCHORS)[number]

export const PRODUCT_EXPLAINER_BEAT_SECONDS = { min: 0.8, max: 3 } as const

// src/lib/scene/layouts.ts — zones subtract after the Phase 08 safe-zone insets
export function safeRectFor(ctx: LayoutContext, zones?: ReservedZones): PlacedRect

// src/lib/scene/storyboard.ts — bounds are a parameter; the default is unchanged
export function buildStoryboard(
  words: readonly WordToken[],
  bounds?: { min: number; max: number },
): Beat[]
export function buildSections(plan: SectionPlan, words: readonly WordToken[]): Section[]
export function checkSections(sections: readonly Section[], wordCount: number): SceneError[]

// src/lib/scene/check.ts — one call, both kinds of document
export function checkScene(scene: Scene, ctx: SceneCheckContext): SceneCheckResult
```

## Done when

- [ ] A v4 document from Phase 16 loads, validates and renders byte-identically — no version bump
      was needed, and a test says so rather than a reader assuming it.
- [ ] `layoutScene()` with zeroed zones returns the same rectangles as before the phase, over a 16b
      fixture.
- [ ] A script naming five tools produces five sections plus an intro and an outro, each opening
      with a numbered title card, with the chip row advancing correctly.
- [ ] The HUD, the character and the captions stay on screen for the whole video and never overlap
      scene content or each other — proven by the deterministic zone check, not by looking.
- [ ] A scene element placed into a reserved zone fails `checkScene` with `RESERVED_ZONE`, in a test.
- [ ] At least six of the ten new primitives appear across a 25-beat test video, with none repeated
      three beats running.
- [ ] A spoken URL appears in a `browserFrame` and a spoken command in a `terminal`, with typing
      synced to the words that say them.
- [ ] A model-invented URL that is not in the script is rejected before it renders.
- [ ] `cream-amber` passes AA on ink-on-bg, ink-on-surface, muted-on-surface and accent-on-bg, by
      code.
- [ ] Every one of the ten primitives renders in the gallery at both aspects with its optional props
      omitted, and a human has looked at it.
- [ ] A 25-beat, 25-second video finishes in under 10 minutes and passes every QA check with no
      manual fix.
- [ ] Product explainers are metered against `motionVideos`, with no second registry entry.
- [ ] Redesigning one beat leaves the others, the sections and the HUD byte-identical.

## Not in this phase

- Generating arbitrary product UI screenshots. `appMockup` is prop-driven; a real screenshot arrives
  as an uploaded asset through Phase 02.
- Animated 3D, or a camera move through the isometric stack.
- Lip-sync. The corner character swaps discrete states, as in Phase 12.
- Importing a real dashboard by URL.
- A music catalogue for `musicMood` — still blocked on the licence decision in Phase 11.

## Effort

About a week on the ten primitives, two to three days on the section model and the reserved zones,
and two to three days tuning the storyboard, the style and the QA rules — on top of a Phase 16 that
is built but has never run. **The dependency worth naming: nothing here has a live-provider story
until Neon and the model path are reachable, so 18a–18c are fully verifiable now and 18d is
verifiable only in its pure half**, which is the same position 16d is in.
