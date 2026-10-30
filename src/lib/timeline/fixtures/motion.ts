/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: motionFixture, NO_SPINE_DOCUMENT, VIDEO_LENGTH_RULE,
 *   silent document, FIXTURE_SPEAKS_THE_SCENE_LANGUAGE, PROPS_CARRY_THE_STRICT_ELEMENT
 *
 * WHAT:  A silent motion-graphics piece: three scene beats, no audio, no video,
 *        no words.
 * WHY:   NO_SPINE_DOCUMENT. This is the fixture that exercises
 *        VIDEO_LENGTH_RULE's fallback — with no video or audio lane there is
 *        nothing with an intrinsic duration, so the length comes from the
 *        scenes themselves and the out-of-range check is vacuous. Every other
 *        fixture has a spine, so without this one that branch would never run.
 *        It also proves the document survives an EMPTY word list: a motion
 *        piece has no script, and a caption rule that assumed words exist would
 *        fail here rather than in production.
 *
 *        FIXTURE_SPEAKS_THE_SCENE_LANGUAGE — Phase 16a. The layouts and kinds
 *        here were invented in Phase 01, before the scene language existed,
 *        and three of them (`figure-left`, `bigStat`, `headline`) were names
 *        nothing ever implemented. They are now the real vocabulary from
 *        src/lib/types/scene.ts, so this fixture is a document the motion
 *        engine can actually lay out, check and render rather than a
 *        plausible-looking shape. `scene.test.ts` asserts exactly that, which
 *        is what stops the two drifting again.
 *
 *        PROPS_CARRY_THE_STRICT_ELEMENT: an element's knobs live in `props`,
 *        not in the document's own optional `text` field — see
 *        src/lib/scene/document.ts for why nothing is mirrored. Timing and
 *        animation defaults are omitted here and filled in by the schema, so
 *        the fixture reads as the design rather than as the serialisation.
 * WHERE: validate.test.ts, ops.test.ts, scene.test.ts; the Phase 16 motion
 *        studio and its gallery.
 */

import type { TimelineDoc } from "../schema";

export function motionFixture(): TimelineDoc {
  return {
    version: 4,
    kind: "motion",
    timing: "resolved",
    canvas: { width: 1080, height: 1920, fps: 30 },
    style: { paletteId: "mono", captionStyleId: "none", safeZone: "none" },
    words: [],
    tracks: [
      {
        id: "scenes",
        type: "scene",
        label: "Scenes",
        items: [
          {
            id: "s1",
            start: 0,
            duration: 2.5,
            render: "motion",
            scene: {
              layout: "stack-center",
              elements: [
                {
                  id: "s1-head",
                  kind: "title",
                  props: {
                    text: "Three numbers",
                    subhead: "that explain the quarter",
                    entrance: "rise",
                  },
                },
              ],
            },
          },
          {
            id: "s2",
            start: 2.5,
            duration: 3,
            render: "motion",
            scene: {
              layout: "hero-plus-caption",
              elements: [
                {
                  id: "s2-stat",
                  kind: "counter",
                  props: {
                    from: 0,
                    to: 41,
                    suffix: "%",
                    entrance: "pop",
                  },
                },
                {
                  id: "s2-caption",
                  kind: "callout",
                  props: {
                    text: "of signups never finish setup",
                    tone: "warning",
                  },
                },
              ],
            },
          },
          {
            id: "s3",
            start: 5.5,
            duration: 2.5,
            render: "motion",
            scene: {
              layout: "stack-center",
              elements: [
                {
                  id: "s3-cta",
                  kind: "title",
                  props: { text: "Fix the first five minutes" },
                },
              ],
            },
          },
        ],
      },
      {
        id: "overlays",
        type: "overlay",
        label: "Overlays",
        items: [
          {
            id: "o1",
            start: 0,
            duration: 8,
            render: "media",
            z: 1,
            box: { x: 0.82, y: 0.04, w: 0.14, h: 0.06 },
            assetId: "logo_badge",
          },
        ],
      },
    ],
    speakers: {},
    assets: {
      logo_badge: {
        assetId: "ast_logo_badge",
        kind: "image",
        license: "owned",
      },
    },
  };
}
