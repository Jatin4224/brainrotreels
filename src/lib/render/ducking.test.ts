/**
 * SOURCE OF TRUTH KEYWORDS: duckingVolumeAt, DUCKING_CURVE, DUCK_LEVEL,
 *                           ducking tests, narrationWindows
 *
 * WHAT:  The volume curve a music bed follows under narration.
 * WHY:   Every case here has a plausible wrong answer that nobody would catch
 *        by watching a preview once: a ramp that runs the wrong direction, a
 *        bed that swells back up in the gap between two sentences, a duck that
 *        never recovers, or a curve that depends on frame rate. All of them
 *        sound like mixing choices rather than bugs, which is exactly why they
 *        are asserted rather than listened for.
 * WHERE: Run by `npm test`. Guards src/lib/render/ducking.ts.
 */

import { describe, expect, it } from 'vitest'

import { DUCK_LEVEL, DUCK_RAMP_SECONDS, duckingVolumeAt } from './ducking'

const fps = 30
const ramp = Math.round(DUCK_RAMP_SECONDS * fps)

function volumeAt(frame: number, windows: { from: number; durationInFrames: number }[]) {
  return duckingVolumeAt({ frame, fps, windows })
}

describe('duckingVolumeAt', () => {
  it('leaves the bed alone when nothing is narrating', () => {
    expect(volumeAt(0, [])).toBe(1)
    expect(volumeAt(500, [])).toBe(1)
  })

  it('is fully ducked for the body of a narration window', () => {
    const windows = [{ from: 100, durationInFrames: 60 }]
    expect(volumeAt(100, windows)).toBe(DUCK_LEVEL)
    expect(volumeAt(130, windows)).toBe(DUCK_LEVEL)
    expect(volumeAt(159, windows)).toBe(DUCK_LEVEL)
  })

  it('is at full volume well away from any narration', () => {
    const windows = [{ from: 100, durationInFrames: 60 }]
    expect(volumeAt(0, windows)).toBe(1)
    expect(volumeAt(300, windows)).toBe(1)
  })

  /* The ramp runs DOWN before the window so the bed is already low when the
   * first syllable lands, rather than dipping underneath it. */
  it('ramps down before the narration starts', () => {
    const windows = [{ from: 100, durationInFrames: 60 }]
    const before = volumeAt(100 - ramp + 1, windows)
    const closer = volumeAt(100 - 1, windows)

    expect(before).toBeLessThan(1)
    expect(before).toBeGreaterThan(DUCK_LEVEL)
    expect(closer).toBeLessThan(before)
  })

  it('ramps back up after the narration ends', () => {
    const windows = [{ from: 100, durationInFrames: 60 }]
    const justAfter = volumeAt(160, windows)
    const later = volumeAt(160 + ramp - 1, windows)

    expect(justAfter).toBeGreaterThanOrEqual(DUCK_LEVEL)
    expect(later).toBeGreaterThan(justAfter)
    expect(volumeAt(160 + ramp, windows)).toBe(1)
  })

  it('never leaves the bed louder than it started or below the duck level', () => {
    const windows = [{ from: 50, durationInFrames: 40 }]
    for (let frame = 0; frame < 200; frame += 1) {
      const volume = volumeAt(frame, windows)
      expect(volume).toBeLessThanOrEqual(1)
      expect(volume).toBeGreaterThanOrEqual(DUCK_LEVEL)
    }
  })

  /* Two sentences with a short gap: taking the last window, or averaging,
   * would let the bed swell in the middle of the gap — audible as a pump. The
   * DEEPEST duck wins instead. */
  it('stays ducked across a short gap between two narration lines', () => {
    const windows = [
      { from: 100, durationInFrames: 30 },
      { from: 132, durationInFrames: 30 },
    ]
    expect(volumeAt(131, windows)).toBeLessThan(0.9)
  })

  it('takes the deepest duck when windows overlap', () => {
    const windows = [
      { from: 100, durationInFrames: 60 },
      { from: 120, durationInFrames: 60 },
    ]
    expect(volumeAt(130, windows)).toBe(DUCK_LEVEL)
  })

  /* A line starting at frame 0 has nowhere to ramp. It must still be ducked
   * from the first frame rather than starting at full volume. */
  it('is ducked from frame 0 when narration starts there', () => {
    expect(volumeAt(0, [{ from: 0, durationInFrames: 60 }])).toBe(DUCK_LEVEL)
  })

  /* The curve is defined in SECONDS, so it has to behave the same at a
   * different frame rate — a 24fps document must not get a longer ramp. */
  it('ramps over the same duration at a different frame rate', () => {
    const at24 = duckingVolumeAt({
      frame: 24,
      fps: 24,
      windows: [{ from: 24 + Math.round(DUCK_RAMP_SECONDS * 24), durationInFrames: 48 }],
    })
    const at30 = duckingVolumeAt({
      frame: 30,
      fps: 30,
      windows: [{ from: 30 + Math.round(DUCK_RAMP_SECONDS * 30), durationInFrames: 60 }],
    })
    expect(at24).toBeCloseTo(at30, 5)
  })

  /* Pure: the same inputs give the same answer, which is what
   * RENDER_DETERMINISM requires of everything on this path. */
  it('is a pure function of its arguments', () => {
    const windows = [{ from: 10, durationInFrames: 20 }]
    expect(volumeAt(15, windows)).toBe(volumeAt(15, windows))
  })
})
