/**
 * SOURCE OF TRUTH KEYWORDS: RESOLUTION_PER_PLAN, resolutionsForPlan,
 *   bestResolutionForPlan, RENDER_STATUSES, isTerminalRenderStatus,
 *   createRenderSchema, NO_WATERMARK_INPUT, LOCKED_NOT_HIDDEN
 *
 * WHAT:  The entitlement table and the status vocabulary a render is driven by.
 * WHY:   Three things here are plan promises rather than implementation
 *        details, and each one is a refund or a free export if it drifts:
 *        which resolutions a plan includes, which states are final, and what a
 *        client is allowed to ask for. They are asserted as the PROMISE —
 *        "free cannot render 1080p" — rather than as the table's contents, so
 *        a deliberate pricing change reads as a deliberate test change.
 * WHERE: Run by `npm test`. Guards the Phase 04 half of src/lib/types/render.ts.
 */

import { describe, expect, it } from 'vitest'

import { PLAN_KEYS } from '@/lib/config/plans'
import {
  RENDER_RESOLUTIONS,
  RENDER_STATUSES,
  RESOLUTION_PER_PLAN,
  SCALE_BY_RESOLUTION,
  bestResolutionForPlan,
  createRenderSchema,
  isResolutionAllowedForPlan,
  isRetryableRenderStatus,
  isTerminalRenderStatus,
  renderStatusSchema,
} from './render'

describe('resolution entitlements', () => {
  it('gives every plan at least one resolution', () => {
    /* A plan with none would make bestResolutionForPlan throw on the render
     * panel's first paint — a blank screen for everyone on that tier. */
    for (const plan of PLAN_KEYS) {
      expect(RESOLUTION_PER_PLAN[plan].length, plan).toBeGreaterThan(0)
    }
  })

  it('keeps 1080p off the free plan', () => {
    /* The product promise this table exists for. Free renders at 720p with a
     * watermark; both halves have to hold or the paid tier sells nothing. */
    expect(isResolutionAllowedForPlan('free', '1080p')).toBe(false)
    expect(isResolutionAllowedForPlan('free', '720p')).toBe(true)
  })

  it('gives every paid plan the full set', () => {
    for (const plan of PLAN_KEYS.filter((key) => key !== 'free')) {
      expect([...RESOLUTION_PER_PLAN[plan]].sort(), plan).toEqual([...RENDER_RESOLUTIONS].sort())
    }
  })

  it('preselects the best resolution a plan includes, not the first one listed', () => {
    /* The order of the per-plan array is how somebody happened to type it, and
     * the default a customer sees must not depend on that. */
    expect(bestResolutionForPlan('free')).toBe('720p')
    expect(bestResolutionForPlan('pro')).toBe('1080p')
  })

  it('names a scale for every resolution', () => {
    /* A missing entry would reach the provider as `scale: undefined` and
     * render at full size — handing a free workspace a 1080p export. */
    for (const resolution of RENDER_RESOLUTIONS) {
      expect(SCALE_BY_RESOLUTION[resolution], resolution).toBeGreaterThan(0)
    }
    /* 1080p is the document's own canvas, so it must not rescale at all —
     * anything else resamples every frame for no reason. */
    expect(SCALE_BY_RESOLUTION['1080p']).toBe(1)
    expect(SCALE_BY_RESOLUTION['720p']).toBeLessThan(1)
  })
})

describe('render status vocabulary', () => {
  it('treats exactly the three end states as terminal', () => {
    /* TERMINAL_IS_FINAL in renders.service.ts filters every write on this. If
     * `rendering` ever became terminal, no render could ever complete; if
     * `completed` stopped being terminal, a late webhook could resurrect a
     * render the customer was told had failed. */
    const terminal = RENDER_STATUSES.filter(isTerminalRenderStatus)
    expect([...terminal].sort()).toEqual(['completed', 'failed', 'timedOut'])
  })

  it('allows a retry only from the two failure states', () => {
    const retryable = RENDER_STATUSES.filter(isRetryableRenderStatus)
    expect([...retryable].sort()).toEqual(['failed', 'timedOut'])
    /* Specifically NOT from `completed` — retrying a finished render would
     * start a second paid render of a video that already exists. */
    expect(isRetryableRenderStatus('completed')).toBe(false)
  })

  it('refuses a status it does not know', () => {
    expect(renderStatusSchema.safeParse('cancelled').success).toBe(false)
  })
})

describe('createRenderSchema', () => {
  it('accepts a well-formed request', () => {
    const parsed = createRenderSchema.safeParse({
      organizationId: 'org_1',
      projectId: 'prj_1',
      resolution: '1080p',
    })
    expect(parsed.success).toBe(true)
  })

  it('refuses a resolution outside the union', () => {
    const parsed = createRenderSchema.safeParse({
      organizationId: 'org_1',
      projectId: 'prj_1',
      resolution: '4k',
    })
    expect(parsed.success).toBe(false)
  })

  /**
   * NO_WATERMARK_INPUT. The schema is not `.strict()`, so an extra key is
   * stripped rather than rejected — which is the behaviour that matters here:
   * a client sending `watermark: false` must not have it reach the handler.
   * The entitlement is the only source (WATERMARK_RESOLVED_ONCE).
   */
  it('drops a client-supplied watermark instead of honouring it', () => {
    const parsed = createRenderSchema.parse({
      organizationId: 'org_1',
      projectId: 'prj_1',
      resolution: '720p',
      watermark: false,
    })
    expect('watermark' in parsed).toBe(false)
  })
})
