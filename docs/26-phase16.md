<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 16 — the motion graphics studio (16a and 16b)

The phase file asks for this in four reviewable commits — 16a the scene language
and layout engine, 16b the primitives, 16c the style tokens, 16d the AI
designer. **This document covers 16a and 16b.** 16c and 16d are not started, so
nothing here is metered, no `motionStudio` registry entry exists, and no model
has ever designed a beat.

Read it anyway before touching 16c or 16d, because the two commits already
landed decide what those can be.

The one decision to read if you read nothing else: **the model is not allowed to
emit a coordinate.** Not discouraged from it — unable to. There is no field
anywhere in the scene language that accepts an `x`, a `y`, a width or a font
size. A model picks a named layout and fills slots; `src/lib/scene/layouts.ts`
does every bit of the geometry, in code, under test. Everything else in these
two commits is scaffolding around keeping that true, and around being able to
prove that what got drawn is what got measured.

## The one-sentence version

A scene is a named layout plus up to six typed elements with no positions;
`layoutScene()` turns that into real pixel rectangles with every string wrapped
and fitted against the **actual glyph advances of the bundled font**;
`checkScene()` proves nothing overflows, overlaps or leaves the platform's safe
zone; and ten primitive components draw exactly the rectangles and font sizes
that were measured, with time as a prop so the same components run in Remotion
and in a review gallery.

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

**No migration, no service, no router, no registry entry.** That is not an
oversight: 16a and 16b add no stored data and gate nothing. `motionStudio` and
`motionVideos` arrive with 16d, which is the first commit that can spend a
credit.

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

## It touched shared code four times

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

## Decided differently from the phase file

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

## The gallery found two defects in its own fixtures

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

## What 16c and 16d inherit

- **A style needs two fonts and only one family is bundled.** `public/fonts`
  holds Geist at 400 and 700 — one family, two weights — so 16c's "code
  validates that both fonts are actually bundled" has a single candidate to
  validate against, and "palette, two fonts" cannot be honoured until somebody
  chooses and licenses a second family. The validation is buildable; a library
  of 6–10 styles cannot be typographically distinct without it. Same shape as
  Phase 11's empty catalogue: the mechanism is code, the content is an owner
  decision.
- **`resolveSceneAnchors` exists and nothing calls it.** It converts a scene's
  anchors to beat-relative seconds and it is the generator's job to call it,
  which is 16d. Until then a stored scene could still carry an anchor at render
  time, and `elementWindowSeconds` handles that by showing the element for the
  **whole beat** with one warning per process — the content is right and only
  its timing is wrong, where the alternative is a hole in a paid frame. Grep
  `RESOLVE_BEFORE_STORING` and `AN_UNRESOLVED_ANCHOR_SHOWS_THE_WHOLE_BEAT`.
- **The designer prompt should be generated from `SCENE_PRIMITIVES` and
  `LAYOUT_SLOTS`**, not written by hand, so the catalogue the model is shown
  cannot drift from the one the checks enforce.
- **`GAP_VH`, the 62/38 hero split, the role size table and the animation
  durations are unreviewed design numbers.** They are data in one table
  precisely so the gallery can change them without touching code.

## What is NOT in this phase

Generated animation code, 3D and presenter characters, all of which the phase
file excludes. Style tokens are 16c. The storyboard, the per-beat model call,
the vision pass, the bounded repair loop and the beat strip are 16d, as are both
registry entries and all metering.

## What has never run

Be precise about this, because the tests are green and the green is narrower
than it looks.

**Nothing has been composited to MP4.** `motion → MotionScene` is registered and
`next build` succeeds, but no motion document has ever been rendered — that
needs Phase 02's R2 and Phase 04's AWS deploy like every other format. So the
phase's "a hand-written three-scene document renders to MP4 with no model
involved" is **not met**; its parsing and checking half is, and its rendering
half has never been attempted.

**Nobody has looked at the gallery.** The phase's first Done-when line is "every
primitive and layout renders in the gallery, in every palette, reviewed by a
human". The gallery exists, covers every primitive, every layout and all eight
named animations — each asserted by a test, so an eleventh primitive cannot skip
review — and runs `checkScene` live for the chosen aspect, palette and safe zone
with the errors printed on each card. The review itself has not happened and
cannot be delegated to a test.

What **is** genuinely verified is the pure half, by 200 tests: the measurement
against real advances, auto-fit and its floor, the overflow and overlap checks in
the phase's own wording, the document round trip, graph layout determinism and
non-overlap, the safe-zone matrix across every layout at both aspects in all four
platform zones, and the constraint that no animation can move the measured ink.

"Across 20 test videos, no rendered beat has overlapping or cut-off content", the
60-second-in-under-10-minutes budget, the repair loop, and every metering line
belong to 16d and are untouched.
