/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: checkScene, DETERMINISTIC_CHECKS_FIRST,
 *   OVERLAP_IS_CHECKED_ON_INK, DISJOINT_IN_TIME_IS_NOT_AN_OVERLAP,
 *   UNRESOLVED_IS_TREATED_AS_OVERLAPPING, EVERY_ERROR_IS_ACTIONABLE
 *
 * WHAT:  Every defect a scene can have that geometry can prove, reported as a
 *        list with the dotted path of what is wrong.
 *
 * WHY:   DETERMINISTIC_CHECKS_FIRST is the phase's step 12 and the economics
 *        of the whole designer loop. A still render plus a vision call is
 *        roughly a dollar per beat and returns an opinion; these checks are
 *        free, run in a millisecond, and return a fact with a path attached.
 *        So everything that CAN be proved is proved here, and the vision pass
 *        only ever sees beats that are already geometrically correct — which
 *        is also the only way its judgement is worth anything, since a model
 *        asked to review a frame with text off the edge will report that and
 *        nothing else.
 *
 *        EVERY_ERROR_IS_ACTIONABLE. Each message names the element, the field
 *        and the measured number — "overflows by 148px at the 3vh floor", not
 *        "does not fit". Phase 16d sends these verbatim into a bounded
 *        two-attempt repair, and a model cannot fix a sentence that does not
 *        say what to change. That is also why the result carries ALL errors
 *        rather than throwing on the first: two attempts cannot be spent
 *        discovering one problem at a time.
 *
 *        OVERLAP_IS_CHECKED_ON_INK, with DISJOINT_IN_TIME_IS_NOT_AN_OVERLAP
 *        beside it. The overlap check compares the rectangles the text
 *        actually occupies, not the slots — slots are laid out not to touch,
 *        so comparing those would be theatre (see `drawnRect`). And two
 *        elements that are never on screen together cannot overlap, which
 *        matters because sequencing elements through one region is a normal
 *        way to build a six-second beat; refusing it would make the engine
 *        reject good design.
 *
 *        UNRESOLVED_IS_TREATED_AS_OVERLAPPING is the deliberate conservative
 *        edge. When either element is timed by a word anchor, this module
 *        cannot know the seconds — it is pure and holds a word COUNT, not the
 *        transcript — so it assumes the two share the frame and checks them.
 *        The cost is a possible false overlap on a beat that was fine, which
 *        is one repair attempt; the alternative is a missed overlap, which is
 *        a finished video with text on text. The asymmetry decides it, the
 *        same way ADVANCE_SUM_IS_AN_UPPER_BOUND decides the measurement.
 *
 * WHERE: Phase 16d's designer, before any still is rendered; the editor, while
 *        a beat is being edited; the gallery, which asserts its hand-written
 *        scenes are clean; scene.test.ts.
 */

import {
  LAYOUT_SLOTS,
  SCENE_TEXT_ROLE_SPECS,
  sceneError,
  type LayoutContext,
  type PlacedElement,
  type PlacedRect,
  type Scene,
  type SceneCheckResult,
  type SceneError,
  type SceneTimeValue,
  type StrictSceneElement,
} from "@/lib/types/scene";

import { layoutScene } from "./layouts";

/* One pixel. Below this, an overlap or an out-of-zone excursion is
 * floating-point noise from the slot arithmetic rather than something a viewer
 * could see, and reporting it would send clean beats back to the repair loop. */
const TOLERANCE_PX = 1;

/**
 * SOURCE OF TRUTH KEYWORDS: checkScene, DETERMINISTIC_CHECKS_FIRST
 *
 * WHAT:  Lays the scene out and reports everything wrong with it.
 * WHY:   Takes an already-parsed `Scene` — the SCHEMA error code belongs to
 *        `parseScene` in document.ts, which is the seam that turns a model's
 *        JSON or a stored document into this type. Splitting them means this
 *        function can assume its input is well-formed and spend all its words
 *        on geometry.
 * WHERE: See the file header.
 */
export function checkScene(
  scene: Scene,
  ctx: LayoutContext,
): SceneCheckResult {
  const errors: SceneError[] = [];
  const placed = layoutScene(scene, ctx);

  checkSlots(scene, errors);
  checkIds(scene, errors);
  checkGraphs(scene, errors);
  checkTiming(scene, ctx, errors);
  checkOverflow(placed.elements, errors);
  checkSafeZone(placed.elements, placed.safeRect, errors);
  checkOverlaps(scene, placed.elements, errors);

  return { ok: errors.length === 0, errors, placed };
}

