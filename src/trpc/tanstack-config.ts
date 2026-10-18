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
 * SOURCE OF TRUTH KEYWORDS: makeQueryClient
 *
 * WHAT:  Shared TanStack QueryClient factory used by both server prefetch and
 *        the browser provider.
 * WHY:   Hydration only succeeds when both sides use IDENTICAL default options;
 *        a single factory eliminates drift. `retry: false` is deliberate — tRPC
 *        already returns typed errors and a retry just stalls the UI.
 * WHERE: Imported by src/trpc/server.tsx (server) and src/trpc/react-provider.tsx
 *        (client).
 */

import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query'

export const makeQueryClient = () => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        /* tRPC surfaces typed errors (permission/limit/etc.) — retrying just
         * delays the error UI. */
        retry: false,
      },
      dehydrate: {
        /* `pending` opt-in lets streaming SSR ship in-flight queries; the
         * client picks them up without re-firing. */
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
    },
  })
}
