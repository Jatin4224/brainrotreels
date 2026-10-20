/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: legacyV1Fixture, V1_DOCUMENT_SHAPE,
 *   MIGRATION_PROOF, flat canvas, text start end
 *
 * WHAT:  A v1 document, exactly as the first release stored one.
 * WHY:   MIGRATION_PROOF. The migration chain's only real test is a document
 *        nobody can write any more, so this file preserves the old shape
 *        verbatim rather than describing it. It carries all four of the things
 *        the chain has to fix, one per step:
 *
 *          v1 → v2  `width` / `height` / `fps` sit at the root, not in `canvas`
 *          v2 → v3  words are `{ text, start, end }` with no index, no `style`
 *          v3 → v4  no `assets` map, no `speakers` map, scene items say `kind`
 *
 *        Typed as JsonObject, not TimelineDoc — it is NOT a timeline document
 *        and typing it as one would mean the current schema had to keep
 *        accepting the old shape forever, which is the exact coupling the
 *        migration chain exists to avoid.
 * WHERE: migrate.test.ts.
 */

import type { JsonObject } from "@/lib/types/json";

export function legacyV1Fixture(): JsonObject {
  return {
    version: 1,
    kind: "reddit-story",
    /* Flat, pre-`canvas`. */
    width: 1080,
    height: 1920,
    fps: 30,
    words: [
      { text: "AITA", start: 0, end: 0.32, speaker: "A" },
      { text: "for", start: 0.32, end: 0.46, speaker: "A" },
      { text: "naming", start: 0.46, end: 0.88, speaker: "A" },
      { text: "my", start: 0.88, end: 1.02, speaker: "A" },
      { text: "sourdough", start: 1.02, end: 1.64, speaker: "A" },
      { text: "Gerald", start: 1.64, end: 2.2, speaker: "A" },
    ],
    tracks: [
      {
        id: "bg",
        type: "video",
        items: [
          {
            id: "i1",
            start: 0,
            duration: 2.2,
            assetId: "bg_loop_01",
            fit: "cover",
            loop: true,
            muted: true,
          },
        ],
      },
      {
        id: "cards",
        type: "scene",
        items: [
          {
            id: "s1",
            start: 0,
            duration: 2.2,
            /* v3 and earlier called the component family `kind`. */
            kind: "redditCard",
            scene: {
              layout: "stack-center",
              elements: [
                {
                  id: "e1",
                  kind: "title",
                  text: "AITA for naming my sourdough Gerald?",
                },
              ],
            },
          },
        ],
      },
      {
        id: "narration",
        type: "audio",
        items: [
          {
            id: "a1",
            start: 0,
            duration: 2.2,
            assetId: "narration_old",
            speaker: "A",
            gain: 1,
          },
        ],
      },
      {
        id: "captions",
        type: "caption",
        items: [{ id: "c1", startWord: 0, endWord: 5, position: { y: 0.7 } }],
      },
    ],
  };
}
