/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: scene test, REAL_ADVANCES_NOT_AN_ESTIMATE,
 *   AUTO_FIT_HAS_A_FLOOR, OVERLAP_IS_CHECKED_ON_INK,
 *   DISJOINT_IN_TIME_IS_NOT_AN_OVERLAP, FIT_IS_DETERMINISTIC,
 *   ROUND_TRIP_IS_LOSSLESS, NO_COORDINATE_SURVIVES_THE_SEAM
 *
 * WHAT:  That the measurement is real, that the checks catch an overflow and
 *        an overlap, that a scene survives the document round trip unchanged,
 *        and that every layout places every primitive inside the safe zone.
 *
 * WHY:   Two of these are the phase file's own "Done when" lines —
 *        "the deterministic checks catch an overflowing text element and an
 *        overlap, in a test" — and they are written here as the phase words
 *        them rather than as something adjacent that happens to pass.
 *
 *        REAL_ADVANCES_NOT_AN_ESTIMATE is asserted by CONTRAST rather than by
 *        a golden number: `WWWW` against `iiii` in the same face at the same
 *        size. Any average-width implementation returns the same number for
 *        both, so the assertion fails the moment somebody replaces the table
 *        with an estimate — which is the regression worth catching, since an
 *        estimate would still look plausible in every other test.
 *
 *        FIT_IS_DETERMINISTIC is asserted because Phase 04 reuses a render
 *        when the document hashes equal, and Phase 16d promises that
 *        redesigning one beat leaves the others byte-identical. Both are
 *        false if laying the same scene out twice can differ.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { motionFixture } from "@/lib/timeline/fixtures/motion";
import { SAFE_ZONES } from "@/lib/types/caption";
import {
  SCENE_ANIMATIONS,
  SCENE_BEAT_SECONDS,
  SCENE_LAYOUTS,
  SCENE_PRIMITIVES,
  SCENE_TEXT_ROLE_SPECS,
  type Scene,
  type SceneCheckContext,
  type SceneErrorCode,
} from "@/lib/types/scene";

import { elementWindowSeconds, resolveSceneAnchors } from "./anchors";
import { checkScene } from "./check";
import { fromSceneSpec, parseScene, toSceneSpec } from "./document";
import { GALLERY_SCENES } from "./gallery";
import { fitTextRun, measureLineWidth, wrapText } from "./measure";
import { formatCounterValue, elementTextRuns } from "./runs";

const PORTRAIT: SceneCheckContext = {
  canvas: { width: 1080, height: 1920, fps: 30 },
  safeZone: "none",
  wordCount: 40,
  durationSeconds: 4,
};

const LANDSCAPE: SceneCheckContext = {
  ...PORTRAIT,
  canvas: { width: 1920, height: 1080, fps: 30 },
};

function codes(errors: readonly { code: SceneErrorCode }[]): SceneErrorCode[] {
  return errors.map((error) => error.code);
}

describe("measurement against the bundled faces", () => {
  it("gives narrow and wide glyphs different widths", () => {
    /* REAL_ADVANCES_NOT_AN_ESTIMATE. 912 against 246 units at weight 400, so
     * roughly 3.7x — an average character width would make these equal. */
    const wide = measureLineWidth("WWWW", 400, 100);
    const narrow = measureLineWidth("iiii", 400, 100);

    expect(wide).toBeGreaterThan(narrow * 3);
  });

  it("measures the two bundled weights differently", () => {
    /* The bold face is genuinely wider per glyph; one shared table would make
     * a 700-weight headline measure as if it were 400 and overflow unnoticed. */
    expect(measureLineWidth("Agency", 700, 100)).toBeGreaterThan(
      measureLineWidth("Agency", 400, 100),
    );
  });

  it("scales linearly with the font size", () => {
    const at50 = measureLineWidth("Quarterly revenue", 400, 50);
    const at100 = measureLineWidth("Quarterly revenue", 400, 100);

    expect(at100).toBeCloseTo(at50 * 2, 6);
  });

  it("charges an unmapped code point the widest advance, not nothing", () => {
    /* ADVANCE_SUM_IS_AN_UPPER_BOUND: an emoji the Latin subset has no glyph
     * for must not measure as zero, or a callout full of them would pass every
     * check and then wrap in the render. */
    expect(measureLineWidth("🙂", 400, 100)).toBeGreaterThan(0);
  });

  it("counts an astral character once, not twice", () => {
    const one = measureLineWidth("🙂", 400, 100);
    const two = measureLineWidth("🙂🙂", 400, 100);

    expect(two).toBeCloseTo(one * 2, 6);
  });

  it("wraps on whitespace and never inside a word", () => {
    const lines = wrapText("the quarter that nobody finished", 400, 60, 400);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line).not.toMatch(/^\s|\s$/u);
    expect(lines.join(" ")).toBe("the quarter that nobody finished");
  });

  it("puts an unbreakable word on its own line", () => {
    const lines = wrapText("short Unbreakablewordthatistoolong x", 400, 80, 300);

    expect(lines).toContain("Unbreakablewordthatistoolong");
  });
});

