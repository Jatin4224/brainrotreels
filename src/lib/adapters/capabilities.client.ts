/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: CLIENT_CAPABILITIES, getClientCapabilities,
 *   useProviderCapabilities, PROVIDER_CAPABILITY_UI
 *
 * WHAT:  The selected provider's capability map, readable from client
 *        components without importing any server-only adapter code.
 * WHY:   PROVIDER_CAPABILITY_UI — the UI must hide what the provider cannot do
 *        (a provider with many equal admins and no single transferable owner
 *        must not render the ownership card). The server adapter that owns the
 *        authoritative map lives behind `import 'server-only'`, so the client
 *        needs its own copy.
 *        The two are kept honest by BOTH deriving from the same
 *        AdapterCapabilities type: adding a capability fails to compile until
 *        every provider is listed in both places.
 *        This is a UI concern ONLY. Nothing here is a security boundary —
 *        hiding a control never authorizes anything, and every real check still
 *        happens server-side in protectedProcedure and the routers.
 * WHERE: Consumed by client components deciding which controls to render.
 *        Server-side truth lives in src/lib/adapters/<provider>/index.ts.
 */

import { AUTH_PROVIDER } from "./provider";
import type { AdapterCapabilities, AuthProviderId } from "./types";

/**
 * SOURCE OF TRUTH KEYWORDS: CLIENT_CAPABILITIES
 *
 * WHAT:  Capability map per provider, mirroring the server adapters.
 * WHY:   Typed as a full Record over AuthProviderId so a new provider cannot be
 *        added without declaring what its UI supports.
 * WHERE: Read by getClientCapabilities below.
 */
const CLIENT_CAPABILITIES: Record<AuthProviderId, AdapterCapabilities> = {
  "better-auth": {
    ownershipTransfer: true,
    providerInvitations: false,
    appManagedOrganizations: true,
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: getClientCapabilities
 *
 * WHAT:  The active provider's capability map.
 * WHERE: Called by client components and by useProviderCapabilities.
 */
export function getClientCapabilities(): AdapterCapabilities {
  return CLIENT_CAPABILITIES[AUTH_PROVIDER];
}

/**
 * SOURCE OF TRUTH KEYWORDS: useProviderCapabilities
 *
 * WHAT:  Hook form of getClientCapabilities.
 * WHY:   The value is a build-time constant, so there is no state or fetch —
 *        the hook exists only so component code reads consistently alongside
 *        the app's other hooks.
 * WHERE: Client components gating provider-dependent controls.
 */
export function useProviderCapabilities(): AdapterCapabilities {
  return getClientCapabilities();
}
