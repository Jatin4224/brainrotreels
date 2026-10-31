/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: TextBlock, DRAWN_IS_MEASURED, EVERY_TEXT_GOES_THROUGH_HERE,
 *   NO_BROWSER_WRAPPING, BUNDLED_FONT_ONLY
 *
 * WHAT:  Draws one measured text run — its pre-wrapped lines, at the font size
 *        the layout engine fitted it to, inside the box it was measured
 *        against.
 *
 * WHY:   EVERY_TEXT_GOES_THROUGH_HERE, and it is the single most important
 *        component in the motion library. The whole value of Phase 16a's
 *        measurement is the claim that the overflow check describes the real
 *        picture, and that claim holds only if the picture is drawn from the
 *        measurement. One component owns that, so no primitive can quietly
 *        pick its own size or let the browser re-wrap.
 *
 *        NO_BROWSER_WRAPPING is how it is enforced. The lines come from
 *        `wrapText` and are emitted as SEPARATE elements with `whiteSpace:
 *        nowrap`, so the browser is never asked where to break. If the box
 *        were handed the whole string with `overflowWrap` on, Chrome would
 *        wrap it by its own rules — which agree with the measurement almost
 *        always, and "almost" is the failure: the beats where they disagree
 *        are exactly the long ones the check was built for.
 *
 *        Overflow is deliberately NOT hidden. A run that could not be shrunk
 *        to fit is reported as TEXT_OVERFLOW and, in the gallery, has to be
 *        VISIBLE as the defect it is — clipping it would hide the thing a
 *        human is reviewing for, and in a real render the pipeline should have
 *        repaired or replaced the beat long before it got here
 *        (THE_PIPELINE_ALWAYS_FINISHES).
 *
 *        BUNDLED_FONT_ONLY: the family is the one `src/remotion/fonts.ts`
 *        loads out of `public/fonts`, and the weight comes from the run's role
 *        — the same two weights the measurement table holds, so a drawn weight
 *        can never be one nothing measured.
 * WHERE: Every text-drawing primitive under motion-scene/.
 */

import { SCENE_TEXT_ROLE_SPECS, type PlacedTextRun } from "@/lib/types/scene";
import { RENDER_FONT_FAMILY } from "../../fonts";

/**
 * SOURCE OF TRUTH KEYWORDS: TextBlock, STAGGER_REUSES_THE_MOVEMENT
 *
 * `wordStyle` is what lets a primitive animate the words of a line
 * independently — KineticText's whole job — without a second copy of this
 * geometry. The index is global across the wrapped lines, so word 7 is the
 * seventh word of the run regardless of where it wrapped.
 */
export function TextBlock({
  run,
  color,
  align = "center",
  justify = "center",
  wordStyle,
}: {
  run: PlacedTextRun;
  color: string;
  align?: "left" | "center" | "right";
  justify?: "flex-start" | "center" | "flex-end";
  wordStyle?: (wordIndex: number) => React.CSSProperties;
}) {
  const spec = SCENE_TEXT_ROLE_SPECS[run.role];
  let wordIndex = 0;

  return (
    <div
      style={{
        position: "absolute",
        left: run.box.x,
        top: run.box.y,
        width: run.box.width,
        height: run.box.height,
        display: "flex",
        flexDirection: "column",
        /* Centred on both axes, because that is where `centreIn` in
         * measure.ts said the ink would land. Changing this without changing
         * that function would make the overlap check measure a rectangle that
         * is no longer where the text is. */
        justifyContent: "center",
        alignItems: justify,
        fontFamily: RENDER_FONT_FAMILY,
        fontWeight: spec.weight,
        fontSize: run.fontPx,
        lineHeight: spec.lineHeight,
        color,
        textAlign: align,
      }}
    >
      {run.lines.map((line, lineIndex) => (
        <div
          key={`${lineIndex}-${line}`}
          /* nowrap, so the browser cannot second-guess the measured break. */
          style={{ whiteSpace: "nowrap" }}
        >
          {wordStyle === undefined
            ? line
            : line.split(" ").map((word, inLine) => {
                const style = wordStyle(wordIndex);
                wordIndex += 1;
                return (
                  <span
                    key={`${inLine}-${word}`}
                    style={{ display: "inline-block", ...style }}
                  >
                    {word}
                    {inLine < line.split(" ").length - 1 ? " " : null}
                  </span>
                );
              })}
        </div>
      ))}
    </div>
  );
}
