/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: getAuthAdapter, getAdapterCapabilities,
 *   PROVIDER_ISOLATION, AuthAdapter
 *
 * WHAT:  Resolves the one AuthAdapter for the selected provider and re-exports
 *        the contract types. The single entry point the app uses to reach
 *        identity, tenancy, or entitlement.
 * WHY:   PROVIDER_ISOLATION layer 2 — a provider bundle is reached through a
 *        dynamic `import()` inside a branch, never a static import. That keeps
 *        every non-selected provider's module out of the evaluated graph
 *        entirely: its SDK never initialises, never reads its env, and never
 *        opens a connection. A static `import` of the bundles would defeat this
 *        no matter how the branch is written, which is why the eslint rule in
 *        eslint.config.mjs forbids it. The switch below has one case today —
 *        the dynamic form is what keeps adding the second one free of app
 *        changes.
 *        `import 'server-only'` because every implementation touches secrets
 *        (database URL, provider secret key) — this file must never reach a
 *        browser bundle.
 *        The resolved bundle is memoised per process: adapters are stateless
 *        service objects, so re-importing per request would only add overhead.
 * WHERE: Called by src/trpc/init.ts, src/lib/feature-gate.ts and server layouts.
 *        Contract in ./types.ts; provider selection in ./provider.ts.
 */

import { AUTH_PROVIDER, assertProviderActive } from './provider'
import type { AdapterCapabilities, AuthAdapter } from './types'

export type {
  AdapterCapabilities,
  AdapterInvitationResult,
  AdapterMemberRow,
  AdapterMembership,
  AdapterOrganization,
  AdapterSession,
  AdapterTier,
  AdapterUser,
  AuthAdapter,
  AuthProviderId,
  EntitlementAdapter,
  IdentityAdapter,
  TenancyAdapter,
} from './types'
export { AUTH_PROVIDER_IDS } from './types'
export { AUTH_PROVIDER, DEFAULT_AUTH_PROVIDER, isAuthProviderId } from './provider'

/* Memoised per process. Holds the in-flight promise (not just the result) so
 * concurrent first-requests share one import instead of racing. */
let adapterPromise: Promise<AuthAdapter> | null = null

async function loadAdapter(): Promise<AuthAdapter> {
  /* The switch is exhaustive over AuthProviderId — adding a provider to
   * AUTH_PROVIDER_IDS without a case here is a compile error at the
   * `never` branch below, so a provider can never be silently unreachable. */
  switch (AUTH_PROVIDER) {
    case 'better-auth': {
      const mod = await import('./better-auth')
      return mod.betterAuthAdapter
    }
    default: {
      const exhaustive: never = AUTH_PROVIDER
      throw new Error(`[adapters] No adapter registered for provider "${String(exhaustive)}".`)
    }
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: getAuthAdapter
 *
 * WHAT:  The selected provider's AuthAdapter.
 * WHY:   Async because the underlying import is dynamic — that dynamism IS the
 *        isolation guarantee, so it is deliberately not hidden behind a sync
 *        accessor.
 * WHERE: The only sanctioned way for app code to reach a provider.
 */
export async function getAuthAdapter(): Promise<AuthAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter().then((adapter) => {
      /* Belt-and-braces: the bundle asserts at its own module scope too, but
       * re-checking here catches a mis-registered switch case. */
      assertProviderActive(adapter.id)
      return adapter
    })
  }
  return adapterPromise
}

/**
 * SOURCE OF TRUTH KEYWORDS: getAdapterCapabilities
 *
 * WHAT:  What the selected provider can do.
 * WHERE: Read by server components deciding which UI surface to render.
 */
export async function getAdapterCapabilities(): Promise<AdapterCapabilities> {
  const adapter = await getAuthAdapter()
  return adapter.capabilities
}

