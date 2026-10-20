/**
 * SOURCE OF TRUTH KEYWORDS: planComposition, planTimeline, planFrame,
 *                           LAYER_ORDER, frame snapshots, render plan tests
 *
 * WHAT:  The draw list: what exists, in what order, and what is on screen at
 *        the first, middle and last frame of a fixture.
 * WHY:   These are the brief's three-frame snapshots, taken against the PLAN
 *        rather than against rendered pixels — deliberately, and the tradeoff
 *        is worth stating. A pixel snapshot needs a headless browser, takes
 *        tens of seconds, and fails on an ffmpeg or Chrome version bump that
 *        changes nothing about this product. The plan is where the decisions
 *        that can actually be wrong live: visibility windows, stacking order,
 *        frame conversion, and whether an unresolved item is silently drawn at
 *        zero. The pixels are covered by the local render (`npm run
 *        remotion:render`), which this suite cannot run and a human can look at.
 *
 *        Snapshots are inline, so a reviewer sees the change in the diff
 *        rather than in a separate file nobody opens.
 * WHERE: Run by `npm test`. Guards src/lib/render/frame-plan.ts.
 */

import { describe, expect, it } from 'vitest'

import { redditStoryFixture, motionFixture } from '@/lib/timeline/fixtures'
import { resolveWordAnchors } from '@/lib/timeline'
import { LAYER_ORDER, planComposition, planFrame, planTimeline } from './frame-plan'

const doc = resolveWordAnchors(redditStoryFixture())

/* A compact, readable shape for the snapshots — the full item would bury the
 * three things these assertions are about. */
function summarise(frame: number) {
  return planFrame(doc, frame).map(
    (plan) => `${plan.trackType}:${plan.id} render=${plan.render ?? '-'} [${plan.from}..${plan.from + plan.durationInFrames})`
  )
}

describe('planComposition', () => {
  it('derives the canvas and length from the document, not from a constant', () => {
    const plan = planComposition(doc)
    expect(plan.width).toBe(1080)
    expect(plan.height).toBe(1920)
    expect(plan.fps).toBe(30)
    expect(plan.durationInFrames).toBe(228)
    expect(plan.durationInSeconds).toBeCloseTo(7.6, 1)
  })

  /* MINIMUM_ONE_FRAME. A zero-length composition is a Remotion error rather
   * than an empty video, and a project is created before it is generated —
   * so an empty document has to remain openable. */
  it('never returns a zero-frame composition', () => {
    const empty = { ...doc, tracks: [], words: [] }
    expect(planComposition(empty).durationInFrames).toBe(1)
  })

  /* A pure motion piece has no video and no audio lane. documentLength falls
   * back to the furthest point on ANY lane rather than collapsing to zero. */
  it('measures a document with no spine from its other lanes', () => {
    expect(planComposition(motionFixture()).durationInFrames).toBeGreaterThan(1)
  })
})

describe('planTimeline', () => {
  it('composites lanes bottom-up: video, scene, overlay, caption', () => {
    expect(LAYER_ORDER.video).toBeLessThan(LAYER_ORDER.scene)
    expect(LAYER_ORDER.scene).toBeLessThan(LAYER_ORDER.overlay)
    expect(LAYER_ORDER.overlay).toBeLessThan(LAYER_ORDER.caption)

    const layers = planTimeline(doc)
      .filter((plan) => plan.trackType !== 'audio')
      .map((plan) => plan.layer)
    expect(layers).toEqual([...layers].sort((a, b) => a - b))
  })

  /* Overlays are the only items that declare a depth, and two of them share a
   * layer, so `z` has to break the tie or the stack order is whatever the sort
   * implementation happens to do. */
  it('orders overlays by their own z', () => {
    const overlays = planTimeline(doc).filter((plan) => plan.trackType === 'overlay')
    expect(overlays.map((plan) => plan.z)).toEqual([10, 20])
  })

  /* A render is reused by document hash in Phase 04, so an unstable draw order
   * would produce two different videos from one hash. */
  it('is a stable, total order — planning twice gives the identical list', () => {
    expect(planTimeline(doc).map((plan) => plan.id)).toEqual(
      planTimeline(doc).map((plan) => plan.id)
    )
  })

  /* SKIP_UNRESOLVED_ITEM: an anchor naming a word the script does not contain
   * must be DROPPED, never drawn at frame 0 — an item at the start of the
   * video that belongs at 0:42 is a wrong video, not an incomplete one. */
  it('drops an item whose anchor does not resolve', () => {
    const broken = {
      ...doc,
      tracks: [
        ...doc.tracks,
        {
          id: 'ghost',
          type: 'overlay' as const,
          items: [
            {
              id: 'ghost-1',
              start: { word: 'thisWordIsNotInTheScript' },
              duration: 2,
              render: 'text' as const,
              z: 99,
              box: { x: 0, y: 0, w: 1 },
              text: 'nowhere',
            },
          ],
        },
      ],
    }

    expect(planTimeline(broken).some((plan) => plan.id === 'ghost-1')).toBe(false)
    /* …and the rest of the document still plans. */
    expect(planTimeline(broken).length).toBe(planTimeline(doc).length)
  })

  it('drops a zero-length item rather than planning an empty sequence', () => {
    const zero = {
      ...doc,
      tracks: [
        {
          id: 'z',
          type: 'overlay' as const,
          items: [
            {
              id: 'zero-1',
              start: 1,
              duration: 0,
              render: 'text' as const,
              z: 1,
              box: { x: 0, y: 0, w: 1 },
              text: 'blink',
            },
          ],
        },
      ],
    }
    expect(planTimeline(zero)).toEqual([])
  })
})

