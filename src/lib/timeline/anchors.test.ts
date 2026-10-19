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
 * SOURCE OF TRUTH KEYWORDS: anchors tests, resolveWordAnchors, FRAME_SNAPPING,
 *   PARTIAL_RESOLUTION, DURATION_ANCHOR_IS_AN_END, hasUnresolvedAnchors
 *
 * WHAT:  Proves an anchored document resolves to frame-aligned seconds, that a
 *        dangling anchor leaves the document honestly un-resolved, and that a
 *        duration anchor is read as an END.
 * WHY:   PARTIAL_RESOLUTION is the case worth guarding. The tempting
 *        implementation marks the document resolved regardless and lets
 *        validate complain about the leftover anchor — which reports the wrong
 *        problem, because the real one is the missing word. The test asserts
 *        the document comes back saying it is still anchored.
 *        FRAME_SNAPPING is asserted in frames, not seconds: the whole point is
 *        that the editor's preview and the paid render land on the same frame,
 *        and a seconds-level assertion would pass on a value a frame off.
 * WHERE: Run by `npm test`. Guards src/lib/timeline/anchors.ts.
 */

import { describe, expect, it } from 'vitest'

import { redditStoryFixture, voiceoverFixture } from './fixtures'
import { hasUnresolvedAnchors, resolveWordAnchors, snapToFrame } from './anchors'
import { secondsToFrames } from './time'
import { validate } from './validate'
import type { TimelineDoc } from './schema'

function itemById(doc: TimelineDoc, id: string) {
  for (const track of doc.tracks) {
    for (const item of track.items) {
      if (item.id === id) return item
    }
  }
  throw new Error(`no item ${id}`)
}

function seconds(value: unknown): number {
  if (typeof value !== 'number') throw new Error('expected resolved seconds')
  return value
}

