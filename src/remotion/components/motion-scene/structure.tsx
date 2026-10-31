/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: Compare, List, Icon, DIVIDER_FROM_THE_RUNS,
 *   SEQUENTIAL_IS_THE_DEFAULT, ICON_IS_SIZED_BY_ITS_BAND
 *
 * WHAT:  The three primitives that arrange things rather than quantify them:
 *        two values side by side, an enumerated list, and a single glyph.
 *
 * WHY:   DIVIDER_FROM_THE_RUNS. `Compare`'s rule sits in the gap the layout
 *        engine left between the two columns, derived from the placed boxes
 *        rather than from a fraction invented here — the same reason a meter's
 *        track is (TRACK_GEOMETRY_FROM_THE_RUNS). It means a change to
 *        `runBoxes` moves the rule with the columns instead of leaving it
 *        drawn through one of them.
 *
 *        SEQUENTIAL_IS_THE_DEFAULT for a list, because the narration walks
 *        through the items and a list that appeared whole would give away the
 *        third point while the voice is on the first. `together` exists for a
 *        list the voice does not walk through, and it is the element's choice
 *        rather than this component's guess.
 *
 *        ICON_IS_SIZED_BY_ITS_BAND — the glyph fills the band above its label,
 *        squared off so it cannot be stretched. An icon with a fixed vh size
 *        would overlap its own label in a short slot, and nothing would report
 *        it: a glyph has no text to measure, so the overflow check cannot see
 *        it. Deriving the size from the band is what makes the geometry safe
 *        without a check.
 * WHERE: Registered in MOTION_PRIMITIVES in ./index.tsx.
 */

import { toneColor } from "@/lib/palettes";
import type { MotionPrimitiveProps } from "@/lib/types/scene";

import { animationStyle } from "./animation";
import { SceneIconGlyph } from "./icons";
import { TextBlock } from "./text-block";
import { localProgress, runByPath } from "./util";

export function Compare({ element, placed, palette, style }: MotionPrimitiveProps) {
  if (element.kind !== "compare") return null;

  const leftLabel = runByPath(placed, "left.label");
  const rightLabel = runByPath(placed, "right.label");
  const leftValue = runByPath(placed, "left.value");
  const rightValue = runByPath(placed, "right.value");

  /* DIVIDER_FROM_THE_RUNS — the gutter between the two columns. */
  const gapStart =
    leftLabel === null ? placed.rect.x : leftLabel.box.x + leftLabel.box.width;
  const gapEnd = rightLabel === null ? gapStart : rightLabel.box.x;
  const width = Math.max(2, placed.rect.width * 0.004);

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: (gapStart + gapEnd) / 2 - width / 2,
          top: placed.rect.y + placed.rect.height * 0.1,
          width,
          height: placed.rect.height * 0.8,
          backgroundColor: palette.text,
          opacity: 0.2,
        }}
      />
      {leftLabel === null ? null : (
        <TextBlock run={leftLabel} color={palette.text} style={style} />
      )}
      {rightLabel === null ? null : (
        <TextBlock run={rightLabel} color={palette.text} style={style} />
      )}
      {leftValue === null ? null : (
        <TextBlock run={leftValue} color={palette.accent} style={style} />
      )}
      {rightValue === null ? null : (
        <TextBlock run={rightValue} color={palette.accent} style={style} />
      )}
    </>
  );
}

export function List({
  element,
  placed,
  palette,
  canvas,
  window: visible,
  seconds,
  style,
}: MotionPrimitiveProps) {
  if (element.kind !== "list") return null;

  return (
    <>
      {element.items.map((item, index) => {
        const run = runByPath(placed, `items.${index}`);
        if (run === null) return null;

        const progress =
          element.reveal === "together"
            ? 1
            : localProgress({
                seconds,
                window: visible,
                index,
                count: element.items.length,
                spread: 0.28,
              });

        /* STAGGER_REUSES_THE_MOVEMENT — the element's own entrance per row.
         * Named `rowEntrance` rather than `style`, which now means the MOTION
         * STYLE in this file: a CSS object and a style token set sharing one
         * name is how a row ends up with a `MotionStyle` in its `style`
         * attribute and no error anywhere. */
        const rowEntrance = animationStyle({
          animation: element.entrance === "none" ? "fade" : element.entrance,
          progress,
          canvas,
        });
        const markSize = Math.max(run.fontPx * 0.26, 4);

        return (
          <div key={item} style={rowEntrance}>
            <div
              style={{
                position: "absolute",
                left: run.box.x,
                top: run.box.y + run.box.height / 2 - markSize / 2,
                width: markSize,
                height: markSize,
                borderRadius: markSize / 2,
                backgroundColor: palette.accent,
              }}
            />
            {/* Indented past the mark, which is why the run is drawn
                left-aligned in a narrowed box rather than centred: a centred
                list with a bullet to one side reads as two columns. */}
            <TextBlock
              style={style}
              run={{
                ...run,
                box: {
                  ...run.box,
                  x: run.box.x + markSize * 2.2,
                  width: run.box.width - markSize * 2.2,
                },
              }}
              color={palette.text}
              align="left"
              justify="flex-start"
            />
          </div>
        );
      })}
    </>
  );
}

export function Icon({ element, placed, palette, style }: MotionPrimitiveProps) {
  if (element.kind !== "icon") return null;

  const label = runByPath(placed, "label");

  /* ICON_IS_SIZED_BY_ITS_BAND. */
  const bandBottom =
    label === null ? placed.rect.y + placed.rect.height : label.box.y;
  const bandHeight = Math.max(bandBottom - placed.rect.y, 1);
  const size = Math.min(bandHeight, placed.rect.width) * 0.78;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: placed.rect.x,
          top: placed.rect.y,
          width: placed.rect.width,
          height: bandHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          /* The glyph strokes `currentColor`, so the colour is set once here
           * and the label beside it cannot end up a different shade. */
          color: palette.accent,
        }}
      >
        <SceneIconGlyph icon={element.icon} size={size} />
      </div>
      {label === null ? null : (
        <TextBlock run={label} color={toneColor("neutral", palette)} style={style} />
      )}
    </>
  );
}
