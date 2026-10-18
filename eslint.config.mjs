/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/middleware',
                '**/middleware.ts',
                './middleware',
                '../middleware',
              ],
              message:
                'Next.js 16 uses `proxy.ts`, not `middleware.ts`. Import from the proxy module instead.',
            },
            // PROVIDER_ISOLATION layer 3 — see src/lib/adapters/provider.ts.
            // A provider SDK may only be imported from that provider's own
            // adapter folder (and its UI implementation folder). Everything
            // else must go through the AuthAdapter contract, so adding a second
            // provider cannot quietly couple the app to either one. Add a group
            // here for every provider SDK you introduce.
            {
              group: ['better-auth', 'better-auth/*', 'better-auth/**'],
              message:
                'PROVIDER_ISOLATION: import the Better Auth SDK only inside src/lib/better-auth/**, src/lib/adapters/better-auth/** or src/components/global/providers/better-auth/**. Elsewhere, use getAuthAdapter() from @/lib/adapters.',
            },
            // The same fence for every NON-auth provider seam. These use their
            // own selector (src/lib/adapters/select-provider.ts), not the auth
            // machinery — see that file for why they cannot share it.
            {
              group: ['inngest', 'inngest/*', 'inngest/**'],
              message:
                'PROVIDER_ISOLATION: import the Inngest SDK only inside src/lib/adapters/jobs/inngest/**, src/inngest/** or src/app/api/inngest/**. Elsewhere, use enqueue() from @/lib/adapters/jobs.',
            },
          ],
        },
      ],
    },
  },
  {
    // The sanctioned homes for each provider SDK. These folders ARE the
    // translation layer, so the restriction above is lifted here only.
    files: [
      'src/lib/adapters/better-auth/**/*.ts',
      'src/lib/better-auth/**/*.ts',
      // The server barrel IS the composition point — it imports provider
      // COMPONENTS (never SDKs) to build the wrappers, so the relative-path
      // form of the restriction must not apply to it.
      'src/components/global/providers/server.tsx',
      // The per-provider surface modules resolved by the @providers-active
      // alias. They compose provider COMPONENTS, never SDKs.
      'src/components/global/providers/active.tsx',
      'src/components/global/providers/active.better-auth.tsx',
      'src/components/global/providers/better-auth/**/*.ts',
      'src/components/global/providers/better-auth/**/*.tsx',
      'src/app/api/auth/**',
      // Jobs seam. The adapter folder is the translation layer; src/inngest/**
      // holds workflow definitions, which are written against the engine's own
      // step API on purpose (see JobsAdapter's WHY); the route serves them.
      'src/lib/adapters/jobs/inngest/**/*.ts',
      'src/inngest/**/*.ts',
      'src/app/api/inngest/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/middleware',
                '**/middleware.ts',
                './middleware',
                '../middleware',
              ],
              message:
                'Next.js 16 uses `proxy.ts`, not `middleware.ts`. Import from the proxy module instead.',
            },
          ],
        },
      ],
    },
  },
  {
    // shadcn-generated UI primitives — kept close to upstream generator output
    // for easy regeneration. The `createContext<T>({} as T)` and CSS-var
    // typing patterns are shadcn idioms.
    files: ['src/components/ui/**/*.tsx', 'src/components/ui/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as' },
      ],
    },
  },
  {
    files: ['src/services/**/*.service.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Program > :first-child:not(ImportDeclaration[source.value='server-only'])",
          message:
            "Service files must start with `import 'server-only'` (before any other code — doc comments above it are fine) so they can never be bundled into client code.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'src/generated/**',
  ]),
])

export default eslintConfig