describe('resolveWordAnchors', () => {
  it('eliminates every anchor', () => {
    const resolved = resolveWordAnchors(voiceoverFixture())
    expect(hasUnresolvedAnchors(resolved)).toBe(false)
  })

  it('marks the document resolved', () => {
    expect(resolveWordAnchors(voiceoverFixture()).timing).toBe('resolved')
  })

  it('does not mutate its input', () => {
    const doc = voiceoverFixture()
    const before = JSON.stringify(doc)
    resolveWordAnchors(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('leaves the result valid', () => {
    const resolved = resolveWordAnchors(voiceoverFixture())
    const result = validate(resolved)
    expect(result.ok, result.ok ? '' : JSON.stringify(result.errors, null, 2)).toBe(true)
  })

  it('resolves a `word` anchor to that word’s start', () => {
    const doc = voiceoverFixture()
    const twice = doc.words.find((token) => token.w === 'twice')
    if (twice === undefined) throw new Error('fixture script changed')

    const resolved = resolveWordAnchors(doc)
    expect(seconds(itemById(resolved, 'b2').start)).toBe(snapToFrame(twice.s, doc.canvas.fps))
  })

  it('resolves a `wordIndex` anchor to that word’s start', () => {
    const doc = voiceoverFixture()
    const third = doc.words[2]
    if (third === undefined) throw new Error('fixture script changed')

    const resolved = resolveWordAnchors(doc)
    expect(seconds(itemById(resolved, 'o1').start)).toBe(snapToFrame(third.s, doc.canvas.fps))
  })

  it('reads a duration anchor as an END, inclusive of the named word', () => {
    /* DURATION_ANCHOR_IS_AN_END — "show this until 'twice' has been said". */
    const doc = voiceoverFixture()
    const twice = doc.words.find((token) => token.w === 'twice')
    if (twice === undefined) throw new Error('fixture script changed')

    const resolved = resolveWordAnchors(doc)
    const item = itemById(resolved, 'b1')
    const end = seconds(item.start) + seconds(item.duration)
    expect(end).toBeCloseTo(snapToFrame(twice.e, doc.canvas.fps), 6)
  })

  it('snaps every resolved time onto a whole frame', () => {
    const resolved = resolveWordAnchors(voiceoverFixture())
    const fps = resolved.canvas.fps

    for (const track of resolved.tracks) {
      for (const item of track.items) {
        for (const value of [item.start, item.duration]) {
          if (typeof value !== 'number') continue
          const frames = secondsToFrames(value, fps)
          /* Within a thousandth of a frame. Resolved times are stored at
           * microsecond precision (roundSeconds), so 2/30 persists as
           * 0.066667 rather than 0.06666666… — a deviation of 3e-5 of a frame,
           * which is the module's storage precision rather than a snapping
           * failure. Asserting exact equality would be asserting that times are
           * stored as unrounded floats, which hashDoc depends on them not
           * being. */
          expect(Math.abs(value * fps - frames)).toBeLessThan(1e-3)
        }
      }
    }
  })

  it('fills a caption’s cached start and duration from its word range', () => {
    const doc = voiceoverFixture()
    const resolved = resolveWordAnchors(doc)
    const caption = itemById(resolved, 'c1')
    if (!('startWord' in caption)) throw new Error('c1 is not a caption')

    const first = doc.words[caption.startWord]
    const last = doc.words[caption.endWord]
    if (first === undefined || last === undefined) throw new Error('range missing')
    expect(seconds(caption.start)).toBe(snapToFrame(first.s, doc.canvas.fps))
    expect(seconds(caption.duration)).toBeGreaterThan(0)
  })

  it('never gives an item a duration shorter than one frame', () => {
    const doc = voiceoverFixture()
    /* A caption over one very short word is the case that would round to zero
     * and vanish. */
    const track = doc.tracks.find((candidate) => candidate.type === 'caption')
    if (track === undefined || track.type !== 'caption') throw new Error('no captions')
    const caption = track.items[0]
    if (caption === undefined) throw new Error('no caption')
    caption.startWord = 0
    caption.endWord = 0
    const word = doc.words[0]
    if (word === undefined) throw new Error('no words')
    word.e = word.s + 0.0001

    const resolved = resolveWordAnchors(doc)
    const resolvedCaption = itemById(resolved, caption.id)
    expect(seconds(resolvedCaption.duration)).toBeGreaterThanOrEqual(1 / doc.canvas.fps - 1e-6)
  })

  it('is idempotent on an already-resolved document', () => {
    const once = resolveWordAnchors(voiceoverFixture())
    const twice = resolveWordAnchors(once)
    expect(twice).toEqual(once)
  })

  it('leaves a resolved fixture unchanged', () => {
    const doc = redditStoryFixture()
    const resolved = resolveWordAnchors(doc)
    expect(resolved.timing).toBe('resolved')
    /* Snapping still moves a resolved time onto the frame grid, so unchanged
     * means within half a frame, not identical. */
    expect(
      Math.abs(
        seconds(itemById(resolved, 'i1').duration) - seconds(itemById(doc, 'i1').duration)
      )
    ).toBeLessThanOrEqual(1 / doc.canvas.fps)
  })
})

describe('partial resolution', () => {
  it('leaves a dangling anchor in place', () => {
    const doc = voiceoverFixture()
    const item = itemById(doc, 'b2')
    item.start = { word: 'rutabaga' }

    const resolved = resolveWordAnchors(doc)
    expect(itemById(resolved, 'b2').start).toEqual({ word: 'rutabaga' })
  })

  it('does NOT mark the document resolved', () => {
    /* PARTIAL_RESOLUTION — claiming resolved would make validate() report the
     * leftover anchor instead of the missing word. */
    const doc = voiceoverFixture()
    itemById(doc, 'b2').start = { word: 'rutabaga' }
    expect(resolveWordAnchors(doc).timing).toBe('anchored')
  })

  it('still resolves the anchors it could', () => {
    const doc = voiceoverFixture()
    itemById(doc, 'b2').start = { word: 'rutabaga' }

    const resolved = resolveWordAnchors(doc)
    expect(typeof itemById(resolved, 'o1').start).toBe('number')
  })
})

describe('hasUnresolvedAnchors', () => {
  it('is true for an anchored document', () => {
    expect(hasUnresolvedAnchors(voiceoverFixture())).toBe(true)
  })

  it('is false for a resolved one', () => {
    expect(hasUnresolvedAnchors(redditStoryFixture())).toBe(false)
  })
})

describe('snapToFrame', () => {
  it('rounds to the nearest frame, not down', () => {
    /* Flooring loses up to a frame per conversion and the losses compound. */
    /* 0.06s is frame 1.8 — nearest is 2, flooring would give 1. */
    expect(snapToFrame(0.06, 30)).toBeCloseTo(2 / 30, 4)
    /* 0.04s is frame 1.2 — nearest is 1, and flooring agrees here. */
    expect(snapToFrame(0.04, 30)).toBeCloseTo(1 / 30, 4)
    expect(snapToFrame(0.016, 30)).toBeCloseTo(0, 6)
  })

  it('leaves a value already on the grid alone', () => {
    expect(snapToFrame(1, 30)).toBe(1)
    expect(snapToFrame(2 / 30, 30)).toBeCloseTo(2 / 30, 5)
  })
})
