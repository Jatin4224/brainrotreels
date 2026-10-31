<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 16 — the motion graphics studio

The phase file asks for this in four reviewable commits — 16a the scene language
and layout engine, 16b the primitives, 16c the style tokens, 16d the AI
designer.

**16a, 16b and 16c are complete. 16d is partly built.** The storyboard, the
per-beat designer, the pure generator, the metering and the pipeline stages are
in; the **beat strip, the `redesignBeat` procedure and the vision pass are
not**, and `assignIntents` has no caller, so every beat is currently designed
as `emphasis`. Each section below says which commit it belongs to, and
**"What has never run"** at the end is the honest inventory — read it before
trusting a green test suite.

The one decision to read if you read nothing else: **the model is not allowed to
emit a coordinate.** Not discouraged from it — unable to. There is no field
anywhere in the scene language that accepts an `x`, a `y`, a width or a font
size. A model picks a named layout and fills slots; `src/lib/scene/layouts.ts`
does every bit of the geometry, in code, under test. Everything else across
the four commits is scaffolding around keeping that true, and around being able to
prove that what got drawn is what got measured.

## The one-sentence version

A scene is a named layout plus up to six typed elements with no positions;
`layoutScene()` turns that into real pixel rectangles with every string wrapped
and fitted against the **actual glyph advances of the bundled font**;
`checkScene()` proves nothing overflows, overlaps or leaves the platform's safe
zone; ten primitive components draw exactly the rectangles and font sizes that
were measured, with time as a prop so the same components run in Remotion and in
a review gallery; a motion STYLE is seven tokens that are each read by something
that draws; and the pipeline splits the narration into beats deterministically,
asks a model for one scene per beat, checks each with code, repairs once, and
falls back to a plain beat rather than ever failing.

## Where the code lives

| Path | Contains | Touches the database? |
| --- | --- | --- |
| `src/lib/types/scene.ts` | the whole vocabulary: 5 layouts, 10 primitives, 8 animations, the role size table, slot rules, error codes, `Beat` | **no** |
| `src/lib/scene/metrics-data.ts` | **generated** glyph advances for the two bundled faces | **no** |
| `src/lib/scene/measure.ts` | line width, wrapping, block extent, auto-fit | **no** — pure, isomorphic |
| `src/lib/scene/runs.ts` | which strings a primitive draws, and the two formatters | **no** |
| `src/lib/scene/layouts.ts` | the layout engine — all geometry | **no** |
| `src/lib/scene/flow.ts` | graph layout via Dagre, scaled into its slot | **no** |
| `src/lib/scene/check.ts` | the deterministic checks | **no** |
| `src/lib/scene/document.ts` | the seam to and from the stored `SceneSpec` | **no** |
| `src/lib/scene/anchors.ts` | word anchor → beat-relative seconds; the on-screen window | **no** |
| `src/lib/scene/gallery.ts` | the eleven hand-written review scenes | **no** |
| `src/lib/palettes/tones.ts` | what `tone: 'negative'` is drawn in, per palette | **no** |
| `src/remotion/components/motion-scene/canvas.tsx` | the family: dispatch to a primitive per element | **no** |
| `src/remotion/components/motion-scene/index.tsx` | the Remotion driver — **the only file here that imports `remotion`** | **no** |
| `src/remotion/components/motion-scene/text-block.tsx` | every text run in the library is drawn by this | **no** |
| `src/remotion/components/motion-scene/animation.tsx` | the eight movements, the shell, the easing | **no** |
| `src/remotion/components/motion-scene/{text,numbers,structure,flow-graph}.tsx` | the ten primitives | **no** |
| `src/remotion/components/motion-scene/icons.tsx` | twelve inline SVG glyphs | **no** |
| `src/components/global/motion-preview/` | the scaled live preview card | **no** |
| `.../projects/[id]/motion/_components/motion-gallery.tsx` | the review surface | **no** |

And what 16c and 16d added:

| Path | Contains | Touches the database? |
| --- | --- | --- |
| `src/lib/types/motion-style.ts` | the seven style tokens, the scale tables, the proposal shape, the rejection codes | **no** |
| `src/lib/motion-styles/` | the base, the eight library styles, the validator, the barrel | **no** |
| `src/lib/palettes/tones.ts` | what `tone: 'negative'` draws in, per palette | **no** |
| `src/lib/script/motion-style.ts` | "design one for me" — the model call and its one repair | **no** (server-only) |
| `src/lib/script/motion-beat.ts` | one beat designed, checked, repaired once, else fallback | **no** (server-only) |
| `src/lib/script/motion-{style,beat}-prompt.ts` | the prompts, with catalogues generated from the constants | **no** |
| `src/lib/scene/storyboard.ts` | the deterministic split, the coverage check, the short-tail merge | **no** |
| `src/lib/scene/fallback.ts` | the plain beat a failed design gets — measured, not guessed | **no** |
| `src/lib/generators/motion.ts` | the pure document builder, registered in `GENERATORS` | **no** |
| `src/services/motion.service.ts` | stores the storyboard whole; meters the video | **yes** — the only layer that does |
| `src/trpc/routers/motion.ts` | `motionStudio.styles`, `motionStudio.designStyle` | no |
| `src/inngest/functions/project-generate.ts` | the `storyboard` and `design` stages | via the service |
| `.../projects/[id]/motion/_components/design-style-panel.tsx` | the three questions and the live preview | via tRPC |

