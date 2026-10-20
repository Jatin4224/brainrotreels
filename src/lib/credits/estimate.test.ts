/**
 * SOURCE OF TRUTH KEYWORDS: estimate, estimateRenderCost, CREDIT_RATES,
 *   ESTIMATE_ROUNDS_UP, LINES_MUST_ADD_UP, BREAKDOWN_NEVER_A_BARE_TOTAL,
 *   credit estimate tests
 *
 * WHAT:  What a job costs, and whether the itemised bill can be trusted.
 * WHY:   This function produces the number on the button, the number held
 *        before the work starts and the number compared against the actual —
 *        so an error here is not a wrong total, it is a customer shown one
 *        price and charged another.
 *
 *        The assertions are written against PROPERTIES, not against the
 *        placeholder rates. `CREDIT_RATES` has not been priced yet (see
 *        PLACEHOLDER_CREDIT_RATES), so a test asserting "a 60s render costs 9"
 *        would fail the moment real prices are set and would have to be
 *        rewritten rather than checked. What must hold whatever the rates are:
 *        the total is a whole number, it never goes negative, longer costs
 *        more, 1080p costs more than 720p, and the lines add up to the total.
 * WHERE: Run by `npm test`. Guards src/lib/credits/estimate.ts.
 */

import { describe, expect, it } from 'vitest'

import { CREDITABLE_KINDS } from '@/lib/types/credits'
import { CREDIT_RATES, estimate, estimateRenderCost } from './estimate'

function sumLines(breakdown: { lines: { credits: number }[] }): number {
  return breakdown.lines.reduce((sum, line) => sum + line.credits, 0)
}

