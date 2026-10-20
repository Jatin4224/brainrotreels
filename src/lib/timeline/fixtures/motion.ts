/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: motionFixture, NO_SPINE_DOCUMENT, VIDEO_LENGTH_RULE,
 *   silent document
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
 * WHERE: validate.test.ts, ops.test.ts; the Phase 16 motion studio.
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
                { id: "s1-head", kind: "headline", text: "Three numbers" },
                {
                  id: "s1-sub",
                  kind: "subhead",
                  text: "that explain the quarter",
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
              layout: "figure-left",
              elements: [
                {
                  id: "s2-stat",
                  kind: "bigStat",
                  text: "41%",
                  props: { countFrom: 0 },
                },
                {
                  id: "s2-caption",
                  kind: "caption",
                  text: "of signups never finish setup",
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
                  kind: "headline",
                  text: "Fix the first five minutes",
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
