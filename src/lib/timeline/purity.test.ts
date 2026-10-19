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
 * SOURCE OF TRUTH KEYWORDS: purity test, TIMELINE_PURITY, FORBIDDEN_IMPORTS,
 *   ISOMORPHIC_PURE_MODULE, collectImports
 *
 * WHAT:  Reads every source file under src/lib/timeline/ and fails if one
 *        imports Prisma, `server-only`, a Node built-in, or the framework.
 * WHY:   The claim this module is built on is that the SAME apply() runs in the
 *        browser editor and on the server. There is an eslint rule saying so,
 *        and a rule is skippable — by a disable comment, by a config that
 *        stops matching the path, by `--no-verify`. This test is not, and it is
 *        the reason the claim can be relied on in Phase 15 when the editor
 *        starts importing from here.
 *        It parses imports textually rather than by loading the modules: an
 *        import that is merely PRESENT already breaks a client bundle, even if
 *        nothing calls it, so a runtime check would pass on a module that fails
 *        to build.
 * WHERE: Run by `npm test`. Guards every file in src/lib/timeline/.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const MODULE_DIR = join(fileURLToPath(new URL('.', import.meta.url)))

/**
 * SOURCE OF TRUTH KEYWORDS: FORBIDDEN_IMPORTS
 *
 * WHAT:  What may never appear in an import under src/lib/timeline/.
 * WHY:   Each entry names what it would break, because a future reader deleting
 *        one needs to know the cost. The list mirrors the eslint rule in
 *        eslint.config.mjs; if they disagree, this one is the contract.
 * WHERE: The assertion below.
 */
const FORBIDDEN_IMPORTS: ReadonlyArray<{ pattern: RegExp; breaks: string }> = [
  { pattern: /^node:/, breaks: 'the browser bundle — Node built-ins do not exist there' },
  {
    pattern: /^(fs|path|crypto|os|child_process|stream|buffer|util|url|zlib|http|https|worker_threads|perf_hooks)(\/|$)/,
    breaks: 'the browser bundle — these are Node built-ins under their bare names',
  },
  { pattern: /^server-only$/, breaks: 'the editor — a server-only module cannot be imported client-side' },
  { pattern: /^client-only$/, breaks: 'the renderer and every server-side read' },
  {
    pattern: /^(@prisma\/client|@\/generated\/prisma)(\/|$)/,
    breaks: 'purity — a document module must not reach the database',
  },
  { pattern: /^@\/services\//, breaks: 'purity — services are server-only Prisma wrappers' },
  { pattern: /^@\/trpc\//, breaks: 'purity — the procedure layer is a caller, not a dependency' },
  { pattern: /^@\/lib\/adapters(\/|$)/, breaks: 'purity — providers belong behind a router, not here' },
  {
    pattern: /^(react|react-dom|next)(\/|$)/,
    breaks: 'framework independence — the renderer and the editor consume this, not the reverse',
  },
]

/* Static imports, `export ... from`, and dynamic import() — a dynamic one
 * bundles the same way, so it must be caught too. */
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

function collectImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1]
    if (specifier !== undefined) found.push(specifier)
  }
  return found
}

describe('src/lib/timeline is pure and isomorphic', () => {
  const files = sourceFiles(MODULE_DIR)

  it('has source files to check', () => {
    /* A refactor that moved or renamed the folder would otherwise make this
     * whole suite pass by checking nothing. */
    expect(files.length).toBeGreaterThan(8)
  })

  it.each(files.map((file) => [file.slice(MODULE_DIR.length), file] as const))(
    '%s imports nothing platform-specific',
    (_label, file) => {
      const offenders = collectImports(file).flatMap((specifier) => {
        const rule = FORBIDDEN_IMPORTS.find((entry) => entry.pattern.test(specifier))
        return rule === undefined ? [] : [`${specifier} — breaks ${rule.breaks}`]
      })
      expect(offenders).toEqual([])
    }
  )

  it('reaches outside the module only for zod and shared pure types', () => {
    /* A positive assertion as well as the negative one above: the allow-list is
     * short on purpose, and a new entry should be a deliberate decision rather
     * than something that slipped past a blocklist nobody updated. */
    const allowed = new Set(['zod', '@/lib/types/json', '@/lib/types/project'])
    const external = new Set<string>()

    for (const file of files) {
      for (const specifier of collectImports(file)) {
        if (specifier.startsWith('./') || specifier.startsWith('../')) continue
        external.add(specifier)
      }
    }

    expect([...external].filter((specifier) => !allowed.has(specifier))).toEqual([])
  })
})