**No migration, in any of the four.** 16a and 16b add no stored data at all;
16c adds one OPTIONAL field to the timeline document (`style.motionStyleId`)
which falls back when absent; and 16d stores its storyboard in
`Project.settings`, exactly as the phase file specifies. Every document written
before this phase is still valid, so there is nothing for a migration step to
change.

The registry gained **two** entries, and the split between them matters:
`motionStudio` is a FLAG that gates the whole router including its reads, and
`motionVideos` is a LIMIT counted when a design succeeds. Collapsing them would
mean either rationing a style picker that costs nothing, or leaving the
expensive step uncounted.

## The rule the whole phase rests on

Most AI layout systems ask a model for coordinates and then spend their lives
fixing the consequences: text crossing text, a number half off the frame, a
diagram under TikTok's button rail. Every one of those is a geometry mistake,
and a language model is not a layout engine.

So the scene language has no coordinates in it. Five named layouts —
`stack-center`, `split-2`, `grid-3`, `hero-plus-caption`, `flow-graph` — and an
array of elements. **Slot `i` belongs to element `i`.** Grep
`THE_MODEL_NEVER_EMITS_COORDINATES` and `NAMED_LAYOUTS_ONLY`.

Elements have an array position and no slot NAME, which is `SLOT_ORDER_IS_THE_LAYOUT`.
Named slots were the alternative and they are worse on the path that matters: a
model that invents `slot: 'hero-left'` against a layout with no such slot
produces an element the engine must either drop silently or refuse, and both are
a beat the customer paid for. An array index cannot be misspelled.

The rule is enforced in three places, not asserted once:

- `sceneElementStrictSchema` is `.strict()` and declares no `box`.
- `fromSceneSpec()` re-parses a STORED element through it, so a hand-edited
  document or one written by an older release that smuggled a position in is
  **refused** rather than honoured. Grep `NO_COORDINATE_SURVIVES_THE_SEAM`.
- A test asserts `toSceneSpec()` writes no `box` and no `box` key inside
  `props`.

## Strict language, loose document

`sceneSpecSchema` in `src/lib/timeline/schema.ts` stays deliberately open —
`layout: string`, `kind: string`, `props` as free JSON — because one document
schema carries quiz cards, Reddit cards and motion scenes, and freezing every
family's knobs there would mean editing the document schema for every new
animation.

The cost of that openness is that a stored scene is not yet known to be a valid
motion scene. `src/lib/scene/document.ts` is where it becomes known. Exactly the
relationship `src/lib/quiz/import.ts` has with a quiz card, and the same
consequence: a scene written by hand for the gallery and a scene returned by the
designer in 16d both arrive as JSON and both go through `parseScene()`. From
that line onward nothing can tell them apart, which is what will make "a
hand-written three-scene document renders with no model involved" structural
rather than a thing somebody tested once. Grep `ONE_SHAPE_TWO_INPUTS` and
`THE_DOCUMENT_IS_THE_LOOSE_FORM`.

Everything but `id` and `kind` goes into `props`, and **nothing is mirrored into
the document's optional `text` field**. Mirroring was tempting — the editor's
track list shows `text` for other families — and it is how two copies of a
headline drift apart, with the rendered one and the displayed one disagreeing
after an edit. A scene item carries `label` for that job already. Grep
`PROPS_CARRY_THE_STRICT_ELEMENT`.

The round trip is asserted to be lossless, because 16d's "redesigning one beat
leaves the others byte-identical" is false if saving rewrites an untouched beat.

## The measurement is real, and the provenance is checkable

The phase file says "real text measurement against the actual bundled fonts —
not an estimate, not an average character width", and states it as a requirement
precisely because the shortcut fails invisibly. An average character width makes
`WWWW` and `iiii` the same length; they differ by a factor of nearly four in
this face (912 against 246 units at weight 400). Overflow detection built on an
average passes beats that run off the frame and refuses beats that fit, and it
does both silently.

`src/lib/scene/metrics-data.ts` holds the `hmtx` advance of every glyph the
`cmap` maps, for both bundled weights. The provenance is not asserted, it is
checkable: the values were extracted from
`node_modules/@fontsource/geist-sans/files/geist-sans-latin-{400,700}-normal.woff`
at the version the lockfile pins, and those are the same release whose `.woff2`
siblings are the files in `public/fonts/` — **byte-identical by md5**. The
`.woff` was read rather than the `.woff2` because WOFF stores each table under
plain zlib, which Node can inflate, while WOFF2 brotli-compresses the whole
directory and transforms `glyf`. Same font, cheaper door. Grep
`REAL_ADVANCES_NOT_AN_ESTIMATE` and `METRICS_ARE_GENERATED_DATA`.

### Why a table and not a measurement

