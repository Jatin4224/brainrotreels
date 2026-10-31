/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: runByPath, localProgress, RUNS_ARE_FOUND_BY_PATH,
 *   STAGGER_REUSES_THE_MOVEMENT
 *
 * WHAT:  The two small things every motion primitive needs: finding its own
 *        measured text run, and working out how far through its window a
 *        staggered part is.
 *
 * WHY:   RUNS_ARE_FOUND_BY_PATH. A primitive asks for `bars.2.label` rather
 *        than for `runs[5]`, because the run order is produced by
 *        `elementTextRuns` and an index would silently re-point the moment a
 *        primitive gained an optional field — a counter without a label and a
 *        counter with one have different run arrays, and the same index means
 *        a different string in each. The path is the element's own field name,
 *        which cannot drift without the schema changing.
 *
 *        A missing run returns `null` and the primitive draws nothing for it,
 *        rather than throwing. The runs come from the same engine that placed
 *        the element, so a miss is an engine bug — and an engine bug should
 *        cost one missing label in a frame, not a failed render
 *        (UNKNOWN_DRAWS_NOTHING, applied one level down).
 * WHERE: Every primitive under motion-scene/.
 */

import type { PlacedElement, PlacedTextRun } from "@/lib/types/scene";

export function runByPath(
  placed: PlacedElement,
  path: string,
): PlacedTextRun | null {
  return placed.runs.find((run) => run.path === path) ?? null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: localProgress, STAGGER_REUSES_THE_MOVEMENT
 *
 * WHAT:  How far through its own slice of the window a staggered part is, 0 to
 *        1.
 *
 * WHY:   A list revealing five items, a chart growing five bars and a line
 *        arriving word by word are the same problem: divide the usable part of
 *        the window into `count` starts and ask how far past its own start
 *        each part is. Stating it once means the five primitives that stagger
 *        cannot drift into five different rhythms, which is the kind of
 *        inconsistency a viewer notices without being able to name.
 *
 *        The parts start within the FIRST HALF of the window and each takes
 *        `spread` to arrive, so the last one is settled well before the beat
 *        ends. Spacing them across the whole window instead would have the
 *        fifth item appear as the beat cuts.
 * WHERE: List, KineticText, BarChart, FlowGraph.
 */
export function localProgress(args: {
  /** Seconds since the start of the beat. */
  seconds: number;
  window: { from: number; to: number };
  index: number;
  count: number;
  /** How long one part takes to arrive, in seconds. */
  spread?: number;
}): number {
  const { seconds, window: visible, index, count, spread = 0.3 } = args;
  const span = Math.max(visible.to - visible.from, 0.001);
  const usable = span / 2;
  const step = count > 1 ? usable / count : 0;

  const start = visible.from + index * step;
  const elapsed = seconds - start;
  if (elapsed <= 0) return 0;
  if (elapsed >= spread) return 1;
  return elapsed / spread;
}
