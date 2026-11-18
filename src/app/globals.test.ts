/**
 * SOURCE OF TRUTH KEYWORDS: HOVER_IS_A_CAPABILITY, globals.css, hover gating,
 *   prefers-reduced-motion, hand-written hover rules
 *
 * WHAT:  Asserts that every hand-written `:hover` rule in globals.css sits
 *        inside `@media (hover: hover)`.
 * WHY:   A touch browser has no pointer to move away, so it fakes the hover on
 *        tap and holds it until something else is tapped — a tapped card stays
 *        lifted and a tapped button stays lit for as long as the visitor reads
 *        the screen. Tailwind's own `hover:` variant compiles to this query;
 *        hand-written CSS has to say so itself, and three rules here did not.
 *        A sentence in a design doc did not stop that happening, so this is a
 *        check instead: it runs on every commit and names the offending line.
 * WHERE: src/app/globals.css.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(path.resolve(__dirname, './globals.css'), 'utf8')

/**
 * Walks the stylesheet tracking which at-rules the cursor is inside, and
 * returns every `:hover` selector that is not covered by a hover query.
 *
 * A `:hover` inside `@media (prefers-reduced-motion: reduce)` is allowed: those
 * rules only ever REMOVE motion, so leaving one ungated cannot strand a touch
 * device in a hover state.
 */
function ungatedHoverRules(css: string): { line: number; selector: string }[] {
  const lines = css.split('\n')
  const stack: string[] = []
  const offenders: { line: number; selector: string }[] = []

  lines.forEach((raw, index) => {
    const line = raw.trim()

    if (line.startsWith('@')) {
      stack.push(line)
    } else if (line.includes(':hover') && line.includes('{')) {
      const gated = stack.some(
        (at) =>
          /@media[^{]*\(\s*hover\s*:\s*hover\s*\)/.test(at) ||
          /@media[^{]*prefers-reduced-motion/.test(at),
      )
      if (!gated) {
        offenders.push({ line: index + 1, selector: line.replace(/\s*\{.*$/, '') })
      }
    }

    /* Track nesting last, so a selector is judged against the at-rules that
       already enclose it rather than the brace on its own line. */
    const opened = (raw.match(/\{/g) ?? []).length
    const closed = (raw.match(/\}/g) ?? []).length
    for (let i = 0; i < closed; i += 1) stack.pop()
    if (opened > closed && !line.startsWith('@')) stack.push('rule')
  })

  return offenders
}

describe('HOVER_IS_A_CAPABILITY', () => {
  it('gates every hand-written :hover rule behind @media (hover: hover)', () => {
    const offenders = ungatedHoverRules(CSS)
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Ungated :hover rules — a touch tap will stick in this state:\n${offenders
            .map((o) => `  globals.css:${o.line}  ${o.selector}`)
            .join('\n')}`,
    ).toEqual([])
  })

  it('finds the rules it is meant to be guarding', () => {
    /* Guards the guard: if globals.css is restructured so no :hover is seen at
       all, the test above would pass vacuously and the protection would be
       gone without anyone noticing. */
    expect(CSS.match(/:hover/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })
})