The same check has to run in three places with nothing in common: the browser
editor, a Vitest process with no DOM, and the Inngest worker that runs the
deterministic checks before any still is rendered. `canvas.measureText` exists
in exactly one of those. A committed table is the only form of real measurement
that is **isomorphic**, and isomorphic is what makes the editor's overflow
warning and the server's refusal the same answer rather than two
implementations that agree today.

### The one honest gap, and its direction

Geist carries GPOS kerning and the table does not. Kerned pairs (`Ta`, `AV`)
draw a few units narrower than the sum of their advances, so **a measured width
is at or above the true width and never below**. The overflow check can report a
false overflow on a line that would just fit; it can never miss a real one.

That is the direction to be wrong in: a false overflow costs one repair attempt,
a missed one costs a video with text off the frame. The error is a few tenths of
a percent on real copy. Grep `ADVANCE_SUM_IS_AN_UPPER_BOUND` — the same
asymmetry argument decides two other defaults in this phase.

## Auto-fit has a floor

Long copy is shrunk toward the role's `minSizeVh`, because that is what a
designer does and it is why a 90-character list item does not have to be
refused. Shrinking **past** the floor is not: at 2vh on a 1080-tall proxy the
text is nine pixels and the beat is unreadable, so "it fits" would be a true
statement about a useless frame.

Below the floor the run keeps the floor size — so the component still has
something to draw and the beat still renders — and sets `overflow`, which
`checkScene` turns into the error the repair loop acts on. **Both halves
matter**: the pipeline always finishes AND the defect is reported. Grep
`AUTO_FIT_HAS_A_FLOOR`.

The walk is downward in fixed 0.1vh steps rather than a solve or a bisection.
Wrapping makes width a step function of size, not a continuous one, so there is
nothing to solve for, and a bisection over a step function can land on either
side of a boundary depending on rounding. Determinism is not a nicety:
Phase 04 decides a render can be REUSED by hashing the document, and 16d
promises that redesigning one beat leaves the others byte-identical. Both are
false if laying the same scene out twice can differ. Grep
`FIT_IS_DETERMINISTIC`.

## The checks, and the two that are easy to fake

`checkScene()` returns a LIST of errors rather than throwing, because 16d sends
every error for one beat back to the model in a single repair attempt and a
bounded two attempts cannot afford to surface one problem at a time. Each
message names the element, the field and the measured number — "overflows by
148px at the 3vh floor", not "does not fit" — because a model cannot fix a
sentence that does not say what to change. Grep `EVERY_ERROR_IS_ACTIONABLE`.

Eleven codes: `SLOT_COUNT`, `LAYOUT_REQUIRES_PRIMITIVE`, `TEXT_OVERFLOW`,
`ELEMENT_OVERLAP`, `OUTSIDE_SAFE_ZONE`, `UNKNOWN_WORD_ANCHOR`,
`TIMING_INVERTED`, `TIMING_OUT_OF_BEAT`, `DUPLICATE_ID`,
`GRAPH_EDGE_UNKNOWN_NODE`, `SCHEMA`.

### Overlap is checked on ink, not on slots

This is the check most easily written as theatre. Named layouts place slots that
do not touch, so comparing slots would compare rectangles that are disjoint by
construction and the check would always pass.

So the comparison is between the rectangles the wrapped text blocks **actually
occupy** — `PlacedTextRun.drawnRect`, the measured block centred in its box. A
run that could not be shrunk to fit is drawn larger than its box, and that is
what crosses into the next element. Which is why an overflow and an overlap
usually fire together on the same beat: the second is the consequence of the
first. Grep `OVERLAP_IS_CHECKED_ON_INK`.

Runs **within** one element are not compared. Their boxes come from `runBoxes`,
which is this engine's own geometry, so an overlap there is an engine bug its
own tests cover.

### Two elements never on screen together are not an overlap

Sequencing elements through one region is normal design for a six-second beat,
and refusing it would make the engine reject good work. So the overlap check
skips pairs whose windows are provably disjoint. Grep
`DISJOINT_IN_TIME_IS_NOT_AN_OVERLAP`.

When either element is timed by a word anchor the module cannot know the seconds
— it is pure and holds a word COUNT, not the transcript — so it **assumes they
share the frame** and checks them. A possible false overlap costs one repair
attempt; a missed one is a finished video with text on text. Grep
`UNRESOLVED_IS_TREATED_AS_OVERLAPPING`.

## Dagre, and why not elkjs

The phase file requires the graph auto-layout dependency to be approved before
adding. It is `@dagrejs/dagre`, pinned, and the deciding factor was the call
signature rather than the feature list.

`dagre.layout()` is **synchronous**. The geometry has to be computed inside
`checkScene` (a pure function the editor calls while somebody types), inside a
Remotion component's render pass (synchronous by construction) and on the
Inngest worker. elkjs is Promise-based, which would have put an async seam
through all three and made the component render a frame before it knew where
anything goes — in Remotion that is a frame of the wrong picture composited into
a paid video. Grep `DAGRE_IS_SYNCHRONOUS`.

A hand-rolled layered placement was the other alternative, and it is the same
algorithm written worse: rank assignment, crossing reduction and coordinate
assignment are each a paper, and getting crossing reduction wrong produces
exactly the overlapping-garbage picture this phase exists to prevent.

