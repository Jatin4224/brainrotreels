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
 * SOURCE OF TRUTH KEYWORDS: createProviderSelector, assertActive, PROVIDER_ISOLATION,
 *   provider seam tests, JOB_EVENT_NAMES
 *
 * WHAT:  Tests for the generic provider selector and the jobs seam's wiring.
 * WHY:   The selector's job is to fail LOUDLY on a bad id and to refuse to let
 *        a second implementation run. Both are error paths, which means
 *        neither is exercised by normal use and both would rot silently.
 * WHERE: Run by `npm test`. Guards select-provider.ts and adapters/jobs.
 */

import { describe, expect, it } from 'vitest'

import { createProviderSelector } from './select-provider'
import { JOB_EVENT_NAMES, JOBS_PROVIDER_IDS } from './jobs/types'

const ids = ['alpha', 'beta'] as const
type TestId = (typeof ids)[number]

const makeSelector = (rawValue: string | undefined) =>
  createProviderSelector<TestId>({
    label: 'test',
    envVar: 'TEST_PROVIDER',
    rawValue,
    ids,
    fallback: 'alpha',
  })

describe('createProviderSelector', () => {
  it('falls back when unset, empty or whitespace', () => {
    expect(makeSelector(undefined).provider).toBe('alpha')
    expect(makeSelector('').provider).toBe('alpha')
    expect(makeSelector('   ').provider).toBe('alpha')
  })

  it('selects a registered id, case- and whitespace-insensitively', () => {
    expect(makeSelector('beta').provider).toBe('beta')
    expect(makeSelector('  BETA  ').provider).toBe('beta')
  })

  /* A typo must not quietly fall back to a DIFFERENT provider than the
   * operator configured — that is the exact mixing this prevents. */
  it('throws on an unknown id, naming the value and the valid options', () => {
    expect(() => makeSelector('inngst')).toThrowError(/inngst/)
    expect(() => makeSelector('inngst')).toThrowError(/alpha, beta/)
  })

  it('accepts assertActive for the selected provider', () => {
    expect(() => makeSelector('beta').assertActive('beta')).not.toThrow()
  })

  /* The runtime backstop: a stray static import of the wrong implementation
   * must die at boot rather than opening a second connection. */
  it('throws from assertActive for a non-selected provider', () => {
    const selector = makeSelector('beta')
    expect(() => selector.assertActive('alpha')).toThrowError(/side by side/)
    expect(() => selector.assertActive('alpha')).toThrowError(/TEST_PROVIDER="beta"/)
  })

  it('narrows with isId', () => {
    const selector = makeSelector(undefined)
    expect(selector.isId('alpha')).toBe(true)
    expect(selector.isId('gamma')).toBe(false)
  })
})

describe('jobs seam', () => {
  it('registers inngest as a known engine', () => {
    expect(JOBS_PROVIDER_IDS).toContain('inngest')
  })

  /* Event names are a closed union so a typo cannot enqueue an event no
   * workflow listens for — which presents as "the job never ran". */
  it('declares every event the phases rely on', () => {
    for (const name of [
      'hello/requested',
      'project/requested',
      'project/cancelled',
      'render/requested',
      'asset/uploaded',
      'footage/requested',
      'line/changed',
    ]) {
      expect(JOB_EVENT_NAMES).toContain(name)
    }
  })

  it('keeps event names in the "domain/verb" shape Inngest expects', () => {
    for (const name of JOB_EVENT_NAMES) {
      expect(name, `${name} is not domain/verb`).toMatch(/^[a-z]+\/[a-z]+$/)
    }
  })
})
