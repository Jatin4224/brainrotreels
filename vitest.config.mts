/**
 * SOURCE OF TRUTH KEYWORDS: vitest.config, SERVER_ONLY_STUB, PROVIDERS_ACTIVE_ALIAS,
 *                           tsconfigPaths, restoreMocks, test environment
 *
 * WHAT:  Vitest configuration for unit tests across src/.
 * WHY:   Three resolutions are load-bearing and the suite cannot run without
 *        them. `server-only` resolves to a throwing browser build outside
 *        Next, and every file under src/services/ imports it (eslint enforces
 *        that), so it is stubbed to an empty module. `@providers-active` has
 *        no Vitest resolver of its own — tsconfig.json and next.config.ts each
 *        declare their own and DISAGREE (active.tsx vs active.better-auth.tsx);
 *        the concrete provider surface is what actually runs, so this matches
 *        next.config.ts. `@/*` comes from resolve.tsconfigPaths, which Vite
 *        now supports natively — no plugin needed.
 *        `restoreMocks`/`clearMocks` matter more than usual: React cache() is
 *        called at module scope in feature-gate, usage.service and trpc/init,
 *        so state would otherwise bleed between tests.
 *        The file is .mts so Vite's native config loader reads it as ESM.
 * WHERE: Run by `npm test` / `npm run test:watch`, and by CI.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      'server-only': path.resolve(dirname, 'src/test/stubs/server-only.ts'),
      '@providers-active': path.resolve(
        dirname,
        'src/components/global/providers/active.better-auth.tsx',
      ),
      '@providers-active-actions': path.resolve(
        dirname,
        'src/components/global/providers/better-auth/actions.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    clearMocks: true,
    restoreMocks: true,
    /* Module state resets per file. Several modules read env and call cache()
     * at import time, so a registry shared across files would leak; a test
     * needing a fresh module within one file calls vi.resetModules() itself. */
    isolate: true,
  },
})