The order of operations matters and is easy to get backwards. Dagre is given
node boxes sized from the **real measured label widths**, lays the graph out at
its natural size, and only then is the whole drawing scaled uniformly into the
slot. Laying out inside a pre-scaled box would shrink node and rank separation
with the graph and the nodes would touch. The scaled node rectangles are then
handed back for the labels to be fitted INTO, so a graph that had to shrink too
far reports itself as a text overflow through the same path every other
primitive uses. Grep `SCALE_TO_FIT_THEN_MEASURE`.

## Time is a prop

No primitive calls `useCurrentFrame`. `MotionSceneCanvas` takes `seconds`, and
`MotionScene` — the only file in the folder that imports `remotion` — is a thin
driver that reads the frame and divides by fps.

The reason is the review gallery. `src/components/global/caption-preview` already
established that a review surface must mount the REAL component
(`PREVIEW_IS_THE_RENDER`), because a gallery that draws its own approximation is
wrong exactly where it matters — on the long label, at the edge of the safe zone,
in the one primitive somebody changed last week. A primitive that read the frame
itself would only work inside a Remotion context, so a dozen cards would be a
dozen Players. With time as a prop the gallery drives the same components from
one `requestAnimationFrame` loop. Grep `TIME_IS_A_PROP`.

It also keeps every drawing component free of the `remotion` package, which
matters for the reason `CAPTIONS_STAY_PURE` gives: that package's module body
expects a Remotion bundle. The price is eight lines of cubic easing written
locally instead of `interpolate` — the one deliberate duplication in the folder,
and a cubic ease is not a thing that can be got subtly wrong.

## Every text run is drawn by one component

`TextBlock` emits the **pre-wrapped** lines as separate elements with
`white-space: nowrap`, so the browser is never asked where to break. Handed the
whole string with `overflow-wrap` on, Chrome would wrap by its own rules — which
agree with the measurement almost always, and "almost" is the failure, because
the beats where they disagree are exactly the long ones the check was built for.
Grep `EVERY_TEXT_GOES_THROUGH_HERE` and `NO_BROWSER_WRAPPING`.

Overflow is deliberately **not** clipped. In the gallery the defect has to be
visible, and in a real render the pipeline should have repaired or replaced the
beat long before it got here.

A counter is the interesting case: it draws a different string every frame, so
the layout was measured against the **wider of its two endpoints** and each
frame draws the current value inside that already-fitted geometry. The font size
and the box never change mid-count, which is what stops a figure jittering as it
grows. Measuring only `to` would pass a beat counting 5,000 down to 10 whose
first second is off the frame. Grep `WIDEST_FRAME_IS_THE_ONE_THAT_MUST_FIT` and
`MEASURED_WIDEST_DRAWN_CURRENT`.

## Animations may only touch opacity, transform and clip-path

If an entrance could change a layout rectangle, the overflow and overlap checks
would describe the element at rest while the video showed it somewhere else —
the exact gap this phase closes. So every one of the eight named movements is a
transform or an opacity, and **a test reads all eight at three progress points
and fails on any other CSS property**. Grep `ANIMATION_NEVER_MOVES_THE_INK`.

The movements are a closed set rather than a duration-and-easing bag the
designer fills in, because an animation is the one part of a scene geometry
cannot check: a check can prove text fits, it cannot prove a curve looks
broken. Eight named movements are implemented once and reviewed once.

Two details that are wrong in the obvious implementation:

- `slide-left` is named for the direction it **travels**, so it enters from the
  right. Naming it for where it comes from makes every pair of adjacent
  elements look like a mistake.
- An element on screen for less time than its entrance plus its exit gets both
  **scaled**, not overlapped. Unscaled, a 0.4s element would be mid-exit before
  its entrance finished and would never reach full opacity — which reads as a
  flicker rather than as a bug. Grep `SHORT_ELEMENTS_SCALE_THEIR_MOTION`.

## It touched shared code four times (16a and 16b)

- **`RenderItemProps` gained `style`.** A scene family that needs the palette
  had no way to reach it: the walker hands a component its ITEM, and
  `sceneItemSchema` is `.strict()` with nowhere to put a document-level value.
  Phase 13's quiz card worked around that by having its GENERATOR copy
  `paletteId` and `safeZone` down into an element's `props`, so the two values
  exist in as many copies as there are scenes and a restyle has to rewrite every
  one. Motion needs both on every beat, so copying that ten more times was the
  moment to put the document's `style` in the shared contract instead. Purely
  additive; the quiz card's own path still works. Grep
  `STYLE_IS_PART_OF_THE_CONTRACT`.
- **`purity.test.ts` moved up to `src/lib/`** and now guards both `timeline/`
  and `scene/` from one table. The scene engine makes the same isomorphism claim
  the timeline module does, and copying the file would have left two lists of
  forbidden imports that did not stay in step. Its textual import scanner also
  had to be tightened: it could not tell the `from` keyword from the word
  `from` in a string literal, which `check.ts` contains. Grep
  `ONE_PURITY_CONTRACT`.
