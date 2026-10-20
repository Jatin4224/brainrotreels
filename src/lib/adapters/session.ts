/*

 */

import "server-only";

/**
 * SOURCE OF TRUTH KEYWORDS: getServerSession, PROVIDER_NEUTRAL_SESSION
 *
 * WHAT:  The provider-neutral "who is signed in" read for server components,
 *        layouts, and route handlers.
 * WHY:   PROVIDER_NEUTRAL_SESSION — layouts previously imported Better Auth's
 *        getCachedSession directly, which hard-wired every auth gate in the app
 *        to one provider. Routing them through the adapter means a layout's
 *        redirect logic is written once and survives a provider switch.
 *        Request-scoped `cache()` keeps this to one provider round-trip per
 *        request no matter how many layouts and components ask.
 * WHERE: Used by src/app/(dashboard)/layout.tsx, the onboarding page, and the
 *        portal layout. Implementations live in
 *        src/lib/adapters/<provider>/index.ts.
 */

import { cache } from "react";

import { getAuthAdapter } from "./index";
import type { AdapterSession } from "./types";

/**
 * SOURCE OF TRUTH KEYWORDS: getServerSession
 *
 * WHAT:  The current request's session, or null when signed out.
 * WHERE: Server components, layouts, and route handlers.
 */
export const getServerSession = cache(
  async (): Promise<AdapterSession | null> => {
    const adapter = await getAuthAdapter();
    return adapter.identity.getSession();
  },
);
