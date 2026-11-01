/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: Counter, Meter, BarChart, COUNT_IS_INTERPOLATED,
 *   MEASURED_WIDEST_DRAWN_CURRENT, TRACK_GEOMETRY_FROM_THE_RUNS,
 *   BARS_SHARE_ONE_SCALE
 *
 * WHAT:  The three primitives that draw quantities: a figure that counts up, a
 *        single proportion, and two to five compared values.
 *
 * WHY:   COUNT_IS_INTERPOLATED and MEASURED_WIDEST_DRAWN_CURRENT are one idea
 *        in two halves. A counter draws a different string on every frame, so
 *        the LAYOUT was measured against the widest of its two endpoints
 *        (WIDEST_FRAME_IS_THE_ONE_THAT_MUST_FIT in src/lib/scene/runs.ts) and
 *        each frame draws the current value INSIDE that already-fitted
 *        geometry. The font size and the box never change mid-count, which is
 *        what stops a figure jittering as it grows — and it is also why the
 *        overflow check on a counter is meaningful at all.
 *
 *        The formatting goes through `formatCounterValue`, the same function
 *        the measurement used. A second `toLocaleString` here would be how the
 *        measured string and the drawn string come apart, and it would be
 *        locale-dependent on top (GROUPING_IS_HAND_ROLLED).
 *
 *        TRACK_GEOMETRY_FROM_THE_RUNS. A meter's bar and a chart's bars are
 *        the one thing in this library with no text to measure, so their
 *        rectangles are derived from the boxes the layout engine gave the runs
 *        AROUND them rather than from fractions invented here. That keeps one
 *        source for the geometry: if `runBoxes` changes how much room a meter's
 *        label takes, the track follows without a second edit.
 *
 *        BARS_SHARE_ONE_SCALE — every bar is drawn against the largest value
 *        in the chart, not against its own row. Per-row scaling would draw
 *        five full-width bars and make a comparison that compares nothing,
 *        which is the most plausible way this primitive could be quietly
 *        wrong.
 * WHERE: Registered in MOTION_PRIMITIVES in ./index.tsx.
 */

import { formatCounterValue } from "@/lib/scene";
import type { MotionPrimitiveProps, PlacedRect } from "@/lib/types/scene";

import { TextBlock } from "./text-block";
import { localProgress, radiusPx, runByPath, strokePx } from "./util";

/* How long a count takes, and the share of a short window it may use. A count
 * that ran the whole beat would still be moving as the beat cut, which reads
 * as a number nobody got to see. */
const COUNT_SECONDS = 0.9;
const COUNT_WINDOW_SHARE = 0.6;

export function Counter({
  element,
  placed,
  palette,
  window: visible,
  seconds,
  style,
}: MotionPrimitiveProps) {
  if (element.kind !== "counter") return null;

  const figure = runByPath(placed, "to");
  const label = runByPath(placed, "label");
  if (figure === null) return null;

  const span = Math.max(visible.to - visible.from, 0.001);
  const duration = Math.min(COUNT_SECONDS, span * COUNT_WINDOW_SHARE);

  /* Linear, not eased. A count that decelerates reads as a number being
   * dragged into place; the ELEMENT's entrance carries the easing, and the
   * figure inside it should move at a steady rate so the digits are readable
   * the whole way up. */
  const travelled =
    duration <= 0
      ? 1
      : Math.min(Math.max((seconds - visible.from) / duration, 0), 1);
  const value = element.from + (element.to - element.from) * travelled;

  const text = formatCounterValue({
    value,
    decimals: element.decimals,
    grouped: element.grouped,
    prefix: element.prefix,
    suffix: element.suffix,
  });

  return (
    <>
      {/* The measured run with the current string swapped in — see
          MEASURED_WIDEST_DRAWN_CURRENT. Everything else about it, including
          the fitted size, is what the check was run against. */}
      <TextBlock run={{ ...figure, lines: [text] }} color={palette.accent} style={style} />
      {label === null ? null : <TextBlock run={label} color={palette.text} style={style} />}
    </>
  );
}

export function Meter({
  element,
  placed,
  palette,
  canvas,
  window: visible,
  seconds,
  style,
}: MotionPrimitiveProps) {
  if (element.kind !== "meter") return null;

  const label = runByPath(placed, "label");
  const value = runByPath(placed, "value");

  /* TRACK_GEOMETRY_FROM_THE_RUNS — the gap the layout engine left between the
   * label above and the figure below. */
  const top = label === null ? placed.rect.y : label.box.y + label.box.height;
  const bottom =
    value === null ? placed.rect.y + placed.rect.height : value.box.y;
  /* The track thickness IS a stroke, so the style sets it: a hairline meter
   * and a hairline graph edge should read as the same decision. */
  const height = strokePx(style, canvas.height * 0.008, 4);
  const width = placed.rect.width * 0.86;
  const track: PlacedRect = {
    x: placed.rect.x + (placed.rect.width - width) / 2,
    y: (top + bottom) / 2 - height / 2,
    width,
    height,
  };

  const filled =
    element.value *
    localProgress({ seconds, window: visible, index: 0, count: 1, spread: 0.6 });

  return (
    <>
      {label === null ? null : <TextBlock run={label} color={palette.text} style={style} />}
      <div
        style={{
          position: "absolute",
          left: track.x,
          top: track.y,
          width: track.width,
          height: track.height,
          borderRadius: radiusPx(style, track.height),
          /* The palette's own text colour at low opacity, so the empty part of
           * the track belongs to the palette without needing a sixth colour
           * that has to pass its own contrast check. */
          backgroundColor: palette.text,
          opacity: 0.18,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: track.x,
          top: track.y,
          width: track.width * filled,
          height: track.height,
          borderRadius: radiusPx(style, track.height),
          backgroundColor: palette.accent,
        }}
      />
      {value === null ? null : <TextBlock run={value} color={palette.accent} style={style} />}
    </>
  );
}

export function BarChart({
  element,
  placed,
  palette,
  window: visible,
  seconds,
  style,
}: MotionPrimitiveProps) {
  if (element.kind !== "barChart") return null;

  /* BARS_SHARE_ONE_SCALE. Guarded against an all-zero chart, which is valid
   * data and would otherwise divide by zero and draw nothing at all. */
  const largest = Math.max(...element.bars.map((bar) => bar.value), 0);

  return (
    <>
      {element.bars.map((bar, index) => {
        const label = runByPath(placed, `bars.${index}.label`);
        const figure = runByPath(placed, `bars.${index}.value`);
        if (label === null) return null;

        /* The band between the label's box and the figure's — the 20% of the
         * row runBoxes left for the track. */
        const trackLeft = label.box.x + label.box.width;
        const trackRight =
          figure === null ? placed.rect.x + placed.rect.width : figure.box.x;
        const height = strokePx(style, label.box.height * 0.34, 4);
        const grown =
          largest === 0
            ? 0
            : (bar.value / largest) *
              localProgress({
                seconds,
                window: visible,
                index,
                count: element.bars.length,
                spread: 0.4,
              });

        return (
          <div key={bar.label}>
            <TextBlock run={label} color={palette.text} align="left" justify="flex-start" style={style} />
            <div
              style={{
                position: "absolute",
                left: trackLeft,
                top: label.box.y + label.box.height / 2 - height / 2,
                width: Math.max(trackRight - trackLeft, 0) * grown,
                height,
                borderRadius: radiusPx(style, height),
                backgroundColor: palette.accent,
              }}
            />
            {figure === null ? null : (
              <TextBlock run={figure} color={palette.text} align="right" justify="flex-end" style={style} />
            )}
          </div>
        );
      })}
    </>
  );
}
