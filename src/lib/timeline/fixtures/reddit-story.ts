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
 * SOURCE OF TRUTH KEYWORDS: redditStoryFixture, REDDIT_STORY_LAYOUT,
 *   redditCard, bg_loop_07, narration_a1
 *
 * WHAT:  A complete reddit-story document: a looping gameplay background, one
 *        narration line, word-grouped captions, the post card over the opening
 *        seconds, and a subscribe badge.
 * WHY:   REDDIT_STORY_LAYOUT. This is the format the whole product was shaped
 *        around, so it is the fixture that exercises the most of the schema:
 *        five track types at once, a scene item whose `render` is `redditCard`,
 *        two overlays at different depths, and captions that cover the script
 *        in groups rather than one per word.
 *        Returned RESOLVED — every time is an absolute second — because this is
 *        the shape a document has after the pipeline has run, which is what the
 *        renderer and the hash tests need.
 * WHERE: src/lib/timeline/*.test.ts; the Phase 03 Remotion studio.
 */

import type { CaptionItem, TimelineDoc } from '../schema'
import { buildWords } from './words'

const SCRIPT =
  'AITA for telling my roommate that his sourdough starter is not a pet? ' +
  'He has named it Gerald and he talks to it every morning.'

export function redditStoryFixture(): TimelineDoc {
  const words = buildWords(SCRIPT, { speaker: 'A' })
  const last = words[words.length - 1]
  /* The narration is the spine, so everything else is measured against it. */
  const narrationEnd = last === undefined ? 0 : last.e

  return {
    version: 4,
    kind: 'reddit-story',
    timing: 'resolved',
    canvas: { width: 1080, height: 1920, fps: 30 },
    style: { paletteId: 'noir', captionStyleId: 'bold-pop', safeZone: 'tiktok' },
    words,
    tracks: [
      {
        id: 'bg',
        type: 'video',
        label: 'Background',
        items: [
          {
            id: 'i1',
            start: 0,
            duration: narrationEnd,
            assetId: 'bg_loop_07',
            fit: 'cover',
            loop: true,
            muted: true,
            render: 'media',
          },
        ],
      },
      {
        id: 'cards',
        type: 'scene',
        label: 'Post card',
        items: [
          {
            id: 's1',
            start: 0,
            duration: 4.2,
            render: 'redditCard',
            scene: {
              layout: 'stack-center',
              elements: [
                { id: 'e1', kind: 'subreddit', text: 'r/AmItheAsshole' },
                { id: 'e2', kind: 'title', text: 'AITA for telling my roommate his sourdough starter is not a pet?' },
                { id: 'e3', kind: 'score', text: '14.2k' },
              ],
            },
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
            assetId: 'narration_a1',
            speaker: 'A',
            gain: 1,
            duck: false,
            loop: false,
          },
        ],
      },
      {
        id: 'music',
        type: 'audio',
        label: 'Music',
        items: [
          {
            id: 'm1',
            start: 0,
            duration: narrationEnd,
            assetId: 'music_bed_lofi',
            gain: 0.12,
            duck: true,
            loop: true,
          },
        ],
      },
      {
        id: 'captions',
        type: 'caption',
        label: 'Captions',
        styleId: 'bold-pop',
        items: groupCaptions(words.length),
      },
      {
        id: 'overlays',
        type: 'overlay',
        label: 'Overlays',
        items: [
          {
            id: 'o1',
            start: 0.4,
            duration: 2.6,
            render: 'media',
            z: 10,
            box: { x: 0.08, y: 0.1, w: 0.3, h: 0.12 },
            assetId: 'logo_badge',
          },
          {
            id: 'o2',
            start: 3.2,
            duration: 2,
            render: 'text',
            z: 20,
            box: { x: 0.1, y: 0.82, w: 0.8, h: 0.08 },
            text: 'Follow for part two',
          },
        ],
      },
    ],
    speakers: { A: { voiceId: 'lib_ava', displayName: 'Ava' } },
    assets: {
      bg_loop_07: { assetId: 'ast_bg_loop_07', kind: 'video', license: 'licensed' },
      narration_a1: { assetId: 'ast_narration_a1', kind: 'audio', license: 'generated' },
      music_bed_lofi: { assetId: 'ast_music_lofi', kind: 'audio', license: 'licensed' },
      logo_badge: { assetId: 'ast_logo_badge', kind: 'image', license: 'owned' },
    },
  }
}

/* Captions in groups of four words — the grouping Phase 08 settles properly.
 * Four is enough to prove the word-range contract without hand-listing them. */
const WORDS_PER_CAPTION = 4

function groupCaptions(wordCount: number): CaptionItem[] {
  const items: CaptionItem[] = []

  for (let start = 0; start < wordCount; start += WORDS_PER_CAPTION) {
    const end = Math.min(start + WORDS_PER_CAPTION - 1, wordCount - 1)
    items.push({
      id: `c${items.length + 1}`,
      startWord: start,
      endWord: end,
      position: { y: 0.72 },
    })
  }
  return items
}
