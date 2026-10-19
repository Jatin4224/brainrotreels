/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: voiceoverFixture, ANCHORED_FIXTURE, wordIndex
 *   anchors, b-roll
 *
 * WHAT:  A voiceover document in its ANCHORED form: the b-roll shots and the
 *        overlay are positioned by word, not by second.
 * WHY:   ANCHORED_FIXTURE. Every other fixture is resolved, and a module whose
 *        central claim is "documents are two-formed" needs one of each or half
 *        its behaviour is untested. This is the shape a generator hands over
 *        BEFORE resolveWordAnchors runs: the writer said "cut to the second
 *        shot on the word 'twice'", and the seconds are not known until the
 *        voice has been synthesised.
 *        It carries both anchor forms on purpose — `{ wordIndex }`, which
 *        generators use, and `{ word }`, which an LLM writing by hand uses.
 * WHERE: anchors.test.ts, validate.test.ts; the Phase 06 generator tests.
 */

import type { TimelineDoc } from '../schema'
import { buildWords } from './words'

const SCRIPT =
  'Most people check their email twice before breakfast and call it a morning routine.'

export function voiceoverFixture(): TimelineDoc {
  const words = buildWords(SCRIPT, { speaker: 'N' })
  const last = words[words.length - 1]
  const narrationEnd = last === undefined ? 0 : last.e

  return {
    version: 4,
    kind: 'voiceover',
    timing: 'anchored',
    canvas: { width: 1080, height: 1920, fps: 30 },
    style: { paletteId: 'warm', captionStyleId: 'clean-lower', safeZone: 'reels' },
    words,
    tracks: [
      {
        id: 'broll',
        type: 'video',
        label: 'B-roll',
        items: [
          /* The opening shot runs from the top until the word "twice" has been
           * said — a duration anchor, which is an END. See
           * DURATION_ANCHOR_IS_AN_END in time.ts. */
          {
            id: 'b1',
            start: 0,
            duration: { word: 'twice' },
            assetId: 'shot_inbox',
            fit: 'cover',
            loop: false,
            muted: true,
            render: 'media',
          },
          {
            id: 'b2',
            start: { word: 'twice' },
            duration: 3.4,
            assetId: 'shot_kitchen',
            fit: 'cover',
            loop: false,
            muted: true,
            render: 'media',
          },
        ],
      },
      {
        id: 'narration',
        type: 'audio',
        label: 'Narration',
        items: [
          {
            id: 'a1',
            start: 0,
            duration: narrationEnd,
            assetId: 'narration_n1',
            speaker: 'N',
            gain: 1,
            duck: false,
            loop: false,
          },
        ],
      },
      {
        id: 'captions',
        type: 'caption',
        label: 'Captions',
        items: [
          { id: 'c1', startWord: 0, endWord: 4, position: { y: 0.78 } },
          { id: 'c2', startWord: 5, endWord: Math.max(words.length - 1, 5), position: { y: 0.78 } },
        ],
      },
      {
        id: 'overlays',
        type: 'overlay',
        label: 'Overlays',
        items: [
          {
            id: 'o1',
            start: { wordIndex: 2 },
            duration: { wordIndex: 5 },
            render: 'text',
            z: 5,
            box: { x: 0.12, y: 0.16, w: 0.76, h: 0.1 },
            text: 'Twice. Before breakfast.',
          },
        ],
      },
    ],
    speakers: { N: { voiceId: 'lib_noah', displayName: 'Noah' } },
    assets: {
      shot_inbox: { assetId: 'ast_shot_inbox', kind: 'video', license: 'stock' },
      shot_kitchen: { assetId: 'ast_shot_kitchen', kind: 'video', license: 'stock' },
      narration_n1: { assetId: 'ast_narration_n1', kind: 'audio', license: 'generated' },
    },
  }
}
