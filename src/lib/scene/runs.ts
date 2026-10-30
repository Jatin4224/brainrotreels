/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: elementTextRuns, formatCounterValue, formatMeterPercent,
 *   MEASURE_WHAT_IS_DRAWN, WIDEST_FRAME_IS_THE_ONE_THAT_MUST_FIT,
 *   GROUPING_IS_HAND_ROLLED
 *
 * WHAT:  Every string a primitive will actually draw, paired with the role
 *        that sizes it — and the two formatters that turn a number into one of
 *        those strings.
 *
 * WHY:   MEASURE_WHAT_IS_DRAWN. The overflow check is only true if it measures
 *        the FINAL string, including the prefix, the suffix, the thousands
 *        separators and the percent sign. Measuring `counter.to` as the number
 *        `1250000` instead of the string `$1,250,000/mo` is seven glyphs short
 *        of the truth, and seven glyphs at 14vh is most of a phone's width.
 *        So the formatters live HERE, beside the measurement, and the
 *        components in src/remotion/ call the same two functions rather than
 *        formatting again — a second `toLocaleString` in a component is how
 *        the measured string and the drawn string come apart.
 *
 *        WIDEST_FRAME_IS_THE_ONE_THAT_MUST_FIT. A counter is animated, so it
 *        draws a different string on every frame, and the one that has to fit
 *        is the widest of them. Both ENDPOINTS are measured and the wider
 *        wins, because the count is monotonic between them: counting up to
 *        1,250,000 is widest at the end, counting down from 5,000 to 10 is
 *        widest at the start. Measuring only `to` passes a beat whose first
 *        second is off the frame.
 *
 *        GROUPING_IS_HAND_ROLLED, deliberately, and it is a real trade.
 *        `Intl.NumberFormat` would give locale-correct separators; it would
 *        also give an answer that depends on the ICU data in whichever Node
 *        build or browser is running, which means the measurement in the
 *        editor, the check on the Inngest worker and the pixels from the
 *        Lambda could differ in a thousands separator — and a width that
 *        differs by a glyph is a reused render that is wrong. Determinism wins
 *        and the cost is stated plainly: separators are `,` and the decimal
 *        point is `.`, for every customer, until the app has a locale
 *        story. Grep NO_LOCALE_STORY_YET.
 *
 * WHERE: src/lib/scene/layouts.ts measures these runs; the MotionScene
 *        components draw the fitted result and call the formatters for the
 *        in-between frames.
 */

import type { SceneTextRun, StrictSceneElement } from "@/lib/types/scene";

/**
 * SOURCE OF TRUTH KEYWORDS: formatCounterValue, GROUPING_IS_HAND_ROLLED,
 *   NO_LOCALE_STORY_YET
 *
 * WHAT:  A counter's value as it appears on screen, prefix and suffix
 *        included.
 * WHY:   See GROUPING_IS_HAND_ROLLED above. `toFixed` is safe to use here —
 *        it is not locale-dependent — and it is what rounds to the element's
 *        `decimals` before grouping, so `1999.96` at one decimal groups as
 *        `2,000.0` rather than `1,999.96` with a comma inserted at the wrong
 *        place.
 * WHERE: elementTextRuns; the Counter component, per frame.
 */