describe('planFrame — first, middle and last frame of the fixture', () => {
  const last = planComposition(doc).durationInFrames - 1
  const middle = Math.floor(last / 2)

  /* FRAME_WINDOW_IS_HALF_OPEN — the first frame of the video. The background,
   * both audio beds and the opening post card are up; the badge overlay starts
   * at 0.4s and is correctly absent. */
  it('frame 0', () => {
    expect(summarise(0)).toMatchInlineSnapshot(`
      [
        "audio:a1 render=- [0..228)",
        "audio:m1 render=- [0..228)",
        "video:i1 render=media [0..228)",
        "scene:s1 render=redditCard [0..126)",
        "caption:c1 render=- [0..36)",
      ]
    `)
  })

  it('middle frame', () => {
    expect(summarise(middle)).toMatchInlineSnapshot(`
      [
        "audio:a1 render=- [0..228)",
        "audio:m1 render=- [0..228)",
        "video:i1 render=media [0..228)",
        "scene:s1 render=redditCard [0..126)",
        "overlay:o2 render=text [96..156)",
        "caption:c3 render=- [85..116)",
      ]
    `)
  })

  it('last frame', () => {
    expect(summarise(last)).toMatchInlineSnapshot(`
      [
        "audio:a1 render=- [0..228)",
        "audio:m1 render=- [0..228)",
        "video:i1 render=media [0..228)",
        "caption:c7 render=- [213..229)",
      ]
    `)
  })

  /* The half-open window, asserted directly: an item is gone on the frame
   * equal to its end. An inclusive end would double-draw one frame wherever
   * two items sit back to back, which is the normal case for captions. */
  it('an item is absent on the frame its window ends', () => {
    const card = planTimeline(doc).find((plan) => plan.id === 's1')
    expect(card).toBeDefined()
    const end = (card?.from ?? 0) + (card?.durationInFrames ?? 0)

    expect(planFrame(doc, end - 1).some((plan) => plan.id === 's1')).toBe(true)
    expect(planFrame(doc, end).some((plan) => plan.id === 's1')).toBe(false)
  })

  it('nothing is on screen past the end of the composition', () => {
    expect(planFrame(doc, planComposition(doc).durationInFrames + 10)).toEqual([])
  })
})

describe('captions are planned but not drawn in this phase', () => {
  /* A caption item has no `render` field at all (WORD_RANGE_NOT_TEXT), so it
   * reaches the composition with `render: null` and the registry draws
   * nothing. It still has to be PLANNED — Phase 08 adds the caption layer and
   * will read these same spans, and dropping them here would hide a timing
   * bug until then. */
  it('plans caption items with no render kind', () => {
    const captions = planTimeline(doc).filter((plan) => plan.trackType === 'caption')
    expect(captions.length).toBeGreaterThan(0)
    expect(captions.every((plan) => plan.render === null)).toBe(true)
  })

  /* Audio is the other kind with no `render`, and the composition dispatches
   * it by TRACK TYPE rather than through the registry. */
  it('plans audio items with no render kind', () => {
    const audio = planTimeline(doc).filter((plan) => plan.trackType === 'audio')
    expect(audio.length).toBe(2)
    expect(audio.every((plan) => plan.render === null)).toBe(true)
  })
})
