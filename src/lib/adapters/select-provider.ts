/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: createProviderSelector, ProviderSelector,
 *   PROVIDER_ISOLATION, assertActive, provider seam, SERVICE_PROVIDER_SELECTOR
 *
 * WHAT:  Builds the "which implementation is selected" half of a provider seam:
 *        a validated id, a type guard, and the runtime assert a provider module
 *        calls at import time.
 * WHY:   The app needs roughly nine of these seams (jobs, storage, llm, tts,
 *        stt, render, video, stock, moderation). The AUTH seam in
 *        ./provider.ts cannot be reused for them: `assertProviderActive` is
 *        hard-typed to `AuthProviderId`, `getAuthAdapter` returns an
 *        `AuthAdapter` with identity/tenancy/entitlement, and
 *        `AdapterCapabilities` is three auth booleans. Widening
 *        `AUTH_PROVIDER_IDS` to hold 'inngest' would demand an auth
 *        implementation from a job queue and break the exhaustive switch.
 *        So this copies the SHAPE — one env read, one validated id, a module
 *        -scope assert, a dynamic import at the call site — without sharing the
 *        auth machinery. The auth seam deliberately keeps its own copy: it is
 *        the only one that is also client-reachable, and rewiring working auth
 *        code to prove a point is not worth the risk.
 *        Takes the already-read `rawValue` rather than a key, matching
 *        LITERAL_ENV_READ in config/env.public.ts — a helper that reads
 *        `process.env[key]` is the bug that file exists to prevent.
 *        No `@providers-active` alias: that exists purely to keep a
 *        non-selected provider's CLIENT chunks out of the bundle, and none of
 *        these seams has a client half.
 * WHERE: Used by src/lib/adapters/<kind>/provider.ts for every non-auth seam.
 */

export interface ProviderSelector<TId extends string> {
  /** Every registered id for this seam. */
  readonly ids: readonly TId[];
  /** The selected id for this process. */
  readonly provider: TId;
  isId(value: string): value is TId;
  /**
   * Throws unless `id` is the selected provider. Called at module scope by
   * each implementation so a stray static import dies at boot with a precise
   * message instead of initialising a second SDK.
   */
  assertActive(id: TId): void;
}

export interface ProviderSelectorOptions<TId extends string> {
  /** Human name used in error messages, e.g. 'jobs'. */
  label: string;
  /** The env var's name — for error messages only; never read from here. */
  envVar: string;
  /** The value, read literally by the caller. */
  rawValue: string | undefined;
  ids: readonly TId[];
  fallback: TId;
}

export function createProviderSelector<TId extends string>(
  options: ProviderSelectorOptions<TId>,
): ProviderSelector<TId> {
  const { label, envVar, rawValue, ids, fallback } = options;

  const isId = (value: string): value is TId =>
    (ids as readonly string[]).includes(value);

  const resolve = (): TId => {
    if (rawValue === undefined || rawValue.trim().length === 0) return fallback;

    const normalized = rawValue.trim().toLowerCase();
    if (!isId(normalized)) {
      /* Fail loudly. A typo would otherwise fall back to a DIFFERENT provider
       * than the operator configured — the exact mixing this prevents. */
      throw new Error(
        `[adapters/${label}] ${envVar}="${rawValue}" is not a known provider. ` +
          `Expected one of: ${ids.join(", ")}.`,
      );
    }
    return normalized;
  };

  const provider = resolve();

  return {
    ids,
    provider,
    isId,
    assertActive(id: TId): void {
      if (provider !== id) {
        throw new Error(
          `[adapters/${label}] The "${id}" implementation was loaded while ` +
            `${envVar}="${provider}". Providers must never run side by side. ` +
            `Remove the import that pulled it in, or change the env var.`,
        );
      }
    },
  };
}