describe('estimate', () => {
  it('returns whole credits for every kind', () => {
    /* A fractional credit cannot be held or committed — the ledger column is
     * an integer, so a non-integer here would be silently rounded somewhere
     * further down, by whichever layer noticed first. */
    for (const kind of CREDITABLE_KINDS) {
      const result = estimate({ kind, durationSeconds: 37.4, aiImages: 3 })
      expect(Number.isInteger(result.total), kind).toBe(true)
      expect(result.total, kind).toBeGreaterThanOrEqual(0)
    }
  })

  it('itemises rather than returning a bare total', () => {
    /* BREAKDOWN_NEVER_A_BARE_TOTAL — a customer disputing a charge needs
     * something to point at. */
    const result = estimate({ kind: 'render', durationSeconds: 60, resolution: '1080p' })
    expect(result.lines.length).toBeGreaterThan(1)
    expect(result.lines.every((line) => line.label.length > 0)).toBe(true)
  })

  it('makes the lines add up to the total', () => {
    /* LINES_MUST_ADD_UP. The total is rounded up from the EXACT sum, so
     * rounding each line independently would routinely produce a bill that
     * does not reconcile — which makes a customer distrust every number on it,
     * including the correct ones. Checked across many durations because the
     * drift only appears at particular fractional values. */
    for (let seconds = 1; seconds <= 180; seconds += 1) {
      const result = estimate({ kind: 'render', durationSeconds: seconds, resolution: '1080p' })
      expect(sumLines(result), `${seconds}s`).toBe(result.total)
    }
  })

  it('charges more for a longer job', () => {
    const short = estimate({ kind: 'render', durationSeconds: 10 })
    const long = estimate({ kind: 'render', durationSeconds: 120 })
    expect(long.total).toBeGreaterThan(short.total)
  })

  it('charges more for 1080p than for 720p', () => {
    /* The entitlement in RESOLUTION_PER_PLAN says who MAY render at 1080p;
     * this says it costs more when they do. If these ever disagreed, the
     * higher tier would be giving away the more expensive output. */
    const sd = estimate({ kind: 'render', durationSeconds: 90, resolution: '720p' })
    const hd = estimate({ kind: 'render', durationSeconds: 90, resolution: '1080p' })
    expect(hd.total).toBeGreaterThan(sd.total)
  })

  it('applies the resolution multiplier only to renders', () => {
    /* `resolution` is meaningless for a TTS clip, and a kind that silently
     * picked it up would charge differently for narration depending on a field
     * its caller had no reason to set. */
    const a = estimate({ kind: 'tts', durationSeconds: 90, resolution: '720p' })
    const b = estimate({ kind: 'tts', durationSeconds: 90, resolution: '1080p' })
    expect(a.total).toBe(b.total)
  })

  it('charges per generated image', () => {
    const none = estimate({ kind: 'footage', aiImages: 0 })
    const four = estimate({ kind: 'footage', aiImages: 4 })
    expect(four.total - none.total).toBe(CREDIT_RATES.perAiImage * 4)
  })

  it('adds the premium-voice surcharge only when there is narration to charge for', () => {
    const plain = estimate({ kind: 'tts', durationSeconds: 60 })
    const premium = estimate({ kind: 'tts', durationSeconds: 60, premiumVoice: true })
    expect(premium.total).toBeGreaterThan(plain.total)

    /* No duration means no narration, so there is nothing to surcharge — a
     * flat surcharge on a zero-length clip would charge for silence. */
    const empty = estimate({ kind: 'tts', durationSeconds: 0, premiumVoice: true })
    const emptyPlain = estimate({ kind: 'tts', durationSeconds: 0 })
    expect(empty.total).toBe(emptyPlain.total)
  })

  /**
   * The inputs that would otherwise produce a charge nobody intended. Each of
   * these is reachable: a zero frame rate divides to Infinity, a document with
   * a broken duration produces NaN, and a negative is what a subtraction of
   * two timestamps in the wrong order gives you.
   */
  it('refuses to let a bad duration produce a bad charge', () => {
    const base = estimate({ kind: 'render', durationSeconds: 0 }).total

    for (const bad of [-1, -1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = estimate({ kind: 'render', durationSeconds: bad })
      expect(Number.isInteger(result.total), String(bad)).toBe(true)
      expect(result.total, String(bad)).toBe(base)
    }
  })

  it('never produces a negative total, which would pay the customer', () => {
    for (const kind of CREDITABLE_KINDS) {
      const result = estimate({ kind, durationSeconds: -500, aiImages: -10 })
      expect(result.total, kind).toBeGreaterThanOrEqual(0)
      expect(result.lines.every((line) => line.credits >= 0), kind).toBe(true)
    }
  })
})

describe('estimateRenderCost', () => {
  it('agrees exactly with estimate() for the same render', () => {
    /* ONE_CALLER_ONE_SHAPE. Three places price a render — the refusal, the
     * hold and the commit — and they must agree to the credit or a render is
     * refused at one price and charged at another. */
    const viaWrapper = estimateRenderCost({ durationSeconds: 95, resolution: '1080p' })
    const viaEstimate = estimate({ kind: 'render', durationSeconds: 95, resolution: '1080p' })
    expect(viaWrapper).toEqual(viaEstimate)
  })

  it('is deterministic — the same render always costs the same', () => {
    /* The hold and the commit happen minutes apart, in different processes. If
     * this were not stable, every render would release or overcharge by the
     * difference. */
    const first = estimateRenderCost({ durationSeconds: 61.5, resolution: '720p' })
    const second = estimateRenderCost({ durationSeconds: 61.5, resolution: '720p' })
    expect(first).toEqual(second)
  })
})

describe('CREDIT_RATES', () => {
  it('names a base and a per-second rate for every creditable kind', () => {
    /* A missing rate is `undefined`, which makes the arithmetic NaN — and a
     * NaN total would be held, committed and shown to a customer without
     * anything throwing. This is the guard that makes adding a kind fail
     * loudly here rather than quietly in the money. */
    for (const kind of CREDITABLE_KINDS) {
      expect(typeof CREDIT_RATES.base[kind], kind).toBe('number')
      expect(typeof CREDIT_RATES.perSecond[kind], kind).toBe('number')
      expect(CREDIT_RATES.base[kind], kind).toBeGreaterThanOrEqual(0)
      expect(CREDIT_RATES.perSecond[kind], kind).toBeGreaterThanOrEqual(0)
    }
  })
})
