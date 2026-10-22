/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: Backdrop, backdropPropsSchema, STYLED_BACKGROUND,
 *   BACKDROP_IS_NOT_MEDIA, PALETTE_IS_BAKED_ONTO_THE_ITEM,
 *   RENDER_COLOURS_ARE_LITERAL, DETERMINISM, PARSE_AT_THE_COMPONENT
 *
 * WHAT:  A full-frame gradient fill in one of the document's palettes — the
 *        styled background a `voiceover` project sits on.
 *
 * WHY:   BACKDROP_IS_NOT_MEDIA, and that distinction is the reason this is its
 *        own render kind rather than a `media` item. A MediaClip draws an
 *        ASSET: it needs a handle in `doc.assets`, a signed URL and an ingest
 *        behind it, and it draws nothing when any of those is missing
 *        (MISSING_ASSET_DRAWS_NOTHING). A styled background has no bytes
 *        anywhere — it is two colours and an angle — so expressing it as media
 *        would mean minting an Asset row for a gradient, signing a URL for a
 *        file that does not exist, and metering it against the workspace's
 *        storage quota.
 *
 *        STYLED_BACKGROUND is all this phase owes. Phase 11 brings the footage
 *        library and a `voiceover` document will then carry a video item over
 *        this one; the backdrop stays, because it is also what shows while that
 *        footage is still ingesting.
 *
 *        PALETTE_IS_BAKED_ONTO_THE_ITEM. A component receives `item`, `assets`,
 *        `frames` and `canvas` and NOT the document (RENDER_COMPONENT_CONTRACT
 *        in src/lib/types/render.ts), so it cannot read `doc.style.paletteId` —
 *        and that is the right constraint rather than one to work around. The
 *        generator resolves the document's palette once and writes the id into
 *        every backdrop item it emits, which also means Phase 15's editor can
 *        repalette ONE background without touching the document's global style.
 *
 *        BACKDROP_IS_A_SCENE_ITEM, so the palette arrives in `scene.elements`
 *        rather than in a `props` bag of its own. That is the schema working as
 *        designed — `render` picks the component family and `scene` IS that
 *        family's input (sceneItemSchema in src/lib/timeline/schema.ts) — and
 *        it is also the only lane that fits: a video item is required to carry
 *        an `assetId`, which a gradient does not have, and an overlay would
 *        composite ABOVE the captions (LAYER_ORDER in src/lib/render).
 *
 *        PARSE_AT_THE_COMPONENT, like every other component here: the walker
 *        hands over a loose `item` that crossed a JSON serialisation (Remotion
 *        ships props to each worker, and Phase 04 ships them to Lambda), so
 *        this narrows what it needs with a real schema.
 *
 *        DETERMINISM: no clock, no randomness, nothing read from outside the
 *        props. A frame here is a pure function of its number, which is what
 *        Phase 04's render reuse rests on.
 * WHERE: Registered as `backdrop` in src/remotion/registry.ts. Written by
 *        src/lib/generators/voiceover.ts.
 */

import { AbsoluteFill } from "remotion";
import { z } from "zod";

import {
  BACKDROP_ELEMENT_KIND,
  backdropGradient,
  getPalette,
} from "@/lib/palettes";
import type { RenderItemProps } from "@/lib/types";

/**
 * SOURCE OF TRUTH KEYWORDS: backdropPropsSchema, BACKDROP_ELEMENT_KIND
 *
 * WHAT:  The one value a backdrop reads out of its scene spec.
 * WHY:   Matched on the element's `kind` — which is `BACKDROP_ELEMENT_KIND`,
 *        imported from src/lib/palettes so the generator that writes it and
 *        this component that reads it cannot drift — rather than on its
 *        position, so an editor that prepends an element to the scene cannot
 *        silently change which one supplies the colours. Everything else in
 *        the spec is ignored: a backdrop is a fill, and anything drawn over it
 *        is its own item on a higher track.
 */
const backdropPropsSchema = z.object({
  scene: z
    .object({
      elements: z
        .array(
          z
            .object({
              kind: z.string().optional(),
              props: z
                .object({ paletteId: z.string().min(1).max(60).optional() })
                .partial()
                .passthrough()
                .optional(),
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough()
    .optional(),
});

export function Backdrop({ item }: RenderItemProps) {
  const parsed = backdropPropsSchema.safeParse(item);
  const fill = parsed.success
    ? parsed.data.scene?.elements?.find(
        (element) => element.kind === BACKDROP_ELEMENT_KIND,
      )
    : undefined;
  /* An unparseable item still draws the DEFAULT background rather than
   * nothing: a gradient has an obvious safe answer, and a transparent frame
   * under a narration is a black video nobody can explain. */
  const palette = getPalette(fill?.props?.paletteId);

  return (
    <AbsoluteFill
      style={{ backgroundImage: backdropGradient(palette) }}
      /* Decoration. It carries nothing a screen reader could use, and the
       * studio's element tree reads better without it. */
      aria-hidden
    />
  );
}
