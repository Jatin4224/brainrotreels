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
 * SOURCE OF TRUTH KEYWORDS: determinism test, RENDER_DETERMINISM,
 *   NONDETERMINISTIC_SOURCES, collectRenderSources
 *
 * WHAT:  Reads every source file under src/remotion/ and src/lib/render/ and
 *        fails if one reads the clock, a random number, or anything else
 *        outside its props.
 * WHY:   Phase 04 reuses a render whenever the document hash matches. A
 *        component that varies between runs therefore makes a CACHED render
 *        differ from a fresh one — two customers paying for the same video and
 *        receiving different files, with nothing in the document to explain
 *        it. Remotion also renders frames out of order across several
 *        processes, so these values are not stable even WITHIN one render: the
 *        symptom is a frame that flickers rather than a clean failure.
 *
 *        There is an eslint rule saying the same thing, and a rule is
 *        skippable — by a disable comment, by a config that stops matching the
 *        path, by `--no-verify`. This test is not, and it is the reason the
 *        determinism claim can be relied on when Phase 04 starts charging for
 *        renders and caching them.
 *
 *        Matched TEXTUALLY, like the timeline purity test, rather than by
 *        executing anything: a call that is merely present is enough to make a
 *        render unreproducible, and running the components would need a
 *        browser this suite deliberately does not have.
 * WHERE: Run by `npm test`. Guards src/remotion/** and src/lib/render/**.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REMOTION_DIR = fileURLToPath(new URL('.', import.meta.url))
const RENDER_DIR = join(REMOTION_DIR, '..', 'lib', 'render')

/**
 * SOURCE OF TRUTH KEYWORDS: NONDETERMINISTIC_SOURCES
 *
 * WHAT:  The calls that make a frame depend on something other than the
 *        document and the frame number.
 * WHY:   Each one is a real way a render stops reproducing, not a style rule:
 *        the clock advances between two renders of the same document, a random
 *        id differs per frame AND per worker process, and a locale- or
 *        timezone-dependent format differs per machine — which matters because
 *        Phase 04 renders on Lambda rather than on the developer's laptop.
 * WHERE: The scan below.
 */
const NONDETERMINISTIC_SOURCES: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bDate\s*\.\s*now\s*\(/, why: 'Date.now() advances between renders' },
  { pattern: /\bnew\s+Date\s*\(\s*\)/, why: 'new Date() reads the clock' },
  { pattern: /\bMath\s*\.\s*random\s*\(/, why: 'Math.random() differs per frame and per worker' },
  { pattern: /\bperformance\s*\.\s*now\s*\(/, why: 'performance.now() reads the clock' },
  { pattern: /\bcrypto\s*\.\s*randomUUID\s*\(/, why: 'a random id differs between renders' },
  {
    pattern: /\btoLocaleDateString\s*\(|\btoLocaleTimeString\s*\(/,
    why: 'locale formatting differs between the dev machine and the render worker',
  },
]

/**
 * SOURCE OF TRUTH KEYWORDS: stripComments, SCAN_CODE_NOT_PROSE
 *
 * WHAT:  Removes block comments and whole-line comments before scanning.
 * WHY:   SCAN_CODE_NOT_PROSE. Every file on this path DOCUMENTS the
 *        determinism rule, which means the forbidden calls appear by name in
 *        the very comments explaining why they are forbidden — and a raw
 *        textual scan flags those, failing on the files that are most careful.
 *        Stripping first is what makes the guard about behaviour rather than
 *        about vocabulary.
 *        Whole-line comments only, matched on the line's leading characters:
 *        a trailing `// …` cannot be removed safely without a parser, because
 *        `//` also appears inside the `https://` URLs in these headers, and
 *        cutting at the first one would hide real code that follows on the
 *        same line.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*')
    })
    .join('\n')
}

function collectRenderSources(dir: string): { path: string; source: string }[] {
  const files: { path: string; source: string }[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectRenderSources(full))
      continue
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue
    /* The tests themselves are exempt: this file names every forbidden call
     * in its own patterns, and a test may legitimately need a clock. */
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue

    files.push({ path: full, source: stripComments(readFileSync(full, 'utf8')) })
  }

  return files
}

describe('RENDER_DETERMINISM', () => {
  const sources = [...collectRenderSources(REMOTION_DIR), ...collectRenderSources(RENDER_DIR)]

  it('finds the render sources to scan', () => {
    /* A guard on the guard: a refactor that moved these folders would
     * otherwise make this suite pass by scanning nothing. */
    expect(sources.length).toBeGreaterThan(8)
  })

  it.each(NONDETERMINISTIC_SOURCES)('never calls $why', ({ pattern }) => {
    const offenders = sources
      .filter((file) => pattern.test(file.source))
      .map((file) => file.path.replace(REMOTION_DIR, ''))

    expect(offenders).toEqual([])
  })

  /* The registry's own fallback is part of the determinism story: an unknown
   * kind must resolve the SAME way every time (to nothing) rather than
   * throwing on one worker and not another. */
  it('keeps the component registry a module-level constant', () => {
    const registry = sources.find((file) => file.path.endsWith('registry.ts'))
    expect(registry).toBeDefined()
    expect(registry?.source).toMatch(/export const RENDER_COMPONENTS/)
  })
})
