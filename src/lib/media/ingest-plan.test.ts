/**
 * SOURCE OF TRUTH KEYWORDS: planVariants, assertSupportedMedia, posterTimeFor,
 *                           fitForKind, UnsupportedMediaError, ingest plan tests
 *
 * WHAT:  The decisions the ingest pipeline makes before it touches a file —
 *        which variants to build, what to refuse, where to take a poster.
 * WHY:   These are the assertions that would otherwise require a video file, a
 *        bucket and an ffmpeg install to check, which is to say they would not
 *        be checked. The module is pure precisely so they can be.
 *        The refusal cases matter most. Phase 02's last requirement is that a
 *        corrupt file ends up `failed` with a readable error and never reaches
 *        a render — "corrupt" in practice means a file ffprobe opens and finds
 *        nothing in, which is a probe with no video AND no audio stream. If
 *        that case stops throwing, nothing downstream notices: the pipeline
 *        would transcode nothing successfully and mark the asset ready.
 * WHERE: Run by `npm test`. Guards src/lib/media/ingest-plan.ts.
 */

import { describe, expect, it } from 'vitest'

import type { MediaProbe } from '@/lib/adapters/media/types'
import {
  PROXY,
  THUMB_WIDTH,
  UnsupportedMediaError,
  VERTICAL_MASTER,
  assertSupportedMedia,
  fitForKind,
  planVariants,
  posterTimeFor,
} from './ingest-plan'

function probe(overrides: Partial<MediaProbe> = {}): MediaProbe {
  return {
    containerFormat: 'mov,mp4,m4a',
    durationSec: 30,
    bytes: 1024,
    video: { codec: 'h264', width: 1920, height: 1080, fps: 30 },
    audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
    ...overrides,
  }
}

describe('assertSupportedMedia', () => {
  it('accepts a normal H.264 + AAC video', () => {
    expect(() => assertSupportedMedia(probe())).not.toThrow()
  })

  it('accepts a silent video', () => {
    expect(() => assertSupportedMedia(probe({ audio: null }))).not.toThrow()
  })

  it('accepts an audio-only file', () => {
    expect(() =>
      assertSupportedMedia(probe({ video: null, audio: { codec: 'mp3', channels: 2, sampleRate: 44100 } }))
    ).not.toThrow()
  })

  /* The corrupt-file case. See the WHY above — this is the one that has to
   * keep throwing for Phase 02's final check to hold. */
  it('refuses a file with no video and no audio stream', () => {
    expect(() => assertSupportedMedia(probe({ video: null, audio: null }))).toThrow(
      UnsupportedMediaError
    )
  })

  it('tells the customer what to do about an unsupported video codec', () => {
    const run = () =>
      assertSupportedMedia(probe({ video: { codec: 'hevc', width: 1080, height: 1920, fps: 30 } }))

    expect(run).toThrow(UnsupportedMediaError)
    /* The codec is named and the fix is stated — a bare "unsupported format"
     * is a support ticket. */
    expect(run).toThrow(/HEVC/)
    expect(run).toThrow(/H\.264/)
  })

  it('refuses an unsupported audio codec and names it', () => {
    const run = () =>
      assertSupportedMedia(
        probe({ video: null, audio: { codec: 'alac', channels: 2, sampleRate: 44100 } })
      )

    expect(run).toThrow(UnsupportedMediaError)
    expect(run).toThrow(/ALAC/)
  })

  it('refuses a video reporting no picture size', () => {
    expect(() =>
      assertSupportedMedia(probe({ video: { codec: 'h264', width: 0, height: 0, fps: 30 } }))
    ).toThrow(UnsupportedMediaError)
  })
})

describe('fitForKind', () => {
  /* CROP_OR_PAD. These two lines are the product decision; if they swap, every
   * background grows black bars and every customer upload gets cropped. */
  it('crops texture kinds and pads the customer\'s own content', () => {
    expect(fitForKind('background')).toBe('crop')
    expect(fitForKind('ai_footage')).toBe('crop')
    expect(fitForKind('upload')).toBe('pad')
    expect(fitForKind('image')).toBe('pad')
  })
})