- **The safe zone is Phase 08's.** `safeRectFor()` calls `captionBox()` with a
  zero-height block rather than reading `SAFE_ZONE_INSETS` a second time. The
  phase file asks for this and the reason is concrete: two implementations of
  "where TikTok's button rail is" means a caption and a motion element that
  disagree about the bottom of the frame in the same video, and the wrong one is
  whichever was edited second. Grep `SAFE_ZONE_IS_SHARED`.
- **`sceneSpecSchema` is exported from the timeline barrel**, because the motion
  component parses a stored item with it and reaching into `./schema` directly
  would bypass the barrel every other consumer uses.

## Decided differently from the phase file (16a and 16b)

- **Zod schemas live in `src/lib/types/scene.ts`, not `src/lib/scene/schema.ts`.**
  The phase file names the second path; CLAUDE.md rule 4 says types live in
  `lib/types` exclusively, and `src/lib/types/quiz.ts` is the precedent — the
  vocabulary in `lib/types`, the logic in `src/lib/<feature>/`. Project law won.
- **Word anchors here are INDICES only**, not the document's
  `{ word: 'revenue' }` form. A word string is ambiguous in any transcript where
  the word repeats, and it is not checkable from a pure module that holds a word
  COUNT rather than the transcript — so it would fail at render time instead of
  design time, which is the trade this whole phase is arranged to avoid. Nothing
  is lost: the designer is handed `Beat.startWord` as an index already. The
  narrowing is proved to be a narrowing by a compile-time function rather than a
  comment. Grep `ANCHORS_ARE_INDICES_HERE`.
- **`LayoutContext` was split in two.** The renderer lays a scene out every
  frame and genuinely does not know the word count. With one combined context it
  would have had to invent `wordCount: 0`, which is a false statement in a type
  and leaves the next reader unsure whether the layout depends on it.
  `SceneCheckContext` extends `LayoutContext` with what only the checks need.
  Grep `CHECKING_NEEDS_MORE_THAN_LAYOUT`.
- **`split-2` and `grid-3` divide the LONGER side of the safe rectangle.** As
  columns they are correct on 16:9 and unusable on 9:16, where two columns of a
  1080-wide frame are 500px each and a three-word label wraps four times. So
  they are columns on landscape and rows on portrait. A project's canvas is
  chosen per video and the designer is not re-run per aspect, so the same scene
  has to read correctly at both. **This is the design decision in the engine
  most worth a second opinion**, and the gallery's aspect switch exists for it.
  Grep `SPLIT_ALONG_THE_LONG_AXIS`.
- **Icons are twelve inline SVG paths, not `@hugeicons/react`** which the app
  chrome uses. A React icon component is one more module that has to resolve
  inside the Remotion bundle and one more thing that can render as an empty box
  without failing the render — and a beat whose only element is a missing icon
  is a blank frame in a paid video. Twelve `d` attributes have no resolution step
  and no version to drift. Grep `INLINE_SVG_NOT_AN_ICON_PACKAGE`.
- **`MOTION_PRIMITIVES` is a full `Record`, not a `Partial`** — the opposite of
  `RENDER_COMPONENTS`. An unimplemented render kind is a documented gap because
  a document written by a newer release must degrade; a primitive comes from
  this app's own closed `SCENE_PRIMITIVES`, the designer prompt will be
  generated from that same list, and the gallery exercises all of it, so a
  missing one is a bug nobody should be able to ship.
- **The committed motion fixture was rewritten.** It carried `figure-left`,
  `bigStat` and `headline` since Phase 01 — names nothing ever implemented — and
  now speaks the real vocabulary, with a test asserting every beat parses and
  checks clean. Tests only, so no stored document changes. Grep
  `FIXTURE_SPEAKS_THE_SCENE_LANGUAGE`.
- **Thousands separators are hand-rolled, not `Intl.NumberFormat`.** Intl would
  give an answer that depends on the ICU data in whichever Node build or browser
  is running, so the measurement in the editor, the check on the worker and the
  pixels from Lambda could differ by a glyph — and a width that differs by a
  glyph is a reused render that is wrong. Separators are `,` and the decimal
  point is `.`, for every customer, until the app has a locale story. Grep
  `GROUPING_IS_HAND_ROLLED` and `NO_LOCALE_STORY_YET`.

## The gallery found two defects in its own fixtures, before anyone looked at it

Which is the argument for building it before connecting any AI.

- A list item reading "Replaced the welcome tour with a single working example
  they could copy" measured **31px past its row**. Shortening it twice still
  missed, by 7px and then 2px, and only inside TikTok's, Reels' and Shorts'
  insets — it fit a 9:16 frame with no safe zone throughout. The honest answer
  was not a shorter string but a smaller list: **`stack-center` holds three list
  items plus a heading in a vertical frame, not four.** That is a fact about
  this engine's role sizes worth knowing before the designer starts writing
  lists in 16d, and it is exactly the thing a reviewer nods past. Grep
  `THREE_ITEMS_IS_WHAT_FITS`.
