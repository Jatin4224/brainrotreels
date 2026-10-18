/**
 * SOURCE OF TRUTH KEYWORDS: envString, envBoolean, envInteger, envOptional,
 *                           LITERAL_ENV_READ, publicEnv, BLANK_IS_UNSET, plans env tests
 *
 * WHAT:  Tests for the public env coercion helpers, plus a source-level guard
 *        that every NEXT_PUBLIC_* read stays literal.
 * WHY:   The coercion rules are ordinary and easy to test. The literal-read
 *        rule is not: it is a bundler behaviour, invisible to a unit test and
 *        to code review, and getting it wrong fails only in the browser and
 *        only silently — the server keeps rendering the right value. The
 *        source assertions below are therefore deliberately crude: they read
 *        the files as text, because the property they protect is a property of
 *        the source as written, not of what it evaluates to under Node.
 * WHERE: Run by `npm test`. Guards env.public.ts and plans.ts.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { envBoolean, envInteger, envOptional, envString } from './env.public'

describe('envString', () => {
  it('returns the value when set', () => {
    expect(envString('rotreels', 'fallback')).toBe('rotreels')
  })

  it('trims surrounding whitespace', () => {
    expect(envString('  rotreels  ', 'fallback')).toBe('rotreels')
  })

  /* BLANK_IS_UNSET: .env.example ships keys as empty strings, so copying it
   * verbatim must not blank every plan name. */
  it('falls back on empty, whitespace and undefined', () => {
    expect(envString('', 'fallback')).toBe('fallback')
    expect(envString('   ', 'fallback')).toBe('fallback')
    expect(envString(undefined, 'fallback')).toBe('fallback')
  })
})

describe('envBoolean', () => {
  it('reads only the exact string "true" as true', () => {
    expect(envBoolean('true', false)).toBe(true)
    expect(envBoolean('  true  ', false)).toBe(true)
    expect(envBoolean('TRUE', false)).toBe(false)
    expect(envBoolean('1', false)).toBe(false)
    expect(envBoolean('yes', false)).toBe(false)
  })

  it('treats any other non-empty value as false rather than falling back', () => {
    expect(envBoolean('false', true)).toBe(false)
    expect(envBoolean('nonsense', true)).toBe(false)
  })

  it('falls back on empty and undefined', () => {
    expect(envBoolean('', true)).toBe(true)
    expect(envBoolean(undefined, true)).toBe(true)
    expect(envBoolean('   ', false)).toBe(false)
  })
})

describe('envInteger', () => {
  it('parses a non-negative integer', () => {
    expect(envInteger('14', 0)).toBe(14)
    expect(envInteger('0', 7)).toBe(0)
    expect(envInteger('  30  ', 0)).toBe(30)
  })

  /* A trial length that silently became NaN or -1 would be read as a cap. */
  it('rejects negatives, decimals and nonsense', () => {
    expect(envInteger('-1', 14)).toBe(14)
    expect(envInteger('3.5', 14)).toBe(14)
    expect(envInteger('fourteen', 14)).toBe(14)
    expect(envInteger('14abc', 14)).toBe(14)
  })

  it('falls back on empty and undefined', () => {
    expect(envInteger('', 14)).toBe(14)
    expect(envInteger(undefined, 14)).toBe(14)
  })
})

describe('envOptional', () => {
  /* Must stay undefined, not '', for exactOptionalPropertyTypes consumers. */
  it('returns undefined rather than an empty string', () => {
    expect(envOptional('')).toBeUndefined()
    expect(envOptional('   ')).toBeUndefined()
    expect(envOptional(undefined)).toBeUndefined()
  })

  it('returns a trimmed value when set', () => {
    expect(envOptional('  price_123  ')).toBe('price_123')
  })
})

describe('LITERAL_ENV_READ', () => {
  const read = (relative: string): string =>
    readFileSync(path.resolve(__dirname, relative), 'utf8')

  /* A computed read is `process.env[` followed by anything that is not a
   * quoted literal — exactly the shape Next refuses to inline client-side. */
  const COMPUTED_READ = /process\.env\[(?!['"])/

  it('reads every variable in env.public.ts literally', () => {
    const source = read('./env.public.ts')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(COMPUTED_READ.test(code)).toBe(false)
  })

  it('keeps plans.ts free of direct env access', () => {
    const source = read('./plans.ts')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toContain('process.env')
  })

  it('covers every plan-facing variable declared in .env.example', () => {
    const example = readFileSync(path.resolve(__dirname, '../../../.env.example'), 'utf8')
    const declared = [...example.matchAll(/^(NEXT_PUBLIC_[A-Z0-9_]+)=/gm)].map((m) => m[1])
    const source = read('./env.public.ts')

    expect(declared.length).toBeGreaterThan(0)
    for (const key of declared) {
      expect(source, `${key} is in .env.example but never read`).toContain(
        `process.env['${key}']`,
      )
    }
  })
})