describe('planVariants — video', () => {
  const plans = planVariants({
    family: 'video',
    kind: 'upload',
    facts: { durationSec: 30, source: { width: 1920, height: 1080 } },
  })

  it('builds a vertical master, a proxy and a thumbnail', () => {
    expect(plans.map((plan) => plan.variant)).toEqual(['vertical_1080', 'proxy_480', 'thumb'])
  })

  it('lands the master on the 1080x1920 canvas', () => {
    const master = plans[0]
    expect(master?.width).toBe(VERTICAL_MASTER.width)
    expect(master?.height).toBe(VERTICAL_MASTER.height)
    expect(master?.transcode?.crf).toBe(VERTICAL_MASTER.crf)
  })

  /* The pairing architecture.md relies on: the proxy is derived FROM the
   * master, which is what makes the editor preview and the final render the
   * same framing. Deriving it from the original would reintroduce the drift. */
  it('derives the proxy from the master, not from the original', () => {
    const proxy = plans.find((plan) => plan.variant === 'proxy_480')
    expect(proxy?.source).toBe('vertical_1080')
    expect(proxy?.width).toBe(PROXY.width)
  })

  it('takes the poster from the master so it matches what will render', () => {
    const thumb = plans.find((plan) => plan.variant === 'thumb')
    expect(thumb?.source).toBe('vertical_1080')
    expect(thumb?.operation).toBe('frame')
    expect(thumb?.width).toBe(THUMB_WIDTH)
  })

  it('keeps a customer upload\'s own audio and drops a background\'s', () => {
    const uploadMaster = plans.find((plan) => plan.variant === 'vertical_1080')
    expect(uploadMaster?.transcode?.muted).toBe(false)

    const backgroundMaster = planVariants({
      family: 'video',
      kind: 'background',
      facts: { durationSec: 30, source: { width: 1920, height: 1080 } },
    }).find((plan) => plan.variant === 'vertical_1080')
    expect(backgroundMaster?.transcode?.muted).toBe(true)
  })
})

describe('planVariants — image', () => {
  const plans = planVariants({
    family: 'image',
    kind: 'image',
    facts: { durationSec: null, source: { width: 1200, height: 800 } },
  })

  it('writes the master as a still rather than a one-frame video', () => {
    const master = plans.find((plan) => plan.variant === 'vertical_1080')
    expect(master?.transcode?.encode).toBe('still')
    expect(master?.contentType).toBe('image/jpeg')
  })

  /* No proxy: a JPEG is already small enough to preview, and a second copy
   * would be storage charged for nothing. */
  it('builds no proxy', () => {
    expect(plans.some((plan) => plan.variant === 'proxy_480')).toBe(false)
  })

  it('keeps the source ratio on the thumbnail, at an even height', () => {
    const thumb = plans.find((plan) => plan.variant === 'thumb')
    /* 480 wide against 1200x800 is 320 tall. */
    expect(thumb?.height).toBe(320)
    expect((thumb?.height ?? 1) % 2).toBe(0)
  })
})

describe('planVariants — audio', () => {
  const plans = planVariants({
    family: 'audio',
    kind: 'audio_music',
    facts: { durationSec: 120, source: null },
  })

  /* A black 1080p video of a music file is the failure this asserts against. */
  it('builds only a waveform', () => {
    expect(plans.map((plan) => plan.variant)).toEqual(['waveform'])
    expect(plans[0]?.operation).toBe('waveform')
    expect(plans[0]?.contentType).toBe('image/png')
  })
})

describe('posterTimeFor', () => {
  /* One second in, because the first frame of a huge share of real video is
   * black — and a library of black rectangles looks broken. */
  it('takes the poster a second in for a normal clip', () => {
    expect(posterTimeFor(30)).toBe(1)
  })

  it('uses the midpoint of a clip shorter than a second', () => {
    expect(posterTimeFor(0.5)).toBe(0.25)
  })

  /* Seeking past the end produces NO frame, so an unknown length must not
   * seek at all. */
  it('does not seek when the length is unknown', () => {
    expect(posterTimeFor(null)).toBe(0)
    expect(posterTimeFor(0)).toBe(0)
  })
})