- The first `negative` tone colour measured **3.39 contrast against `warm`**,
  whose background is itself a deep red. One step lighter measures 4.94 and
  passes. That margin is thin enough that a sixth palette could push it under,
  which is what `palettes.test.ts` is for. Grep `TONE_CONTRAST_IS_TESTED`.

Tones are data for the same reason caption styles are: a scene says
`tone: 'negative'` and never a hex, because a model cannot run a contrast check.
`neutral` resolves to the palette's own `text` rather than to a sixth
near-white, since a neutral callout IS the palette's voice. Grep
`TONE_IS_MEANING_NOT_COLOUR`.

## 16c — a token is a choice, not a number

The phase file lists seven tokens: palette, two fonts, radius, stroke weight,
motion personality, caption treatment, music mood. The easy version of 16c is
seven fields nothing reads, so the rule that shaped it is
**TOKENS_MUST_CHANGE_THE_PICTURE** — every one has a consumer that draws:
`paletteId` on every primitive, `fonts` through each text role's new
`fontSlot`, `radius` on graph nodes and the meter and bar tracks,
`strokeWeight` on edges and borders and the callout rule, `motionPersonality` on
the animation shell's durations **and** its easing curve, `captionTreatment` as
an id from Phase 08's library, `musicMood` as the durable half of a choice
Phase 11 cannot yet honour.

`radius` is `square | soft | round`, not a pixel value; `strokeWeight` is
`hairline | regular | bold`, not a float. A raw number is unbounded, so a model
proposing `radius: 400` type-checks and draws a flow-graph node as a circle with
its label outside it — a closed union cannot be out of range. The pixel value
also depends on the canvas and on what it is applied to, so it belongs in the
scale tables with the arithmetic stated once in
`src/remotion/components/motion-scene/util.ts`. Grep
`A_TOKEN_IS_A_CHOICE_NOT_A_NUMBER`.

### The style belongs in the document

It would have been natural to keep the chosen style in `Project.settings` with
the storyboard. That would have been a **cache bug**: Phase 04 decides a paid
render can be reused by hashing the document, so a style stored outside it means
switching from `Boardroom` to `Launch` produces an identical hash, the cache
serves the old video, and the customer's restyle silently does nothing. Anything
that changes the picture has to be inside the thing that gets hashed, so
`style.motionStyleId` is a document field. It is optional and unknown ids fall
back, so nothing stored before 16c changed. Grep
`STYLE_BELONGS_IN_THE_DOCUMENT`.

Applying a style also **copies its palette into `style.paletteId`**, which every
format and the backdrop already read. Two sources of colour would be one too
many: `paletteId` stays the single answer to "what colour is this video" and
`motionStyleId` answers the narrower "which motion style", which is what the
renderer needs for radius, stroke, fonts and personality. Grep
`APPLYING_A_STYLE_WRITES_THE_PALETTE`.

### "Code validates" is five checks, and one of them is the silent one

The model proposes, `motionStyleProposalSchema` proves the SHAPE, and
`checkMotionStyle` proves what a schema cannot: the palette exists, the caption
treatment is real, `minPlan` is a real plan, the palette's text is legible on
its own gradient, and **both fonts resolve to a bundled family**.

That last one is the only check whose absence produces no signal at all. The
phase file's own words: a model-proposed font that is not bundled "renders as a
fallback and silently ruins the video". No error, no failed render, no
complaint — a finished video in the wrong typeface that somebody paid for. Grep
`FONT_NOT_BUNDLED_IS_THE_SILENT_ONE`.

The measurement is `contrastRatio` against `CONTRAST_TEXT_MIN`, the same
function and threshold the caption library measures its thirty-eight styles
with. A second luminance calculation here would be a second answer to a question
this codebase answered once. Grep `ONE_CONTRAST_RULE`.

### One contrast check is new to this phase, and it found a real pairing

A caption style is measured against `REFERENCE_BACKGROUNDS` in its own library —
never against the palette a motion style happens to pair it with, because that
pairing did not exist before 16c. `bold-ink` is the one style of thirty-eight
with a dark fill (`#101010`), and on `noir` it measures **1.04:1**. "An inky look
on a black background" is a plausible thing to ask a model for, and this is the
refusal that stops it shipping.

A second test records that `bold-ink` is pairable with **no** palette today,
because all five are dark. That is a fact about the palette set rather than a
bug in the style, and the test is what will notice when a light palette makes
the pairing legal.

### The catalogue in the prompt is generated

Every list the model is shown — palettes, caption treatments, radii, strokes,
personalities, moods — is built at call time from the constants the validator
reads. A hand-written list is how a model ends up offered a palette that was
renamed last month, proposes it, and is refused by a validator reading the real
list: a failure the customer sees, that nobody can explain, with the prompt and
the validator both looking correct in isolation. Grep
`THE_CATALOGUE_IS_GENERATED`.

### Three decisions beyond the phase file

- **The id is minted by code.** A model-chosen id could collide with a library
  style and silently replace it on a screen listing both. Every designed id
  carries a `designed-` prefix, and a name of only punctuation falls back to a
  fixed suffix rather than producing a bare prefix — which would itself collide
  with the next such style. Grep `ID_IS_MINTED_BY_CODE`.
