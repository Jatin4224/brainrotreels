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
 * SOURCE OF TRUTH KEYWORDS: AUTH_PROVIDER, DEFAULT_AUTH_PROVIDER, isAuthProviderId,
 *   assertProviderActive, PROVIDER_ISOLATION
 *
 * WHAT:  Reads NEXT_PUBLIC_AUTH_PROVIDER once and exposes the selected provider
 *        id plus the guards every provider-specific module uses to refuse to run
 *        when it is not the selected one.
 * WHY:   PROVIDER_ISOLATION — the app must never have two providers live at the
 *        same time. Three independent layers enforce that, and this file is the
 *        first: (1) this module is the ONLY reader of the env var, so there is
 *        one answer for the whole process; (2) src/lib/adapters/index.ts reaches
 *        the chosen implementation through a dynamic `import()`, so the other
 *        provider's module is never evaluated and its SDK never initialises;
 *        (3) eslint `no-restricted-imports` forbids importing a provider SDK
 *        outside its own adapter folder, so a future edit cannot quietly
 *        reintroduce the coupling. `assertProviderActive` is the runtime
 *        backstop for (2): if a provider module is ever loaded under the wrong
 *        env it throws immediately rather than silently reading or writing data
 *        into a provider the operator did not select.
 *        The var is NEXT_PUBLIC_ because the client wrappers must pick the same
 *        provider as the server; the provider id is a routing decision, never a
 *        secret.
 * WHERE: Read by src/lib/adapters/index.ts, both provider bundles, the client
 *        component wrappers, and src/lib/config/required-env.ts.
 *        Contract lives in src/lib/adapters/types.ts.
 */

import { AUTH_PROVIDER_IDS, type AuthProviderId } from './types'

/**
 * SOURCE OF TRUTH KEYWORDS: DEFAULT_AUTH_PROVIDER
 *
 * WHAT:  The provider used when NEXT_PUBLIC_AUTH_PROVIDER is unset.
 * WHY:   Better Auth is the open-source default so a fresh clone runs with no
 *        third-party account and no extra env — the template's whole premise.
 * WHERE: Fallback inside resolveAuthProvider below.
 */
export const DEFAULT_AUTH_PROVIDER: AuthProviderId = 'better-auth'

/**
 * SOURCE OF TRUTH KEYWORDS: isAuthProviderId
 *
 * WHAT:  Type guard narrowing an arbitrary string to AuthProviderId.
 * WHERE: Used by resolveAuthProvider and the env checklist.
 */
export function isAuthProviderId(value: string): value is AuthProviderId {
  return (AUTH_PROVIDER_IDS as readonly string[]).includes(value)
}

/* Read once at module load. `NEXT_PUBLIC_` vars are inlined at build time, so
 * this is a literal in the client bundle and a normal env read on the server —
 * both resolve to the same value, which is what keeps the two halves of the app
 * on one provider. */
function resolveAuthProvider(): AuthProviderId {
  const raw = process.env['NEXT_PUBLIC_AUTH_PROVIDER']
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_AUTH_PROVIDER

  const normalized = raw.trim().toLowerCase()
  if (!isAuthProviderId(normalized)) {
    /* Fail loudly: a typo here would silently fall back to a DIFFERENT provider
     * than the operator configured — the exact cross-provider mixing this
     * module exists to prevent. */
    throw new Error(
      `[adapters] NEXT_PUBLIC_AUTH_PROVIDER="${raw}" is not a known provider. ` +
        `Expected one of: ${AUTH_PROVIDER_IDS.join(', ')}.`
    )
  }
  return normalized
}

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_PROVIDER
 *
 * WHAT:  The single selected provider id for this process/bundle.
 * WHY:   One read point. Every other module asks this instead of touching
 *        process.env, so there is no way for two call sites to disagree.
 * WHERE: Imported anywhere a provider branch is needed — server and client.
 */
export const AUTH_PROVIDER: AuthProviderId = resolveAuthProvider()

/**
 * SOURCE OF TRUTH KEYWORDS: assertProviderActive, PROVIDER_ISOLATION
 *
 * WHAT:  Throws unless `provider` is the selected one.
 * WHY:   The runtime backstop of PROVIDER_ISOLATION. Every provider-specific
 *        module calls this at import time, so if a stray static import ever
 *        pulls the wrong provider into the graph, the process dies at boot with
 *        a precise message instead of quietly initialising a second SDK and
 *        leaking tenant data into a service the operator never chose.
 * WHERE: Called at module scope by src/lib/adapters/<provider>/index.ts, and by
 *        any module that talks to a provider SDK directly.
 */
export function assertProviderActive(provider: AuthProviderId): void {
  if (AUTH_PROVIDER !== provider) {
    throw new Error(
      `[adapters] The "${provider}" adapter was loaded while ` +
        `NEXT_PUBLIC_AUTH_PROVIDER="${AUTH_PROVIDER}". Providers must never run ` +
        `side by side. Remove the import that pulled it in, or change the env var.`
    )
  }
}
