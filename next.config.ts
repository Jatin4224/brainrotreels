/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

import path from "node:path";
import type { NextConfig } from "next";

/**
 * SOURCE OF TRUTH KEYWORDS: PROVIDER_ALIAS, providerSurfaceModule,
 *   providerActionsModule, NEXT_PUBLIC_AUTH_PROVIDER
 *
 * WHAT:  Resolves the `@providers-active` and `@providers-active-actions`
 *        specifiers to exactly one provider's UI module at build time.
 * WHY:   PROVIDER_ALIAS is the ONLY mechanism that actually keeps a
 *        non-selected provider out of the client bundle. A runtime branch
 *        cannot: Next's module graph is static, so every statically imported
 *        `'use client'` module gets a chunk whether or not the branch renders
 *        it — measured, both providers shipped. Aliasing means the other
 *        provider's modules never enter the graph at all.
 *        Better Auth is the only provider that ships in this codebase, so both
 *        aliases resolve to it unconditionally — the indirection is kept
 *        because it IS the swap seam: adding a provider is a new
 *        `active.<provider>.tsx` plus a branch on
 *        `process.env.NEXT_PUBLIC_AUTH_PROVIDER` here, with no app code
 *        touched. That env var is read by src/lib/adapters/provider.ts on the
 *        runtime side, so the bundle and the runtime always agree on which
 *        provider is live.
 * WHERE: Consumed by src/components/global/providers/server.tsx (surfaces) and
 *        src/lib/adapters/actions.client.ts (actions).
 */
const providerSurfaceModule = "./src/components/global/providers/active.better-auth.tsx"

/* Same mechanism for the two imperative client actions (switch organization,
 * sign out). Aliased rather than branched for the same measured reason. */
const providerActionsModule = "./src/components/global/providers/better-auth/actions.ts"

/**
 * SOURCE OF TRUTH KEYWORDS: typedRoutes, TYPED_ROUTE_GUARANTEE, nav.href,
 *   ROUTE_AUTHORIZATION
 *
 * WHAT:  Makes every route string in the app a checked type rather than free
 *        text.
 * WHY:   TYPED_ROUTE_GUARANTEE. The registry's `nav.href` is not only a link —
 *        the dashboard layout matches the current pathname against it to decide
 *        ROUTE_AUTHORIZATION. An href pointing at a page that does not exist
 *        therefore fails twice: the sidebar link 404s, AND the gate silently
 *        matches nothing, leaving that page ungated. Audit Logs shipped that
 *        way. A typo cannot announce itself at runtime, so it has to fail at
 *        compile time.
 * WHERE: Enforced by `Route` on ResourceNav['href'] in src/lib/resources.ts and
 *        on ROUTES in src/lib/config; checked by `tsc --noEmit`.
 */
const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    resolveAlias: {
      "@providers-active": providerSurfaceModule,
      "@providers-active-actions": providerActionsModule,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@providers-active": path.resolve(process.cwd(), providerSurfaceModule),
      "@providers-active-actions": path.resolve(process.cwd(), providerActionsModule),
    };
    return config;
  },
  typedRoutes: true,
};

export default nextConfig;