/* The layout's own slot rule — see LAYOUT_SLOTS. */
function checkSlots(scene: Scene, errors: SceneError[]): void {
  const rule = LAYOUT_SLOTS[scene.layout];
  const count = scene.elements.length;

  if (count < rule.min || count > rule.max) {
    errors.push(
      sceneError(
        "elements",
        "SLOT_COUNT",
        `Layout "${scene.layout}" arranges ${rule.min === rule.max ? `exactly ${rule.min}` : `${rule.min} to ${rule.max}`} element${rule.max === 1 ? "" : "s"}; this scene has ${count}.`,
      ),
    );
  }

  if (
    rule.requires !== undefined &&
    !scene.elements.some((element) => element.kind === rule.requires)
  ) {
    errors.push(
      sceneError(
        "elements",
        "LAYOUT_REQUIRES_PRIMITIVE",
        `Layout "${scene.layout}" exists to arrange a "${rule.requires}" element and this scene has none.`,
      ),
    );
  }
}

/* Element ids have to be unique: the beat strip addresses an element by id to
 * redesign it, and two elements answering to one id makes that ambiguous. */
function checkIds(scene: Scene, errors: SceneError[]): void {
  const seen = new Set<string>();
  scene.elements.forEach((element, index) => {
    if (seen.has(element.id)) {
      errors.push(
        sceneError(
          `elements.${index}.id`,
          "DUPLICATE_ID",
          `Element id "${element.id}" is used more than once in this scene.`,
        ),
      );
    }
    seen.add(element.id);
  });
}

function checkGraphs(scene: Scene, errors: SceneError[]): void {
  scene.elements.forEach((element, index) => {
    if (element.kind !== "flowGraph") return;

    const ids = new Set<string>();
    element.nodes.forEach((node, nodeIndex) => {
      if (ids.has(node.id)) {
        errors.push(
          sceneError(
            `elements.${index}.nodes.${nodeIndex}.id`,
            "DUPLICATE_ID",
            `Graph node id "${node.id}" is used more than once.`,
          ),
        );
      }
      ids.add(node.id);
    });

    /* An edge naming a node that does not exist would otherwise have Dagre
     * invent a zero-sized node and lay the graph out around a point nobody can
     * see — a diagram that is wrong in a way no overflow check would notice. */
    element.edges.forEach((edge, edgeIndex) => {
      for (const [end, id] of [
        ["from", edge.from],
        ["to", edge.to],
      ] as const) {
        if (!ids.has(id)) {
          errors.push(
            sceneError(
              `elements.${index}.edges.${edgeIndex}.${end}`,
              "GRAPH_EDGE_UNKNOWN_NODE",
              `Edge ${end === "from" ? "starts at" : "ends at"} "${id}", which is not one of this graph's nodes.`,
            ),
          );
        }
      }
    });
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkTiming, ANCHORS_ARE_INDICES_HERE
 *
 * An anchor is checked for EXISTENCE against the document's word count, and
 * ordering is checked only between two values of the same kind — two seconds,
 * or two indices. A seconds-against-index comparison is not available here by
 * construction (this module holds no transcript), and guessing would be worse
 * than leaving it to `validate()`, which sees the resolved document.
 */
function checkTiming(
  scene: Scene,
  ctx: LayoutContext,
  errors: SceneError[],
): void {
  scene.elements.forEach((element, index) => {
    const path = `elements.${index}`;

    for (const [field, value] of [
      ["in", element.in],
      ["out", element.out],
    ] as const) {
      if (value === undefined) continue;

      if (typeof value === "object") {
        if (value.wordIndex >= ctx.wordCount) {
          errors.push(
            sceneError(
              `${path}.${field}`,
              "UNKNOWN_WORD_ANCHOR",
              `Anchored to word ${value.wordIndex}, but the document has ${ctx.wordCount} word${ctx.wordCount === 1 ? "" : "s"}.`,
            ),
          );
        }
        continue;
      }

      if (value > ctx.durationSeconds) {
        errors.push(
          sceneError(
            `${path}.${field}`,
            "TIMING_OUT_OF_BEAT",
            `${field === "in" ? "Enters" : "Leaves"} at ${value}s, after this ${ctx.durationSeconds}s beat has ended.`,
          ),
        );
      }
    }

    const ordering = compareTimes(element.in, element.out);
    if (ordering !== null && ordering >= 0) {
      errors.push(
        sceneError(
          `${path}.out`,
          "TIMING_INVERTED",
          `Leaves at or before it enters (${describeTime(element.in)} → ${describeTime(element.out)}).`,
        ),
      );
    }
  });
}

/* Negative when `a` is before `b`, null when the two are not comparable — see
 * checkTiming. */
function compareTimes(
  a: SceneTimeValue | undefined,
  b: SceneTimeValue | undefined,
): number | null {
  /* `undefined` means "the end of the beat" on `out` and is impossible on
   * `in`, which has a default. Either way there is no number to compare, so
   * the caller falls back to its conservative branch. */
  if (a === undefined || b === undefined) return null;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "object" && typeof b === "object") {
    return a.wordIndex - b.wordIndex;
  }
  return null;
}

function describeTime(value: SceneTimeValue | undefined): string {
  if (value === undefined) return "end of beat";
  return typeof value === "number" ? `${value}s` : `word ${value.wordIndex}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkOverflow, AUTO_FIT_HAS_A_FLOOR
 *
 * The phase's "deterministic checks catch an overflowing text element". The
 * measurement already happened in `fitTextRun`; this turns the flag into a
 * message that says by how much and at what size, because that is what the
 * repair loop needs to shorten the right string.
 */
function checkOverflow(
  elements: readonly PlacedElement[],
  errors: SceneError[],
): void {
  elements.forEach((element, index) => {
    for (const run of element.runs) {
      if (!run.overflow) continue;

      const spec = SCENE_TEXT_ROLE_SPECS[run.role];
      const overWidth = Math.round(run.widthPx - run.box.width);
      const overHeight = Math.round(run.heightPx - run.box.height);
      const reasons: string[] = [];
      if (overWidth > 0) reasons.push(`${overWidth}px too wide`);
      if (overHeight > 0) reasons.push(`${overHeight}px too tall`);
      if (run.lines.length > spec.maxLines) {
        reasons.push(
          `wraps to ${run.lines.length} lines where ${spec.maxLines} is the most this role allows`,
        );
      }

      errors.push(
        sceneError(
          `elements.${index}.${run.path}`,
          "TEXT_OVERFLOW",
          `"${truncate(run.text)}" does not fit its slot even at the ${spec.minSizeVh}vh floor: ${reasons.join(", ")}. Shorten it.`,
        ),
      );
    }
  });
}

function checkSafeZone(
  elements: readonly PlacedElement[],
  safeRect: PlacedRect,
  errors: SceneError[],
): void {
  elements.forEach((element, index) => {
    for (const run of element.runs) {
      const rect = run.drawnRect;
      const outside =
        rect.x < safeRect.x - TOLERANCE_PX ||
        rect.y < safeRect.y - TOLERANCE_PX ||
        rect.x + rect.width > safeRect.x + safeRect.width + TOLERANCE_PX ||
        rect.y + rect.height > safeRect.y + safeRect.height + TOLERANCE_PX;

      if (outside) {
        errors.push(
          sceneError(
            `elements.${index}.${run.path}`,
            "OUTSIDE_SAFE_ZONE",
            `"${truncate(run.text)}" is drawn outside the safe zone and would be cut off or sit under the platform's own controls.`,
          ),
        );
      }
    }
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkOverlaps, OVERLAP_IS_CHECKED_ON_INK,
 *   DISJOINT_IN_TIME_IS_NOT_AN_OVERLAP
 *
 * The phase's "deterministic checks catch an overlap". Runs WITHIN one element
 * are not compared: their boxes come from `runBoxes`, which is this engine's
 * own geometry, so an overlap there is a bug in the engine that its own tests
 * cover — and a counter's figure overhanging its label is already reported as
 * the overflow that caused it. Across elements is where a real scene goes
 * wrong.
 */