describe("auto-fit has a floor", () => {
  const box = { x: 0, y: 0, width: 600, height: 300 };

  it("shrinks long text rather than refusing it", () => {
    const short = fitTextRun(
      { path: "text", text: "Fix it", role: "display" },
      box,
      1920,
    );
    const long = fitTextRun(
      {
        path: "text",
        text: "Fix the first five minutes of the onboarding flow",
        role: "display",
      },
      box,
      1920,
    );

    expect(short.overflow).toBe(false);
    expect(long.fontPx).toBeLessThan(short.fontPx);
  });

  it("never shrinks past the role's floor, and says so", () => {
    /* AUTO_FIT_HAS_A_FLOOR, and the phase's "catch an overflowing text
     * element". One unbreakable token far wider than the box at the smallest
     * readable size. */
    const run = fitTextRun(
      {
        path: "text",
        text: "Unbreakablesupercalifragilisticexpialidociousoverflowtoken",
        role: "display",
      },
      { x: 0, y: 0, width: 300, height: 200 },
      1920,
    );

    const floorPx = (SCENE_TEXT_ROLE_SPECS.display.minSizeVh / 100) * 1920;
    expect(run.overflow).toBe(true);
    expect(run.fontPx).toBeCloseTo(floorPx, 6);
    expect(run.widthPx).toBeGreaterThan(300);
  });

  it("is deterministic", () => {
    const run = { path: "text", text: "Three numbers", role: "display" } as const;

    expect(fitTextRun(run, box, 1920)).toEqual(fitTextRun(run, box, 1920));
  });
});