- **`minPlan` is set by us.** What a style costs is a commercial decision; a
  model choosing `free` would be inventing pricing.
- **`MotionPreview` takes a resolved style, not an id.** This was a bug written
  and then caught: a designed style is not in the library, so `getMotionStyle`
  would fall back to the default for it, and the preview would show the
  DEFAULT's radius, stroke and personality under the designed style's name.
  Every token would have been wrong and nothing would have said so. Grep
  `A_RESOLVED_STYLE_NOT_AN_ID`.

## 16d — the split is code, the intent is the model's

Deciding WHERE a beat ends is arithmetic over word timings: it has an obviously
correct answer and a test can verify it exactly, so asking a model would cost a
request per video to get something worse. What a beat is ABOUT is judgement, so
`assignIntents` is the seam a model plugs into — and every beat defaults to
`emphasis`, the one intent that always has a designable scene, so the whole
storyboard works with no model attached. Grep `THE_SPLIT_IS_DETERMINISTIC` and
`INTENT_HAS_A_FREE_DEFAULT`.

Within the allowed 1.5–6 seconds the split prefers a word that ends a sentence,
then one that ends a clause, then the longest beat that fits. A beat that cuts
mid-sentence makes the graphic change while the speaker is still finishing a
thought, which reads as a mistake even when every number on screen is right.

**Coverage is checked before anything is designed**, which is the phase's own
ordering. Designing is a model request per beat, so a storyboard that drops
three words in the middle has to be caught while it costs nothing — and a gap is
not cosmetic, it is narration playing over whatever the previous beat left on
screen. Grep `COVERAGE_IS_CHECKED_BEFORE_DESIGNING`.

### One `step.run` per beat is the fan-out

Each beat is durable on its own, retried on its own, and memoised across a
replay, so a run that dies on beat thirty does not pay for the first
twenty-nine twice. **Sequential, not parallel**, and that is the throttle the
phase asks for: a `Promise.all` over forty steps would issue forty concurrent
requests and be rate-limited on a long video — the one failure mode that gets
worse the more a customer paid. Grep `ONE_STEP_PER_BEAT`.

### The designer cannot throw for a design failure, and must throw for a transport one

Two bounded attempts, then a fallback: `THE_PIPELINE_ALWAYS_FINISHES`, which the
phase argues as a business rule before a technical one — "a user seeing one plain
beat is a minor disappointment; a stuck job is a support ticket and a refund".

But a rate limit or a 5xx is **rethrown**, because swallowing it into a fallback
would quietly turn a retryable blip into a video full of plain beats. That
distinction is `LlmError.permanent` and it is the one line in the loop worth
reading twice.

Note the two retries sit at different levels and both are needed: the adapter
retries output that fails the SCHEMA, and this retries output that passes the
schema and fails the GEOMETRY. Neither can do the other's job.

### The generator is pure, so the design happens before it

A generator may not call a model (`GENERATORS_STAY_PURE`), so the scenes are
designed in the pipeline's `design` stage and stored in `Project.settings`; the
generator reads them. The same split Phase 13's quiz writer makes, and it is
also what will make "redesign one beat" cheap — the stored scenes are the
artifact, and rebuilding the document from them costs nothing. Grep
`MOTION_SCENES_ARE_ALREADY_DESIGNED`.

### Anchors are resolved before storing, not at render time

The model may anchor an element to a WORD, which is how the phase's "every
number or diagram appears on the word that introduces it" is expressed. A
renderer cannot resolve one — it is handed an item, a canvas and a style, never
the transcript — so `resolveSceneAnchors` runs in the design step, once,
against the alignment that produced the beat.

This was very nearly a silent gap: `elementWindowSeconds` handles an
unresolved anchor by showing the element for the whole beat with a warning, so
a scene stored still-anchored would have rendered with the right content and
the wrong timing — the safety net doing load-bearing work and no test failing.
Grep `RESOLVE_BEFORE_STORING` and `AN_UNRESOLVED_ANCHOR_SHOWS_THE_WHOLE_BEAT`.

A beat with **no** stored scene gets a measured fallback rather than a gap. The
generator is the last place that could turn an interrupted design into a video
with holes in it, and it does not. Grep `A_MISSING_SCENE_IS_A_FALLBACK`.

### Metering

`motionVideos` is incremented after the beats are stored, **in the same
transaction**. Counting on request would charge a customer for our outage;
counting outside the transaction would let a crash between the two leave a video
designed and unmetered. Grep `COUNTED_WHEN_THE_DESIGN_SUCCEEDS`.

### Two bugs the tests caught

Both were mine, and both are the kind that would have shipped quietly:

- **The sentence-break preference never fired.** "Longest beat that fits" and
  "best sentence break" shared one variable, so each iteration clobbered the
  sentence choice. Every beat was silently breaking at the six-second ceiling
  instead of at punctuation — a video whose graphics change mid-sentence, with
  nothing in the output to say why.