function checkOverlaps(
  scene: Scene,
  elements: readonly PlacedElement[],
  errors: SceneError[],
): void {
  for (let a = 0; a < elements.length; a += 1) {
    for (let b = a + 1; b < elements.length; b += 1) {
      const first = elements[a];
      const second = elements[b];
      const firstSpec = scene.elements[a];
      const secondSpec = scene.elements[b];
      if (
        first === undefined ||
        second === undefined ||
        firstSpec === undefined ||
        secondSpec === undefined
      ) {
        continue;
      }
      if (!sharesTheFrame(firstSpec, secondSpec)) continue;

      for (const runA of first.runs) {
        for (const runB of second.runs) {
          if (!intersects(runA.drawnRect, runB.drawnRect)) continue;
          errors.push(
            sceneError(
              `elements.${a}.${runA.path}`,
              "ELEMENT_OVERLAP",
              `"${truncate(runA.text)}" overlaps "${truncate(runB.text)}" in element "${secondSpec.id}" while both are on screen.`,
            ),
          );
        }
      }
    }
  }
}

/* True unless the two are provably never on screen together — see
 * UNRESOLVED_IS_TREATED_AS_OVERLAPPING. */
function sharesTheFrame(
  a: StrictSceneElement,
  b: StrictSceneElement,
): boolean {
  const aBeforeB = compareTimes(a.out, b.in);
  if (aBeforeB !== null && aBeforeB <= 0) return false;
  const bBeforeA = compareTimes(b.out, a.in);
  if (bBeforeA !== null && bBeforeA <= 0) return false;
  return true;
}

function intersects(a: PlacedRect, b: PlacedRect): boolean {
  return (
    a.x + a.width - TOLERANCE_PX > b.x &&
    b.x + b.width - TOLERANCE_PX > a.x &&
    a.y + a.height - TOLERANCE_PX > b.y &&
    b.y + b.height - TOLERANCE_PX > a.y
  );
}

/* Error messages go into a model prompt and onto a screen; a 200-character
 * list item quoted in full crowds out the part that says what is wrong. */
function truncate(text: string): string {
  return text.length <= 48 ? text : `${text.slice(0, 45)}…`;
}
