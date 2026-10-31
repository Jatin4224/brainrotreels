/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: GALLERY_SCENES, GALLERY_IS_THE_REVIEW_SURFACE,
 *   EVERY_PRIMITIVE_EVERY_LAYOUT, HOSTILE_COPY_IS_IN_THE_GALLERY,
 *   SCENES_ARE_DATA
 *
 * WHAT:  The hand-written scenes the review gallery draws — eleven beats that
 *        between them use every primitive and every layout.
 *
 * WHY:   GALLERY_IS_THE_REVIEW_SURFACE, which is the phase's step 7 and the
 *        one check in this phase that a test cannot make. architecture.md
 *        names the weak point plainly: motion quality depends on the primitive
 *        library, not on the model. So the primitives get looked at by a human
 *        BEFORE any AI is connected, while there is still nothing else to
 *        blame for a bad frame.
 *
 *        EVERY_PRIMITIVE_EVERY_LAYOUT is asserted by `scene.test.ts` rather
 *        than promised here: the test fails if a primitive or a layout has no
 *        card, so adding an eleventh primitive in a later phase cannot quietly
 *        skip review.
 *
 *        SCENES_ARE_DATA, in a pure module rather than in the route's
 *        `_components`. Three consumers need them and only one is a screen:
 *        the gallery draws them, the test checks them, and the "renders to MP4
 *        with no model involved" path builds a document out of them. A fixture
 *        living inside a React component would be reachable by exactly one of
 *        those.
 *
 *        HOSTILE_COPY_IS_IN_THE_GALLERY. Two cards carry deliberately awkward
 *        text — a long compound word and a label far longer than its slot
 *        wants — because the overflow machinery is the part of this engine most
 *        likely to be wrong, and a gallery of comfortable three-word headlines
 *        would show none of it. Both still PASS their checks: they are long
 *        enough to exercise auto-fit down toward the floor, not long enough to
 *        break it. The scenes that genuinely overflow belong in the test, not
 *        in a surface a human is asked to approve.
 *
 *        The animations vary across the set on purpose, so all eight named
 *        movements appear somewhere — an entrance nobody has watched is an
 *        entrance nobody has reviewed.
 * WHERE: The motion gallery route; scene.test.ts; a Remotion composition that
 *        renders them end to end.
 */

import type { GalleryScene } from "@/lib/types/scene";

