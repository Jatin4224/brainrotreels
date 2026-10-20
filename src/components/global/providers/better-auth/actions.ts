/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: activeSetOrganization, PROVIDER_ALIAS
 *
 * WHAT:  Better Auth's client-side implementations of the neutral auth actions.
 * WHY:   Isolated here so the Better Auth browser client is only ever imported
 *        from a provider folder (PROVIDER_ISOLATION), and so the neutral module
 *        in src/lib/adapters/actions.client.ts stays free of any SDK.
 * WHERE: Resolved through the `@providers-active-actions` build-time alias by
 *        src/lib/adapters/actions.client.ts — see next.config.ts. Every
 *        provider's variant must export this identical shape, which is what
 *        makes the alias type-safe.
 */

import { authClient } from "@/lib/better-auth/auth-client";

export async function activeSetOrganization(params: {
  organizationId: string;
  organizationSlug?: string;
}): Promise<void> {
  await authClient.organization.setActive({
    organizationId: params.organizationId,
    ...(params.organizationSlug
      ? { organizationSlug: params.organizationSlug }
      : {}),
  });
}
