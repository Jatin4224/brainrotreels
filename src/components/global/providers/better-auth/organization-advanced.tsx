/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: BetterAuthOrganizationAdvanced, PROVIDER_ONLY_SECTION
 *
 * WHAT:  Nothing. Better Auth has no organization features beyond what the app's
 *        own settings screen already covers.
 * WHY:   PROVIDER_ONLY_SECTION — the surface exists on both sides of the alias so
 *        the settings page can render it unconditionally instead of branching on
 *        the provider. Returning null is the honest answer here, and it keeps the
 *        page free of a capability check that would only ever have one consumer.
 * WHERE: Resolved through @providers-active by
 *        src/components/global/providers/server.tsx.
 */

export function BetterAuthOrganizationAdvanced() {
  return null;
}