describe("checkScene", () => {
  const cleanTitle: Scene = {
    layout: "stack-center",
    elements: [
      {
        kind: "title",
        id: "head",
        text: "Three numbers",
        in: 0,
        entrance: "rise",
        exit: "fade",
      },
    ],
  };

  it("passes a scene that fits", () => {
    const result = checkScene(cleanTitle, PORTRAIT);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("reports an overflowing element with the path and the measurement", () => {
    const scene: Scene = {
      layout: "stack-center",
      elements: [
        {
          kind: "counter",
          id: "stat",
          to: 1250000,
          from: 0,
          decimals: 2,
          grouped: true,
          prefix: "$",
          suffix: " per seat per month",
          in: 0,
          entrance: "pop",
          exit: "fade",
        },
      ],
    };

    const result = checkScene(scene, PORTRAIT);
    const overflow = result.errors.filter(
      (error) => error.code === "TEXT_OVERFLOW",
    );

    expect(result.ok).toBe(false);
    expect(overflow.length).toBeGreaterThan(0);
    expect(overflow[0]?.path).toBe("elements.0.to");
    expect(overflow[0]?.message).toMatch(/floor/u);
  });

  it("reports an overlap between two elements that share the frame", () => {
    /* OVERLAP_IS_CHECKED_ON_INK. On 16:9 `split-2` gives two columns, so a
     * run that cannot be shrunk into its column bleeds sideways into the
     * other one — which is a real picture, not a contrived rectangle. */
    const scene: Scene = {
      layout: "split-2",
      elements: [
        {
          kind: "title",
          id: "left",
          text: "Unbreakablesupercalifragilisticexpialidociousoverflowtoken",
          in: 0,
          entrance: "fade",
          exit: "fade",
        },
        {
          kind: "title",
          id: "right",
          text: "After",
          in: 0,
          entrance: "fade",
          exit: "fade",
        },
      ],
    };

    const result = checkScene(scene, LANDSCAPE);

    expect(codes(result.errors)).toContain("ELEMENT_OVERLAP");
    expect(
      result.errors.find((error) => error.code === "ELEMENT_OVERLAP")?.message,
    ).toMatch(/right/u);
  });

  it("does not report an overlap when the two are never on screen together", () => {
    /* DISJOINT_IN_TIME_IS_NOT_AN_OVERLAP — the same geometry as above, with
     * the first element gone before the second arrives. Sequencing two things
     * through one region is normal design and must not be refused. */
    const scene: Scene = {
      layout: "split-2",
      elements: [
        {
          kind: "title",
          id: "left",
          text: "Unbreakablesupercalifragilisticexpialidociousoverflowtoken",
          in: 0,
          out: 1,
          entrance: "fade",
          exit: "fade",
        },
        {
          kind: "title",
          id: "right",
          text: "After",
          in: 1.5,
          entrance: "fade",
          exit: "fade",
        },
      ],
    };

    expect(codes(checkScene(scene, LANDSCAPE).errors)).not.toContain(
      "ELEMENT_OVERLAP",
    );
  });

  it("refuses a layout given the wrong number of elements", () => {
    const scene: Scene = {
      layout: "grid-3",
      elements: [
        { kind: "callout", id: "a", text: "One", tone: "neutral", in: 0, entrance: "fade", exit: "fade" },
        { kind: "callout", id: "b", text: "Two", tone: "neutral", in: 0, entrance: "fade", exit: "fade" },
      ],
    };

    expect(codes(checkScene(scene, PORTRAIT).errors)).toContain("SLOT_COUNT");
  });

  it("refuses a flow-graph layout with no graph in it", () => {
    const scene: Scene = {
      layout: "flow-graph",
      elements: [
        { kind: "callout", id: "a", text: "A process", tone: "neutral", in: 0, entrance: "fade", exit: "fade" },
      ],
    };

    expect(codes(checkScene(scene, PORTRAIT).errors)).toContain(
      "LAYOUT_REQUIRES_PRIMITIVE",
    );
  });

  it("refuses an edge naming a node the graph does not have", () => {
    const scene: Scene = {
      layout: "flow-graph",
      elements: [
        {
          kind: "flowGraph",
          id: "g",
          direction: "down",
          nodes: [
            { id: "a", label: "Signup" },
            { id: "b", label: "Setup" },
          ],
          edges: [{ from: "a", to: "nowhere" }],
          in: 0,
          entrance: "fade",
          exit: "fade",
        },
      ],
    };

    expect(codes(checkScene(scene, PORTRAIT).errors)).toContain(
      "GRAPH_EDGE_UNKNOWN_NODE",
    );
  });

  it("refuses an anchor past the end of the transcript", () => {
    const scene: Scene = {
      layout: "stack-center",
      elements: [
        {
          kind: "callout",
          id: "a",
          text: "Later",
          tone: "neutral",
          in: { wordIndex: 400 },
          entrance: "fade",
          exit: "fade",
        },
      ],
    };

    expect(codes(checkScene(scene, PORTRAIT).errors)).toContain(
      "UNKNOWN_WORD_ANCHOR",
    );
  });

  it("refuses an element that leaves before it arrives", () => {
    const scene: Scene = {
      layout: "stack-center",
      elements: [
        {
          kind: "callout",
          id: "a",
          text: "Backwards",
          tone: "neutral",
          in: 2,
          out: 1,
          entrance: "fade",
          exit: "fade",
        },
      ],
    };

    expect(codes(checkScene(scene, PORTRAIT).errors)).toContain(
      "TIMING_INVERTED",
    );
  });

  it("refuses two elements sharing an id", () => {
    const scene: Scene = {
      layout: "split-2",
      elements: [
        { kind: "callout", id: "same", text: "One", tone: "neutral", in: 0, entrance: "fade", exit: "fade" },
        { kind: "callout", id: "same", text: "Two", tone: "neutral", in: 0, entrance: "fade", exit: "fade" },
      ],
    };

    expect(codes(checkScene(scene, PORTRAIT).errors)).toContain("DUPLICATE_ID");
  });

  it("lays the same scene out identically every time", () => {
    /* FIT_IS_DETERMINISTIC — Phase 04 reuses a render when the document
     * hashes equal, so the same scene must produce the same geometry. */
    expect(checkScene(cleanTitle, PORTRAIT).placed).toEqual(
      checkScene(cleanTitle, PORTRAIT).placed,
    );
  });
});

describe("every layout places short content inside the safe zone", () => {
  /* The programmatic half of the phase's gallery requirement. The gallery
   * itself (16b) is a human looking at pixels, which this cannot replace —
   * but a layout that puts an element outside the frame should fail in CI,
   * not in review. */
  const filler = (index: number): Scene["elements"][number] => ({
    kind: "callout",
    id: `e${index}`,
    text: "Short line",
    tone: "neutral",
    in: 0,
    entrance: "fade",
    exit: "fade",
  });

  const graph: Scene["elements"][number] = {
    kind: "flowGraph",
    id: "g",
    direction: "down",
    nodes: [
      { id: "a", label: "Signup" },
      { id: "b", label: "Setup" },
      { id: "c", label: "Active" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
    in: 0,
    entrance: "fade",
    exit: "fade",
  };

  const counts: Record<(typeof SCENE_LAYOUTS)[number], number> = {
    "stack-center": 2,
    "split-2": 2,
    "grid-3": 3,
    "hero-plus-caption": 2,
    "flow-graph": 2,
  };

  for (const layout of SCENE_LAYOUTS) {
    for (const [label, ctx] of [
      ["portrait", PORTRAIT],
      ["landscape", LANDSCAPE],
    ] as const) {
      for (const safeZone of ["none", "tiktok", "reels", "shorts"] as const) {
        it(`${layout} on ${label} with the ${safeZone} safe zone`, () => {
          const count = counts[layout];
          const elements =
            layout === "flow-graph"
              ? [filler(0), graph]
              : Array.from({ length: count }, (_, i) => filler(i));

          const result = checkScene(
            { layout, elements },
            { ...ctx, safeZone },
          );

          expect(codes(result.errors)).toEqual([]);
        });
      }
    }
  }
});

describe("graph layout", () => {
  const scene: Scene = {
    layout: "flow-graph",
    elements: [
      {
        kind: "flowGraph",
        id: "g",
        direction: "down",
        nodes: [
          { id: "a", label: "Signup" },
          { id: "b", label: "Setup" },
          { id: "c", label: "Churn" },
          { id: "d", label: "Active" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "b", to: "d" },
        ],
        in: 0,
        entrance: "fade",
        exit: "fade",
      },
    ],
  };

  it("places no two nodes on top of each other", () => {
    const placed = checkScene(scene, PORTRAIT).placed;
    const nodes = placed?.elements[0]?.graph?.nodes ?? [];

    expect(nodes).toHaveLength(4);
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]?.rect;
        const b = nodes[j]?.rect;
        if (a === undefined || b === undefined) continue;
        const apart =
          a.x + a.width <= b.x + 1 ||
          b.x + b.width <= a.x + 1 ||
          a.y + a.height <= b.y + 1 ||
          b.y + b.height <= a.y + 1;
        expect(apart).toBe(true);
      }
    }
  });

  it("keeps the whole graph inside its slot", () => {
    const placed = checkScene(scene, PORTRAIT).placed;
    const slot = placed?.elements[0]?.rect;
    const nodes = placed?.elements[0]?.graph?.nodes ?? [];

    expect(slot).toBeDefined();
    for (const node of nodes) {
      expect(node.rect.x).toBeGreaterThanOrEqual((slot?.x ?? 0) - 1);
      expect(node.rect.y).toBeGreaterThanOrEqual((slot?.y ?? 0) - 1);
      expect(node.rect.x + node.rect.width).toBeLessThanOrEqual(
        (slot?.x ?? 0) + (slot?.width ?? 0) + 1,
      );
      expect(node.rect.y + node.rect.height).toBeLessThanOrEqual(
        (slot?.y ?? 0) + (slot?.height ?? 0) + 1,
      );
    }
  });

  it("is deterministic across runs", () => {
    expect(checkScene(scene, PORTRAIT).placed).toEqual(
      checkScene(scene, PORTRAIT).placed,
    );
  });
});

describe("counter formatting and measurement", () => {
  it("groups thousands and honours decimals without a locale", () => {
    expect(
      formatCounterValue({ value: 1250000, decimals: 0, grouped: true }),
    ).toBe("1,250,000");
    expect(
      formatCounterValue({ value: 1999.96, decimals: 1, grouped: true }),
    ).toBe("2,000.0");
    expect(
      formatCounterValue({ value: -4200, decimals: 0, grouped: true }),
    ).toBe("-4,200");
    expect(
      formatCounterValue({
        value: 41,
        decimals: 0,
        grouped: false,
        prefix: "$",
        suffix: "/mo",
      }),
    ).toBe("$41/mo");
  });

  it("measures the widest endpoint of a count-down, not just the target", () => {
    /* WIDEST_FRAME_IS_THE_ONE_THAT_MUST_FIT. Counting 5,000 → 10 is widest at
     * the START, so measuring `to` alone would pass a beat whose first second
     * is off the frame. */
    const runs = elementTextRuns({
      kind: "counter",
      id: "c",
      from: 5000,
      to: 10,
      decimals: 0,
      grouped: true,
      in: 0,
      entrance: "fade",
      exit: "fade",
    });

    expect(runs[0]?.text).toBe("5,000");
  });
});

describe("the document seam", () => {
  const scene: Scene = {
    layout: "hero-plus-caption",
    elements: [
      {
        kind: "counter",
        id: "stat",
        to: 41,
        from: 0,
        decimals: 0,
        grouped: true,
        suffix: "%",
        in: { wordIndex: 12 },
        entrance: "pop",
        exit: "fade",
      },
      {
        kind: "callout",
        id: "cap",
        text: "of signups never finish setup",
        tone: "warning",
        in: 0,
        entrance: "rise",
        exit: "fade",
      },
    ],
  };

  it("round-trips through the stored form unchanged", () => {
    /* ROUND_TRIP_IS_LOSSLESS. Phase 16d's "redesign one beat leaves the
     * others byte-identical" is false if saving rewrites an untouched beat. */
    const back = fromSceneSpec(toSceneSpec(scene));

    expect(back.ok).toBe(true);
    expect(back.ok ? back.scene : null).toEqual(scene);
  });

  it("stores no coordinates", () => {
    /* NO_COORDINATE_SURVIVES_THE_SEAM, from the writing side. */
    for (const element of toSceneSpec(scene).elements) {
      expect(element.box).toBeUndefined();
      expect(Object.keys(element.props ?? {})).not.toContain("box");
    }
  });

  it("refuses a stored element carrying a box", () => {
    /* …and from the reading side: a hand-edited or older-release document that
     * smuggled a position in must fail here, not be honoured. */
    const result = fromSceneSpec({
      layout: "stack-center",
      elements: [
        {
          id: "a",
          kind: "callout",
          box: { x: 0.1, y: 0.1, w: 0.5 },
          props: { text: "Hello", tone: "neutral" },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : codes(result.errors)).toContain("SCHEMA");
  });

  it("refuses an unknown primitive and an unknown layout", () => {
    expect(
      parseScene({ layout: "mosaic", elements: [] }).ok,
    ).toBe(false);
    expect(
      parseScene({
        layout: "stack-center",
        elements: [{ id: "a", kind: "hologram" }],
      }).ok,
    ).toBe(false);
  });

  it("reads every beat of the committed motion fixture", () => {
    /* FIXTURE_SPEAKS_THE_SCENE_LANGUAGE. The fixture has existed since Phase
     * 01 with layout and element names nothing implemented; this is the
     * assertion that keeps it a document the engine can actually lay out, and
     * it is the hand-written-document half of the phase's "renders with no
     * model involved" — the MP4 itself needs the components, which is 16b. */
    const doc = motionFixture();
    const sceneTrack = doc.tracks.find((track) => track.type === "scene");
    const items = sceneTrack?.type === "scene" ? sceneTrack.items : [];

    expect(items).toHaveLength(3);

    for (const item of items) {
      const parsed = fromSceneSpec(item.scene);
      expect(parsed.ok ? [] : parsed.errors).toEqual([]);
      if (!parsed.ok) continue;

      const duration = typeof item.duration === "number" ? item.duration : 0;
      const result = checkScene(parsed.scene, {
        canvas: doc.canvas,
        safeZone: doc.style.safeZone,
        wordCount: doc.words.length,
        durationSeconds: duration,
      });

      expect(result.errors).toEqual([]);
    }
  });

  it("applies the documented defaults when a scene omits them", () => {
    const parsed = parseScene({
      layout: "stack-center",
      elements: [{ id: "a", kind: "title", text: "Three numbers" }],
    });

    expect(parsed.ok).toBe(true);
    const element = parsed.ok ? parsed.scene.elements[0] : undefined;
    expect(element?.in).toBe(0);
    expect(element?.entrance).toBe("fade");
    expect(element?.out).toBeUndefined();
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: EVERY_PRIMITIVE_EVERY_LAYOUT, GALLERY_SCENES,
 *   GALLERY_IS_THE_REVIEW_SURFACE
 *
 * WHAT:  That the review gallery actually covers the library, and that every
 *        card in it is clean in every palette, aspect and safe zone.
 * WHY:   The human review the phase requires is only as good as the set it is
 *        run over. A primitive with no card would be approved by a reviewer
 *        who never saw it — so the coverage is a test, not a promise, and
 *        adding an eleventh primitive in a later phase cannot quietly skip
 *        review.
 *
 *        The clean-in-every-combination assertion is the one that earns its
 *        keep: a card can look right at 9:16 with no safe zone and sit under
 *        TikTok's button rail at 16:9, and nobody reviews all twenty-four
 *        combinations by eye.
 * WHERE: `npm test`.
 */
describe("the review gallery", () => {
  it("covers every primitive", () => {
    const used = new Set(
      GALLERY_SCENES.flatMap((entry) =>
        entry.scene.elements.map((element) => element.kind),
      ),
    );

    expect([...SCENE_PRIMITIVES].filter((kind) => !used.has(kind))).toEqual([]);
  });

  it("covers every layout", () => {
    const used = new Set(GALLERY_SCENES.map((entry) => entry.scene.layout));

    expect([...SCENE_LAYOUTS].filter((layout) => !used.has(layout))).toEqual(
      [],
    );
  });

  it("covers every named animation, so none ships unwatched", () => {
    const used = new Set(
      GALLERY_SCENES.flatMap((entry) =>
        entry.scene.elements.flatMap((element) => [
          element.entrance,
          element.exit,
        ]),
      ),
    );

    /* `none` is excluded: it is the absence of a movement, and a card showing
     * nothing happening is not a review of anything. */
    expect(
      [...SCENE_ANIMATIONS].filter(
        (animation) => animation !== "none" && !used.has(animation),
      ),
    ).toEqual([]);
  });

  it("gives every card a note saying what it is for", () => {
    for (const entry of GALLERY_SCENES) {
      expect(entry.note.length, entry.id).toBeGreaterThan(20);
    }
  });

  it("keeps every beat inside the phase's 1.5-6 second range", () => {
    for (const entry of GALLERY_SCENES) {
      expect(entry.durationSeconds, entry.id).toBeGreaterThanOrEqual(
        SCENE_BEAT_SECONDS.min,
      );
      expect(entry.durationSeconds, entry.id).toBeLessThanOrEqual(
        SCENE_BEAT_SECONDS.max,
      );
    }
  });

  for (const entry of GALLERY_SCENES) {
    for (const [label, ctx] of [
      ["portrait", PORTRAIT],
      ["landscape", LANDSCAPE],
    ] as const) {
      for (const safeZone of SAFE_ZONES) {
        it(`${entry.id} is clean at ${label} in the ${safeZone} safe zone`, () => {
          const result = checkScene(entry.scene, {
            ...ctx,
            safeZone,
            /* Hand-written fixtures have no transcript, so they are timed in
               seconds and never anchored — asserted below. */
            wordCount: 0,
            durationSeconds: entry.durationSeconds,
          });

          expect(result.errors).toEqual([]);
        });
      }
    }
  }

  it("times every gallery element in seconds rather than by anchor", () => {
    /* A word anchor in a fixture would be unresolvable by construction and
       would fail the UNKNOWN_WORD_ANCHOR check at `wordCount: 0` above — this
       says so directly, so the reason is obvious rather than inferred from a
       failing combination. */
    for (const entry of GALLERY_SCENES) {
      for (const element of entry.scene.elements) {
        expect(typeof element.in, `${entry.id}.${element.id}`).toBe("number");
        if (element.out !== undefined) {
          expect(typeof element.out, `${entry.id}.${element.id}`).toBe(
            "number",
          );
        }
      }
    }
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: resolveSceneAnchors, elementWindowSeconds,
 *   RESOLVE_BEFORE_STORING, AN_UNRESOLVED_ANCHOR_SHOWS_THE_WHOLE_BEAT
 *
 * WHAT:  That an anchor becomes the right scene-relative second, and that one
 *        which somehow survives to render time shows its element rather than
 *        hiding it.
 * WHY:   This is the phase's "every number or diagram appears on the word that
 *        introduces it", reduced to the one arithmetic step it depends on. The
 *        subtraction of the beat's own start is the part that would be wrong
 *        silently: an absolute second looks correct on the first beat of a
 *        video and is wrong on every one after it.
 * WHERE: `npm test`.
 */
describe("scene anchors", () => {
  const words = [
    { i: 0, w: "we", s: 10, e: 10.2 },
    { i: 1, w: "lose", s: 10.2, e: 10.5 },
    { i: 2, w: "forty", s: 10.5, e: 11 },
    { i: 3, w: "percent", s: 11, e: 11.6 },
  ];

  const anchored: Scene = {
    layout: "stack-center",
    elements: [
      {
        kind: "callout",
        id: "a",
        text: "40%",
        tone: "negative",
        in: { wordIndex: 2 },
        entrance: "pop",
        exit: "fade",
      },
    ],
  };

  it("resolves an anchor to seconds from the start of the beat", () => {
    const resolved = resolveSceneAnchors({
      scene: anchored,
      words,
      beatStart: 10,
      beatDuration: 4,
    });

    /* Word 2 starts at 10.5s absolute and the beat starts at 10s, so the
     * element enters half a second in — not at 10.5. */
    expect(resolved.elements[0]?.in).toBeCloseTo(0.5, 6);
  });

  it("clamps an anchor that lands outside the beat", () => {
    const resolved = resolveSceneAnchors({
      scene: anchored,
      words,
      beatStart: 11,
      beatDuration: 2,
    });

    expect(resolved.elements[0]?.in).toBe(0);
  });

  it("falls back to the beat's bounds for an anchor past the transcript", () => {
    const resolved = resolveSceneAnchors({
      scene: {
        layout: "stack-center",
        elements: [
          {
            kind: "callout",
            id: "a",
            text: "later",
            tone: "neutral",
            in: { wordIndex: 99 },
            entrance: "fade",
            exit: "fade",
          },
        ],
      },
      words,
      beatStart: 0,
      beatDuration: 3,
    });

    expect(resolved.elements[0]?.in).toBe(0);
  });

  it("leaves a scene timed in seconds untouched", () => {
    /* ROUND_TRIP_IS_LOSSLESS applies here too: resolving an already-resolved
     * scene must not move anything, or re-saving a beat would rewrite it. */
    const seconds: Scene = {
      layout: "stack-center",
      elements: [
        {
          kind: "callout",
          id: "a",
          text: "steady",
          tone: "neutral",
          in: 1.25,
          out: 2.5,
          entrance: "fade",
          exit: "fade",
        },
      ],
    };

    expect(
      resolveSceneAnchors({
        scene: seconds,
        words,
        beatStart: 0,
        beatDuration: 4,
      }),
    ).toEqual(seconds);
  });

  it("shows an element for the whole beat when its anchor survived", () => {
    /* AN_UNRESOLVED_ANCHOR_SHOWS_THE_WHOLE_BEAT — the content is right and
     * only its timing is wrong, which beats a hole in a paid frame. */
    const element = anchored.elements[0];
    expect(element).toBeDefined();
    if (element === undefined) return;

    expect(elementWindowSeconds(element, 3)).toEqual({ from: 0, to: 3 });
  });

  it("collapses an inverted window to the beat rather than returning nothing", () => {
    const element = {
      kind: "callout" as const,
      id: "a",
      text: "backwards",
      tone: "neutral" as const,
      in: 2,
      out: 1,
      entrance: "fade" as const,
      exit: "fade" as const,
    };

    expect(elementWindowSeconds(element, 3)).toEqual({ from: 0, to: 3 });
  });
});
