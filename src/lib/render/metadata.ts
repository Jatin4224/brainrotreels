/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: compositionMetadataFor, CompositionMetadata,
 *   SANITISE_BEFORE_BOTH_PARSES, METADATA_FROM_THE_PROPS, FALLBACK_IS_ONE_FRAME,
 *   dropUnknownRenderKinds, planComposition, BAD_DOCUMENT_DRAWS_BLACK
 *
 * WHAT:  The canvas and frame count a composition should use for one document,
 *        derived from the document itself rather than from registration-time
 *        constants.
 *
 * WHY:   SANITISE_BEFORE_BOTH_PARSES is the whole reason this is a module of
 *        its own rather than a closure in src/remotion/root.tsx. TWO places
 *        parse the incoming document — this one, to size the composition, and
 *        TimelineRenderer, to draw it — and they must agree about what the
 *        document contains. They did not: the component sanitised first
 *        (FORWARD_COMPATIBLE_DOCUMENT) while the metadata hook parsed the raw
 *        JSON, so one item carrying a render kind from a newer release — the
 *        exact case the sanitiser exists to survive — failed the strict parse
 *        on the metadata side only. The hook fell back to a single second
 *        while the component drew the full document, and the result was a
 *        render that SUCCEEDED, was billed, and was one second long. Nothing
 *        surfaced it; the only symptom was the file.
 *
 *        Keeping the derivation here, next to `planComposition` and
 *        `dropUnknownRenderKinds`, is what stops the two sides drifting again:
 *        there is one ordering of sanitise-then-parse-then-plan, it is pure,
 *        and it is unit-tested. root.tsx keeps only the adapter that hands
 *        Remotion the shape its `calculateMetadata` prop expects.
 *
 *        FALLBACK_IS_ONE_FRAME: a document that will not parse returns one
 *        second on the 9:16 canvas instead of throwing. On Lambda a throw here
 *        is a render that consumed its budget and produced nothing to look at,
 *        whereas one black second is a result the customer and the logs can
 *        both explain (BAD_DOCUMENT_DRAWS_BLACK — the component reaches the
 *        same verdict independently and draws the black frame).
 *
 *        The fallback canvas is read from CANVAS_BY_ASPECT rather than written
 *        out, because 1080x1920 already has a source of truth and a second
 *        copy of it here would be the thing that disagrees after a change.
 * WHERE: `metadataFromProps` in src/remotion/root.tsx, which every composition
 *        — production and fixture — passes as `calculateMetadata`. Unit-tested
 *        in ./metadata.test.ts.
 */

import { timelineDocSchema } from "@/lib/timeline";
import { CANVAS_BY_ASPECT } from "@/lib/types/project";
import type { CompositionPlan } from "./frame-plan";
import { planComposition } from "./frame-plan";
import { dropUnknownRenderKinds } from "./sanitise";

/**
 * SOURCE OF TRUTH KEYWORDS: CompositionMetadata
 *
 * WHAT:  The four fields Remotion's `calculateMetadata` resolves.
 * WHY:   Picked from CompositionPlan rather than declared, so the plan stays
 *        the one definition of what a sized composition is. `durationInSeconds`
 *        is deliberately not part of it — Remotion wants frames, and offering
 *        both invites a caller to use the one Remotion ignores.
 * WHERE: The return type of compositionMetadataFor.
 */
export type CompositionMetadata = Pick<
  CompositionPlan,
  "durationInFrames" | "fps" | "width" | "height"
>;

/* One second on the short-form canvas. Not exported: callers want the
 * resolved answer, and a fallback that can be read on its own is a fallback
 * somebody will render on purpose. */
const UNPARSEABLE_DOCUMENT_METADATA: CompositionMetadata = {
  durationInFrames: CANVAS_BY_ASPECT["9:16"].fps,
  fps: CANVAS_BY_ASPECT["9:16"].fps,
  width: CANVAS_BY_ASPECT["9:16"].width,
  height: CANVAS_BY_ASPECT["9:16"].height,
};

/**
 * SOURCE OF TRUTH KEYWORDS: compositionMetadataFor, SANITISE_BEFORE_BOTH_PARSES
 *
 * WHAT:  Sizes a composition from the document it is actually handed.
 * WHY:   Takes `unknown` because that is the honest type: on the Lambda path
 *        the document arrives as JSON over a network and this runs before any
 *        component has had a chance to validate it.
 *
 *        The sanitise step is FIRST and is not optional — it is the half of
 *        SANITISE_BEFORE_BOTH_PARSES that was missing. Dropped items are not
 *        logged here: the component logs them with a count and the kinds
 *        involved, and two warnings per render for one cause reads like two
 *        problems.
 * WHERE: src/remotion/root.tsx.
 */
export function compositionMetadataFor(doc: unknown): CompositionMetadata {
  const parsed = timelineDocSchema.safeParse(dropUnknownRenderKinds(doc).doc);
  if (!parsed.success) {
    console.error(
      "[lib/render/metadata] The document did not parse; sizing one black second.",
      parsed.error.issues.slice(0, 5),
    );
    return UNPARSEABLE_DOCUMENT_METADATA;
  }

  const plan = planComposition(parsed.data);
  return {
    durationInFrames: plan.durationInFrames,
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
  };
}