- **The fallback overflowed.** Its validity rested on a word count somebody
  guessed, and twelve short words do not fit the kinetic role inside TikTok's
  insets at 9:16. A guessed constant cannot carry `FALLBACK_IS_ALWAYS_VALID`,
  because the thing it must be true for is every transcript at every aspect in
  every safe zone. The fallback now **measures itself** and drops words until
  `checkScene` passes, with a bullet as the terminal case. Grep
  `FALLBACK_IS_MEASURED_NOT_GUESSED`.

### One existing test had to change

`generators.test.ts` asserted `hasGenerator("motion") === false` — the
registry's last documented gap. Every declared kind now has a generator, so the
assertion was rewritten against `PROJECT_KINDS` rather than a hand-listed four:
declaring a fifth format now fails there until it is built or deliberately left
out. `UNBUILT_KIND_IS_NAMED` is exercised directly rather than deleted, since
there is no unbuilt kind left to demonstrate it on.

## And two more when somebody did

The review surface earned itself twice before a human had finished looking at
it.

- **Every preview in the app was drawing in the browser's default serif.**
  `RENDER_FONT_FAMILY` is a local name declared by a `FontFace`, and the only
  thing that declared it was `src/remotion/fonts.ts`, which runs inside a
  Remotion bundle. So every app-side preview asked for a family nothing had
  registered — the caption gallery **since Phase 08**, and the motion gallery
  since 16b. For captions that was cosmetic; for motion it voided the premise,
  because the overflow checks measure Geist's advances and the preview was
  drawing something else. `DRAWN_IS_MEASURED` and `PREVIEW_IS_THE_RENDER` are
  both false the moment the face is wrong. Fixed with one shared face list
  (`RENDER_FONT_FACES`) and a second loader for the browser. Grep
  `ONE_FACE_LIST_TWO_LOADERS` and `THE_PREVIEW_MUST_LOAD_THE_FACE`.

  Worth noting: Phase 08's deliberate decision to give `RENDER_FONT_FAMILY` **no
  fallback stack** is exactly what made this visible rather than "close enough".
  That trade paid off.
- **A title's subhead sat a third of a frame below its headline.** Each run
  centres in its own band, and `stack-center` gives a lone element the entire
  safe rectangle, so a 66/34 split put them that far apart — two pieces of text
  that distant read as two elements, not as a title with a line under it. Now
  placed inside a centred block at 72% of the slot. It is a tunable fraction,
  not fitted to the measured text, because fitting it would need measuring
  before placing and placing before measuring. Grep `A_TITLE_IS_ONE_BLOCK`.

## What is NOT in this phase

Generated animation code, 3D and presenter characters, all of which the phase
file excludes.

Still missing from 16d itself:

- **The beat strip** — the phase's step 14, "each beat as a still, with redesign
  this beat re-running exactly one beat". Neither the UI nor the `redesignBeat`
  procedure exists. `saveMotionDesign` already takes `countVideo: false` for
  exactly that caller, and `readMotionDesign` returns the raw blob so one beat
  can be replaced without re-parsing its siblings — but nothing calls either.
- **The vision pass** — step 12's second half. The deterministic checks run; no
  still is rendered and no vision model is asked.
- **`assignIntents` has no caller.** Every beat is designed as `emphasis`, so
  the intent-to-primitive guidance in the prompt is live but never varies. The
  storyboard-level model call that would set intents is the smallest remaining
  piece.

## What has never run

Be precise about this, because the tests are green and the green is narrower
than it looks. Four things:

**Nothing has been composited to MP4.** `motion → MotionScene` is registered and
`next build` succeeds, but no motion document has ever been rendered — that
needs Phase 02's R2 and Phase 04's AWS deploy like every other format. So the
phase's "a hand-written three-scene document renders to MP4 with no model
involved" is **half met**: a hand-written settings blob does build a valid,
checked document, and the rendering half has never been attempted.

**The whole motion pipeline.** Neon has been unreachable since Phase 05, so no
storyboard has been stored, no beat designed, and `motionVideos` has never been
incremented. The `storyboard` and `design` stages type-check and are wired into
the workflow; they have never executed.

**`designMotionStyle` and `designBeat` against Claude.** The adapter seam is
proven — Phase 06 generates real scripts through it — so the risk is not the
transport, it is the prompts. Nobody has seen what the model actually returns
for either.

**Nobody has finished looking at the gallery.** The first Done-when line is
"every primitive and layout renders in the gallery, in every palette, reviewed
by a human". The gallery exists, covers every primitive, layout and animation
(each asserted by a test, so an eleventh primitive cannot skip review), runs
`checkScene` live for the chosen aspect, palette and safe zone, and now has a
style switcher and a designed-style preview. One pass over it produced the two
findings above. The review itself is not finished and cannot be delegated to a
test.

What **is** genuinely verified, by 291 tests: the measurement against real
`hmtx` advances, auto-fit and its floor, the overflow and overlap checks in the
phase's own wording, the document round trip, graph layout determinism and
non-overlap, the safe-zone matrix across every layout at both aspects in all
four platform zones, the constraint that no animation can move the measured ink,
the whole style library passing its own validator, the prompts' generated
catalogues and injection fencing, the storyboard's coverage over generated
transcripts, the fallback's validity against hostile narration, and the
generator building a valid document from hand-written settings with no model
involved.