export function formatCounterValue(args: {
  value: number;
  decimals: number;
  grouped: boolean;
  /* `| undefined` spelled out because this project runs
   * `exactOptionalPropertyTypes` — an absent prefix and a prefix explicitly
   * set to undefined are different types there, and the callers below pass the
   * second. */
  prefix?: string | undefined;
  suffix?: string | undefined;
}): string {
  const { value, decimals, grouped, prefix, suffix } = args;

  const fixed = value.toFixed(decimals);
  const negative = fixed.startsWith("-");
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [whole = "", fraction] = unsigned.split(".");

  const body = grouped ? whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",") : whole;
  const number = fraction === undefined ? body : `${body}.${fraction}`;

  return `${prefix ?? ""}${negative ? "-" : ""}${number}${suffix ?? ""}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: formatMeterPercent
 *
 * A meter's 0..1 value as a whole percentage. Rounded, not truncated: a meter
 * at 0.999 reads `100%`, which is what the viewer sees in the bar — truncating
 * would draw a full bar labelled `99%`.
 */
export function formatMeterPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: elementTextRuns, MEASURE_WHAT_IS_DRAWN
 *
 * WHAT:  Every text run one element draws.
 *
 * WHY:   One switch over the closed primitive union, so a new primitive is a
 *        compile error here until its text is declared measurable. That is the
 *        whole defence against the phase's worst failure mode: a primitive
 *        whose label nothing measures is a primitive that can draw off the
 *        frame and pass every check. The `never` arm at the end is what makes
 *        it a compile error rather than a missing case.
 *
 *        An element with no text at all — a bare `icon` — correctly returns an
 *        empty array. Its slot is still placed and still checked for overlap
 *        and safe zone; there is simply nothing to wrap.
 * WHERE: layouts.ts.
 */
export function elementTextRuns(element: StrictSceneElement): SceneTextRun[] {
  switch (element.kind) {
    case "title": {
      const runs: SceneTextRun[] = [
        { path: "text", text: element.text, role: "display" },
      ];
      if (element.subhead !== undefined) {
        runs.push({ path: "subhead", text: element.subhead, role: "body" });
      }
      return runs;
    }

    case "kineticText":
      return [{ path: "text", text: element.text, role: "kinetic" }];

    case "counter": {
      /* Both endpoints — see WIDEST_FRAME_IS_THE_ONE_THAT_MUST_FIT. */
      const shared = {
        decimals: element.decimals,
        grouped: element.grouped,
        prefix: element.prefix,
        suffix: element.suffix,
      };
      const atFrom = formatCounterValue({ ...shared, value: element.from });
      const atTo = formatCounterValue({ ...shared, value: element.to });
      const widest = atFrom.length >= atTo.length ? atFrom : atTo;

      const runs: SceneTextRun[] = [
        { path: "to", text: widest, role: "numeral" },
      ];
      if (element.label !== undefined) {
        runs.push({ path: "label", text: element.label, role: "label" });
      }
      return runs;
    }

    case "meter": {
      const runs: SceneTextRun[] = [];
      if (element.label !== undefined) {
        runs.push({ path: "label", text: element.label, role: "body" });
      }
      if (element.showPercent) {
        runs.push({
          path: "value",
          text: formatMeterPercent(element.value),
          role: "numeral",
        });
      }
      return runs;
    }

    case "barChart":
      /* The bar VALUES are drawn too, as the unit-suffixed figure beside each
       * label, and both are measured — a chart whose numbers overlap its
       * labels is the clutter the phase's vision pass exists to catch, and
       * this catches the measurable half of it for free. */
      return element.bars.flatMap((bar, index) => [
        {
          path: `bars.${index}.label`,
          text: bar.label,
          role: "label" as const,
        },
        {
          path: `bars.${index}.value`,
          text: `${formatCounterValue({
            value: bar.value,
            decimals: 0,
            grouped: true,
          })}${element.unit ?? ""}`,
          role: "label" as const,
        },
      ]);

    case "compare": {
      const runs: SceneTextRun[] = [
        { path: "left.label", text: element.left.label, role: "body" },
        { path: "right.label", text: element.right.label, role: "body" },
      ];
      if (element.left.value !== undefined) {
        runs.push({
          path: "left.value",
          text: element.left.value,
          role: "numeral",
        });
      }
      if (element.right.value !== undefined) {
        runs.push({
          path: "right.value",
          text: element.right.value,
          role: "numeral",
        });
      }
      return runs;
    }

    case "list":
      return element.items.map((item, index) => ({
        path: `items.${index}`,
        text: item,
        role: "body" as const,
      }));

    case "flowGraph":
      /* Node labels only. Edge labels are measured by the graph layout itself,
       * which is the only code that knows how much room a route leaves for
       * one — see src/lib/scene/flow.ts. */
      return element.nodes.map((node, index) => ({
        path: `nodes.${index}.label`,
        text: node.label,
        role: "label" as const,
      }));

    case "icon":
      return element.label === undefined
        ? []
        : [{ path: "label", text: element.label, role: "label" }];

    case "callout":
      return [{ path: "text", text: element.text, role: "callout" }];

    default: {
      const exhaustive: never = element;
      throw new Error(
        `[scene/runs] Unknown primitive ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}