export const GALLERY_SCENES: readonly GalleryScene[] = [
  {
    id: "title-and-subhead",
    title: "Title",
    note: "A headline with a subhead under it. The subhead takes the accent colour so it cannot read as a headline that got cut off.",
    durationSeconds: 3,
    scene: {
      layout: "stack-center",
      elements: [
        {
          id: "head",
          kind: "title",
          text: "Three numbers",
          subhead: "that explain the quarter",
          in: 0,
          entrance: "rise",
          exit: "fade",
        },
      ],
    },
  },
  {
    id: "kinetic-line",
    title: "Kinetic text",
    note: "Words arriving one at a time, over a callout that is already settled. Watch that the last word lands well before the beat cuts.",
    durationSeconds: 4,
    scene: {
      layout: "hero-plus-caption",
      elements: [
        {
          id: "line",
          kind: "kineticText",
          text: "Nobody finishes setup",
          unit: "word",
          in: 0,
          entrance: "rise",
          exit: "fade",
        },
        {
          id: "note",
          kind: "callout",
          text: "and we never asked why",
          tone: "neutral",
          in: 0.8,
          entrance: "wipe-up",
          exit: "fade",
        },
      ],
    },
  },
  {
    id: "stat-hero",
    title: "Counter",
    note: "A figure counting up to 41% with a caption under it. The size was fitted to the WIDEST frame of the count, so the digits must not jitter as it grows.",
    durationSeconds: 4,
    scene: {
      layout: "hero-plus-caption",
      elements: [
        {
          id: "stat",
          kind: "counter",
          from: 0,
          to: 41,
          suffix: "%",
          decimals: 0,
          grouped: true,
          in: 0,
          entrance: "pop",
          exit: "fade",
        },
        {
          id: "caption",
          kind: "callout",
          text: "of signups never finish setup",
          tone: "warning",
          in: 0.5,
          entrance: "rise",
          exit: "fade",
        },
      ],
    },
  },
  {
    id: "big-grouped-number",
    title: "Counter, grouped",
    note: "HOSTILE_COPY_IS_IN_THE_GALLERY — a prefix, a suffix and thousands separators, which is the string most likely to overflow a numeral slot.",
    durationSeconds: 4,
    scene: {
      layout: "stack-center",
      elements: [
        {
          id: "revenue",
          kind: "counter",
          from: 0,
          to: 1250000,
          prefix: "$",
          decimals: 0,
          grouped: true,
          label: "annual recurring revenue",
          in: 0,
          entrance: "fade",
          exit: "fade",
        },
      ],
    },
  },
  {
    id: "meter-hero",
    title: "Meter",
    note: "One proportion, with the empty part of the track drawn from the palette's own text colour at low alpha rather than a sixth colour.",
    durationSeconds: 3.5,
    scene: {
      layout: "hero-plus-caption",
      elements: [
        {
          id: "share",
          kind: "meter",
          value: 0.72,
          label: "Churn comes from the first week",
          showPercent: true,
          in: 0,
          entrance: "fade",
          exit: "fade",
        },
        {
          id: "under",
          kind: "callout",
          text: "Seven days decides the year",
          tone: "negative",
          in: 0.6,
          entrance: "rise",
          exit: "fade",
        },
      ],
    },
  },
  {
    id: "bars",
    title: "Bar chart",
    note: "Five bars on ONE shared scale, staggered. Check that the labels and the figures never touch the track between them.",
    durationSeconds: 5,
    scene: {
      layout: "hero-plus-caption",
      elements: [
        {
          id: "chart",
          kind: "barChart",
          bars: [
            { label: "Signup", value: 100 },
            { label: "Verified", value: 82 },
            { label: "Imported", value: 54 },
            { label: "Invited", value: 31 },
            { label: "Active", value: 19 },
          ],
          unit: "%",
          in: 0,
          entrance: "fade",
          exit: "fade",
        },
        {
          id: "chart-note",
          kind: "callout",
          text: "Every step loses a fifth",
          tone: "warning",
          in: 1.6,
          entrance: "fall",
          exit: "fade",
        },
      ],
    },
  },
  {
    id: "compare",
    title: "Compare",
    note: "Two sides with a rule between them, taken from the gap the layout engine left — not from a fraction this component invented.",
    durationSeconds: 4,
    scene: {
      layout: "stack-center",
      elements: [
        {
          id: "head",
          kind: "title",
          text: "Before and after",
          in: 0,
          entrance: "fade",
          exit: "fade",
        },
        {
          id: "sides",
          kind: "compare",
          left: { label: "Old onboarding", value: "19%" },
          right: { label: "Five-minute setup", value: "48%" },
          in: 0.4,
          entrance: "slide-left",
          exit: "fade",
        },
      ],
    },
  },
  {
    id: "list",
    title: "List",
    note: "Three items revealed in sequence, indented past their marks. The third is long enough to wrap and shrink toward the body floor — at four items it would not fit a 9:16 frame inside TikTok's insets, which is the vertical limit of this layout.",
    durationSeconds: 5,
    scene: {
      layout: "stack-center",
      elements: [
        {
          id: "head",
          kind: "title",
          text: "What we changed",
          in: 0,
          entrance: "rise",
          exit: "fade",
        },
        {
          id: "items",
          kind: "list",
          /* THREE_ITEMS_IS_WHAT_FITS, and the number was found by the test
           * rather than chosen. With FOUR items under a title, a 9:16 frame
           * inside TikTok's insets leaves each row about one line tall, so any
           * item that wraps overflows by a few pixels — three successive
           * shortenings of the long line below each still missed, by 31px,
           * then 7px, then 2px. Chasing characters would have produced a
           * fixture that passed and told nobody anything; the honest answer is
           * that this layout holds three list items plus a heading in a
           * vertical frame, and the long third item stays so auto-fit is
           * actually exercised. Grep HOSTILE_COPY_IS_IN_THE_GALLERY. */
          items: [
            "Cut the form to one field",
            "Imported their data for them",
            "Replaced the welcome tour with a working example",
          ],
          reveal: "sequential",
          in: 0.3,
          entrance: "slide-right",
          exit: "fade",
        },
      ],
    },
  },
  {
    id: "split-figures",
    title: "Split, two figures",
    note: "SPLIT_ALONG_THE_LONG_AXIS — two columns on 16:9 and two rows on 9:16. Compare the two aspects on this card in particular.",
    durationSeconds: 4,
    scene: {
      layout: "split-2",
      elements: [
        {
          id: "left",
          kind: "counter",
          from: 0,
          to: 19,
          suffix: "%",
          decimals: 0,
          grouped: true,
          label: "Week one",
          in: 0,
          entrance: "slide-right",
          exit: "fade",
        },
        {
          id: "right",
          kind: "counter",
          from: 0,
          to: 48,
          suffix: "%",
          decimals: 0,
          grouped: true,
          label: "After the change",
          in: 0.35,
          entrance: "slide-left",
          exit: "fade",
        },
      ],
    },
  },
  {
    id: "grid-icons",
    title: "Grid of icons",
    note: "Three glyphs with labels. The icon is sized from the band ABOVE its label, which is what stops it overlapping text nothing measures.",
    durationSeconds: 4,
    scene: {
      layout: "grid-3",
      elements: [
        {
          id: "a",
          kind: "icon",
          icon: "clock",
          label: "Five minutes",
          in: 0,
          entrance: "pop",
          exit: "fade",
        },
        {
          id: "b",
          kind: "icon",
          icon: "check",
          label: "One field",
          in: 0.25,
          entrance: "pop",
          exit: "fade",
        },
        {
          id: "c",
          kind: "icon",
          icon: "spark",
          label: "A working example",
          in: 0.5,
          entrance: "pop",
          exit: "fade",
        },
      ],
    },
  },
  {
    id: "flow",
    title: "Flow graph",
    note: "A branching process laid out by Dagre, with the edges drawn from its ROUTES rather than centre to centre. Nodes arrive in the order they are written.",
    durationSeconds: 5,
    scene: {
      layout: "flow-graph",
      elements: [
        {
          id: "head",
          kind: "title",
          text: "Where they go",
          in: 0,
          entrance: "fade",
          exit: "fade",
        },
        {
          id: "graph",
          kind: "flowGraph",
          direction: "down",
          nodes: [
            { id: "signup", label: "Signup" },
            { id: "setup", label: "Setup" },
            { id: "active", label: "Active" },
            { id: "churn", label: "Gone" },
          ],
          edges: [
            { from: "signup", to: "setup" },
            { from: "setup", to: "active" },
            { from: "setup", to: "churn" },
          ],
          in: 0.3,
          entrance: "fade",
          exit: "fade",
        },
      ],
    },
  },
];
