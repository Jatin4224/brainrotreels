/**
 * SOURCE OF TRUTH KEYWORDS: RESOURCES, ResourceLimit, ResourceFlag, period,
 *                           registry invariants, PerPlan completeness, resources tests
 *
 * WHAT:  Structural invariants over the feature registry in src/lib/resources.ts.
 * WHY:   The registry is enforced by the procedure builder at runtime, from the
 *        procedure path — so a malformed entry does not fail at the call site
 *        that caused it, it fails later somewhere unrelated. These assertions
 *        move that to build time.
 *        The `period` cases matter most. An absolute resource that gained
 *        `period: 'month'` would silently refill: a free workspace could invite
 *        one member per month forever, and `storage` would drift from the bytes
 *        actually in R2. That failure is invisible in review and expensive in
 *        production, so it is asserted per-resource by name rather than
 *        generically.
 * WHERE: Run by `npm test`. Guards src/lib/resources.ts.
 */

import { describe, expect, it } from 'vitest'

import { PLAN_KEYS } from './config/plans'
import { RESOURCES, type ResourceLimit } from './resources'

const entries = Object.entries(RESOURCES)

/* `RESOURCES` is `as const`, so each entry's literal type only carries the keys
 * it actually writes — `member.limit.period` is a compile error rather than
 * `undefined`. That is a real guarantee for literal access, but it also means a
 * test cannot ask the question generically. Widening to the declared interface
 * is what lets these assertions inspect the shape every entry is meant to have. */
const asLimit = (limit: ResourceLimit): ResourceLimit => limit

describe('RESOURCES invariants', () => {
  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  /* A resource declares one or the other. Both would make the procedure
   * builder run a numeric gate and a boolean gate over the same path. */
  it('never declares both limit and flag', () => {
    for (const [key, def] of entries) {
      const hasLimit = 'limit' in def && def.limit !== undefined
      const hasFlag = 'flag' in def && def.flag !== undefined
      expect(hasLimit && hasFlag, `${key} declares both limit and flag`).toBe(false)
    }
  })

  /* A missing plan key resolves to undefined at gate time, which reads as
   * "no cap" rather than "misconfigured" — the wrong way to fail. */
  it('gives every limit a cap for every plan', () => {
    for (const [key, def] of entries) {
      if (!('limit' in def) || def.limit === undefined) continue
      for (const plan of PLAN_KEYS) {
        expect(def.limit.perPlan[plan], `${key}.limit.perPlan is missing ${plan}`).toBeDefined()
      }
    }
  })

  it('gives every flag a value for every plan', () => {
    for (const [key, def] of entries) {
      if (!('flag' in def) || def.flag === undefined) continue
      for (const plan of PLAN_KEYS) {
        expect(typeof def.flag.perPlan[plan], `${key}.flag.perPlan is missing ${plan}`).toBe(
          'boolean',
        )
      }
    }
  })

  it('gives every limit an upgrade message', () => {
    for (const [key, def] of entries) {
      if (!('limit' in def) || def.limit === undefined) continue
      expect(def.limit.upgradeMessage.length, `${key} has an empty upgradeMessage`).toBeGreaterThan(
        0,
      )
    }
  })
})

describe('limit periodicity', () => {
  it('accepts only "month" where a period is declared', () => {
    for (const [key, def] of entries) {
      if (!('limit' in def) || def.limit === undefined) continue
      const { period } = asLimit(def.limit)
      if (period === undefined) continue
      expect(period, `${key} declares an unsupported period`).toBe('month')
    }
  })

  /* Named explicitly: these are standing counts released by deletion. A reset
   * would hand out the same seats or bytes again every month. */
  it.each(['member', 'storage'] as const)('keeps %s absolute', (key) => {
    expect(asLimit(RESOURCES[key].limit).period, `${key} must not refill`).toBeUndefined()
  })

  it('keeps apiCalls periodic', () => {
    expect(asLimit(RESOURCES.apiCalls.limit).period).toBe('month')
  })
})

describe('retired resources', () => {
  /* Removed in Phase 00: the pricing table and upgrade modal are generated
   * from this registry, so an entry with no implementation behind it is a
   * feature advertised to paying customers that does not exist. */
  it.each(['customDomain', 'customBranding', 'integrations'])(
    'does not re-introduce %s without an implementation',
    (key) => {
      expect(Object.keys(RESOURCES)).not.toContain(key)
    },
  )
})
