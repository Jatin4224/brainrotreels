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
/**
 * SOURCE OF TRUTH KEYWORDS: remotePatterns, R2_PUBLIC_URL, PUBLIC_LIBRARY_IMAGES,
 *   SIGNED_URLS_ARE_NOT_OPTIMISED
 *
 * WHAT:  Allows `next/image` to load from the R2 public CDN origin.
 * WHY:   PUBLIC_LIBRARY_IMAGES. `next/image` refuses any remote host that is
 *        not listed here, so without this the first curated background
 *        thumbnail in Phase 11 fails to render with an error that names
 *        configuration rather than the image.
 *        SIGNED_URLS_ARE_NOT_OPTIMISED: this is only for the PUBLIC library
 *        objects. A tenant's own media is served through short-lived signed
 *        URLs with a query string, which are unique per request and therefore
 *        uncacheable — those render through a plain `<img>` (see
 *        SIGNED_THUMB_NOT_NEXT_IMAGE in the media table), and putting them
 *        through the optimiser would make the server re-fetch every thumbnail
 *        on every page view.
 *        Derived from R2_PUBLIC_URL rather than hardcoded, and omitted entirely
 *        when it is unset, because an empty hostname in `remotePatterns` is a
 *        build error — and a repo with no bucket connected must still build.
 * WHERE: Read by next/image at build and request time. The variable is
 *        documented in .env.example alongside the other R2_* values.
 */
const r2PublicHost = (() => {
  const raw = process.env["R2_PUBLIC_URL"]?.trim()
  if (!raw) return null
  try {
    return new URL(raw).hostname
  } catch {
    /* A malformed URL is the operator's typo, and failing the build over an
     * optional CDN origin would be worse than rendering no library images. */
    console.warn(`[next.config] R2_PUBLIC_URL="${raw}" is not a valid URL — ignoring it.`)
    return null
  }
})()

const nextConfig: NextConfig = {
  reactCompiler: true,
  ...(r2PublicHost !== null
    ? {
        images: {
          remotePatterns: [{ protocol: "https" as const, hostname: r2PublicHost }],
        },
      }
    : {}),
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
