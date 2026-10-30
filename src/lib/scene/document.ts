/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: parseScene, toSceneSpec, fromSceneSpec, ParsedScene,
 *   THE_DOCUMENT_IS_THE_LOOSE_FORM, PROPS_CARRY_THE_STRICT_ELEMENT,
 *   NO_COORDINATE_SURVIVES_THE_SEAM, ONE_SHAPE_TWO_INPUTS
 *
 * WHAT:  The seam between the strict scene language and the loose `SceneSpec`
 *        a timeline document stores — parse in, flatten out, and parse back.
 *
 * WHY:   THE_DOCUMENT_IS_THE_LOOSE_FORM. `sceneSpecSchema` in
 *        src/lib/timeline/schema.ts is deliberately open — `layout: string`,
 *        `kind: string`, `props` as free JSON — because one document schema
 *        carries quiz cards, Reddit cards and motion scenes, and freezing
 *        every family's knobs there would mean editing that file for every new
 *        animation. The cost of that openness is that a stored scene is not
 *        yet known to be a valid motion scene, and this module is where it
 *        becomes known. Exactly the relationship src/lib/quiz/import.ts has
 *        with a quiz card.
 *
 *        ONE_SHAPE_TWO_INPUTS, borrowed from the quiz phase because the
 *        argument is identical: a scene written by hand for the gallery and a
 *        scene returned by the designer in Phase 16d both arrive as JSON and
 *        both go through `parseScene`. From that line onward nothing can tell
 *        them apart, which is what makes "a hand-written three-scene document
 *        renders to MP4 with no model involved" structural rather than a thing
 *        somebody tested once.
 *
 *        PROPS_CARRY_THE_STRICT_ELEMENT. Everything but `id` and `kind` goes
 *        into `props`, and nothing is mirrored into the document's optional
 *        `text` field. Mirroring was tempting — the editor's track list shows
 *        `text` for other families — and it is how two copies of a headline
 *        drift apart, with the rendered one and the displayed one disagreeing
 *        after an edit. A scene item carries `label` for that job already.
 *
 *        NO_COORDINATE_SURVIVES_THE_SEAM. `SceneElement` in the document has
 *        an optional `box`, and a motion element may never have one: the
 *        layout engine owns all geometry (THE_MODEL_NEVER_EMITS_COORDINATES).
 *        `sceneElementStrictSchema` is `.strict()` and declares no `box`, so a
 *        stored element carrying one is REFUSED here rather than quietly
 *        honoured — which is the one thing that keeps the guarantee true for
 *        documents that have been edited by hand or written by an older
 *        release.
 *
 *        The conversion to JSON goes through `jsonObjectSchema.parse` rather
 *        than a cast. A cast would assert that a strict element is JSON; the
 *        parse PROVES it, and if a future primitive gains a field that is not
 *        serialisable the failure happens here with a path, instead of as a
 *        document that cannot be stored.
 *
 * WHERE: The gallery's hand-written scenes; Phase 16d's designer output and
 *        its repair loop; the MotionScene component, which reads a stored
 *        `SceneSpec` and must parse it before drawing.
 */

import type { SceneSpec } from "@/lib/timeline";
import { jsonObjectSchema, type JsonValue } from "@/lib/types";
import {
  sceneSchema,
  sceneError,
  type Scene,
  type SceneError,
} from "@/lib/types/scene";

/**
 * SOURCE OF TRUTH KEYWORDS: ParsedScene
 *
 * WHAT:  A scene, or the reasons it is not one.
 * WHY:   A result union rather than a throw, for the same reason
 *        `SceneCheckResult` is a list: the designer's repair loop needs the
 *        reasons as data to put in a prompt, and the component needs to draw
 *        nothing rather than crash a paid render. Mirrors
 *        `ValidationResult<T>` in src/lib/timeline/errors.ts.
 * WHERE: Returned by parseScene and fromSceneSpec.
 */
export type ParsedScene =
  | { ok: true; scene: Scene }
  | { ok: false; errors: SceneError[] };

/**
 * SOURCE OF TRUTH KEYWORDS: parseScene, ONE_SHAPE_TWO_INPUTS
 *
 * WHAT:  JSON — from a model, a fixture or a stored document — as a validated
 *        scene.
 * WHY:   Zod's issues are mapped onto `SceneError` with the SCHEMA code and
 *        the dotted path, so a caller branches on `code` rather than matching
 *        on message text, and so a schema failure reads the same way as a
 *        geometry failure in the beat strip. `JsonValue` rather than `unknown`
 *        — this codebase does not use the escape hatches, and every caller
 *        genuinely has JSON.
 * WHERE: Every entry point. `checkScene` takes what this returns.
 */
export function parseScene(value: JsonValue): ParsedScene {
  const result = sceneSchema.safeParse(value);
  if (result.success) return { ok: true, scene: result.data };

  return {
    ok: false,
    errors: result.error.issues.map((issue) =>
      sceneError(issue.path.join("."), "SCHEMA", issue.message),
    ),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: toSceneSpec, PROPS_CARRY_THE_STRICT_ELEMENT
 *
 * WHAT:  A scene in the form a timeline document stores.
 * WHY:   Lossless and reversible — `fromSceneSpec(toSceneSpec(s))` returns `s`
 *        — which is asserted by a test rather than assumed, because the whole
 *        of Phase 16d's "redesign one beat leaves the others byte-identical"
 *        depends on a round trip that changes nothing. A conversion that
 *        dropped a default would rewrite every untouched beat the first time
 *        one was saved.
 * WHERE: The generator that writes motion scenes into a document; the gallery
 *        when it builds a renderable document from its fixtures.
 */
export function toSceneSpec(scene: Scene): SceneSpec {
  return {
    layout: scene.layout,
    elements: scene.elements.map((element) => {
      const { id, kind, ...rest } = element;
      return { id, kind, props: jsonObjectSchema.parse(rest) };
    }),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: fromSceneSpec, NO_COORDINATE_SURVIVES_THE_SEAM
 *
 * WHAT:  A stored `SceneSpec` as a validated scene.
 * WHY:   Flattens `props` back up beside `id` and `kind` and then parses the
 *        result, so a stored element with a `box`, an unknown `kind`, or a
 *        prop no primitive declares fails HERE with a path — rather than
 *        reaching a component that would draw a frame nobody designed. An
 *        element whose `props` is absent still parses when the primitive needs
 *        no knobs, which is why the spread is on an empty object rather than
 *        guarded.
 * WHERE: The MotionScene component; the editor's inspector; the gallery.
 */
export function fromSceneSpec(spec: SceneSpec): ParsedScene {
  const elements: JsonValue[] = [];

  for (const [index, element] of spec.elements.entries()) {
    const { props, ...carried } = element;
    /* Proved rather than asserted — see the file header. The input came out of
     * a document `timelineDocSchema` had already parsed, so a failure here
     * means a `box` or some other non-JSON field reached a motion element, and
     * that has to be a reported error rather than a cast nobody can see. */
    const merged = jsonObjectSchema.safeParse({ ...carried, ...(props ?? {}) });
    if (!merged.success) {
      return {
        ok: false,
        errors: [
          sceneError(
            `elements.${index}`,
            "SCHEMA",
            `Stored element "${element.id}" is not representable as a motion scene element.`,
          ),
        ],
      };
    }
    elements.push(merged.data);
  }

  return parseScene({ layout: spec.layout, elements });
}
