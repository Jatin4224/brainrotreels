/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: Title, KineticText, Callout, MOTION_PRIMITIVE_CONTRACT,
 *   DRAWN_IS_MEASURED, KINETIC_IS_PER_WORD, CALLOUT_CARRIES_ITS_TONE
 *
 * WHAT:  The three primitives that are mostly words: a headline with an
 *        optional subhead, a line that arrives word by word, and a short
 *        statement that carries a judgement.
 *
 * WHY:   All three draw through `TextBlock` and nothing else, so the glyphs
 *        land where the measurement said they would (DRAWN_IS_MEASURED). None
 *        of them computes a size, a wrap or a position.
 *
 *        KINETIC_IS_PER_WORD. `KineticText` differs from `Title` only in
 *        animating its words independently — same geometry, same font, same
 *        box. That is why it is a `wordStyle` callback into the shared
 *        TextBlock rather than its own layout: a second implementation would
 *        be a second place for the measurement to come apart, for a visual
 *        difference that is purely about timing.
 *
 *        CALLOUT_CARRIES_ITS_TONE, and the colour comes from `toneColor` in
 *        src/lib/palettes — meaning crosses the seam and the palette decides
 *        the pixels, because a model may not pick a colour that has to pass a
 *        contrast test (TONE_IS_MEANING_NOT_COLOUR).
 * WHERE: Registered in MOTION_PRIMITIVES in ./index.tsx.
 */

import { toneColor } from "@/lib/palettes";
import type { MotionPrimitiveProps } from "@/lib/types/scene";

import { animationStyle } from "./animation";
import { TextBlock } from "./text-block";
import { localProgress, runByPath, strokePx } from "./util";

export function Title({ element, placed, palette, style }: MotionPrimitiveProps) {
  if (element.kind !== "title") return null;

  const head = runByPath(placed, "text");
  const sub = runByPath(placed, "subhead");

  return (
    <>
      {head === null ? null : <TextBlock run={head} color={palette.text} style={style} />}
      {sub === null ? null : (
        /* The accent, not the text colour: a subhead set in the same colour at
         * half the size reads as a headline that got cut off. */
        <TextBlock run={sub} color={palette.accent} style={style} />
      )}
    </>
  );
}

export function KineticText({
  element,
  placed,
  palette,
  canvas,
  window: visible,
  seconds,
  style,
}: MotionPrimitiveProps) {
  if (element.kind !== "kineticText") return null;

  const run = runByPath(placed, "text");
  if (run === null) return null;

  if (element.unit === "line") {
    return <TextBlock run={run} color={palette.text} style={style} />;
  }

  const words = run.lines.join(" ").split(" ").length;

  return (
    <TextBlock
      style={style}
      run={run}
      color={palette.text}
      /* STAGGER_REUSES_THE_MOVEMENT — the element's own entrance, applied per
       * word, so a kinetic line and a plain title arrive by the same gesture. */
      wordStyle={(index) =>
        animationStyle({
          animation: element.entrance === "none" ? "fade" : element.entrance,
          progress: localProgress({
            seconds,
            window: visible,
            index,
            count: words,
            /* Quicker than the default: a word that takes a third of a second
             * to appear makes a seven-word line feel like it is buffering. */
            spread: 0.18,
          }),
          canvas,
        })
      }
    />
  );
}

export function Callout({ element, placed, palette, style }: MotionPrimitiveProps) {
  if (element.kind !== "callout") return null;

  const run = runByPath(placed, "text");
  if (run === null) return null;

  const colour = toneColor(element.tone, palette);

  return (
    <>
      {/* A rule rather than a filled card. A card needs a background that is
          legible over whatever the backdrop is, which is a second contrast
          problem; a rule in the tone colour reads as emphasis and has none. */}
      <div
        style={{
          position: "absolute",
          left: run.box.x,
          top: run.box.y + run.box.height / 2 - run.heightPx / 2 - run.fontPx * 0.45,
          width: run.box.width,
          height: strokePx(style, run.fontPx * 0.06, 2),
          backgroundColor: colour,
          opacity: 0.9,
        }}
      />
      <TextBlock run={run} color={colour} style={style} />
    </>
  );
}
