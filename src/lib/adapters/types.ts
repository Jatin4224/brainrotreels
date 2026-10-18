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
 * SOURCE OF TRUTH KEYWORDS: AuthProviderId, AUTH_PROVIDER_IDS, AdapterUser,
 *   AdapterSession, AdapterOrganization, AdapterMembership, AdapterTier,
 *   IdentityAdapter, TenancyAdapter, EntitlementAdapter, AdapterCapabilities,
 *   AuthAdapter, AdapterInvitationResult, AdapterMemberRow,
 *   PROVIDER_NEUTRAL_CONTRACT
 *
 * WHAT:  The provider-neutral contract every auth/tenancy/billing provider must
 *        satisfy. Three narrow interfaces (identity, tenancy, entitlement) plus
 *        a declared capability map, and the normalized shapes they exchange.
 * WHY:   The app must never learn a provider's vocabulary. Better Auth calls the
 *        full-access role `owner`; a hosted provider will call it `admin` or
 *        something else again. Every one of those collapses into
 *        `AdapterMembership.hasFullAccess` here, so `protectedProcedure` and the
 *        UI ask ONE question and never branch on a provider. Adding a provider
 *        means writing a translator against this file — not editing the app.
 *        Capabilities are DECLARED rather than assumed so a provider that cannot
 *        do something (most hosted providers cannot do per-tenant dynamic roles)
 *        fails loudly at boot instead of shipping a button that silently does
 *        nothing.
 * WHERE: Implemented by src/lib/adapters/better-auth/*; resolved by
 *        src/lib/adapters/index.ts; consumed by src/trpc/init.ts,
 *        src/trpc/procedures/protected.ts and src/lib/feature-gate.ts. Plan
 *        keys come from src/lib/config/plans.ts.
 */

import type { PlanKey } from '@/lib/config/plans'

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_PROVIDER_IDS, AuthProviderId
 *
 * WHAT:  Every provider this codebase ships an adapter for.
 * WHY:   One tuple drives the type union, the runtime env guard, and the setup
 *        checklist copy — adding a provider is a one-line change TypeScript then
 *        enforces at every switch site: the adapter switch in ./index.ts, the
 *        capability map in ./capabilities.client.ts, and the alias branch in
 *        next.config.ts all fail to compile until the new id is handled.
 *        Better Auth ships alone today, so the union has one member — the tuple
 *        stays because it is what makes the second one a one-line change rather
 *        than a refactor.
 * WHERE: Read by src/lib/adapters/provider.ts and the env checklist.
 */
export const AUTH_PROVIDER_IDS = ['better-auth'] as const

export type AuthProviderId = (typeof AUTH_PROVIDER_IDS)[number]

/**
 * SOURCE OF TRUTH KEYWORDS: AdapterUser
 *
 * WHAT:  The minimum identity every provider can supply.
 * WHY:   Deliberately narrow. Anything richer (2FA state, external accounts) is
 *        provider-specific and belongs behind that provider's own UI, not in a
 *        shared contract that a future provider might not be able to fill.
 * WHERE: Carried on AdapterSession; surfaced to the app via the tRPC context.
 */
export interface AdapterUser {
  id: string
  email: string
  name: string
  image: string | null
  emailVerified: boolean
}

/**
 * SOURCE OF TRUTH KEYWORDS: AdapterSession
 *
 * WHAT:  A resolved signed-in session — the user plus the provider's notion of
 *        which organization is currently active.
 * WHY:   `activeOrganizationId` is nullable because a user can be signed in with
 *        no organization selected (Better Auth before setActive; a hosted
 *        provider before an org is chosen). The active-org resolver treats null
 *        as "fall back to first owned membership", so every provider lands on
 *        the same behavior.
 * WHERE: Returned by IdentityAdapter.getSession(); consumed by src/trpc/init.ts.
 */
export interface AdapterSession {
  user: AdapterUser
  activeOrganizationId: string | null
}

/**
 * SOURCE OF TRUTH KEYWORDS: AdapterOrganization
 *
 * WHAT:  The tenant record as the app needs it, independent of who stores it.
 * WHERE: Nested inside AdapterMembership.
 */
export interface AdapterOrganization {
  id: string
  name: string
  slug: string
  logo: string | null
}

/**
 * SOURCE OF TRUTH KEYWORDS: AdapterMembership, hasFullAccess
 *
 * WHAT:  One (user, organization) membership with the provider's role string AND
 *        the normalized `hasFullAccess` flag.
 * WHY:   `hasFullAccess` is THE normalization that makes providers swappable.
 *        Better Auth fills it from `role === 'owner'`; a hosted provider would
 *        fill it from whatever it calls that role. The app never compares role
 *        strings again — doing so would re-couple it to one provider's
 *        vocabulary and is exactly the bug this contract exists to prevent.
 *        `role` survives for DISPLAY and for looking the role up in the
 *        app-owned permission table.
 * WHERE: Returned by TenancyAdapter.getMemberships(); consumed by
 *        src/trpc/init.ts and src/trpc/procedures/protected.ts.
 */
export interface AdapterMembership {
  organizationId: string
  organization: AdapterOrganization
  /** Provider-native role string — display + permission lookup only. */
  role: string
  /** Normalized full-access flag. NEVER compare `role` in app code. */
  hasFullAccess: boolean
  createdAt: Date
}

/**
 * SOURCE OF TRUTH KEYWORDS: AdapterTier
 *
 * WHAT:  An organization's resolved plan plus the trial flag and a provider-
 *        agnostic subscription summary.
 * WHY:   `tier` is a PlanKey so the RESOURCES perPlan tables keep working
 *        untouched no matter who sold the plan. `subscriptionId` is deliberately
 *        provider-neutral — it is a Stripe subscription id under Better Auth and
 *        whatever the next billing provider issues under that one. Naming it
 *        `stripeSubscriptionId` would leak one vendor into a shared type.
 * WHERE: Returned by EntitlementAdapter.getTier(); consumed by
 *        src/lib/feature-gate.ts.
 */
export interface AdapterTier {
  tier: PlanKey
  planName: string
  isOnTrial: boolean
  subscription: {
    id: string
    status: string
    periodEnd: Date | null
    cancelAtPeriodEnd: boolean
    subscriptionId: string | null
  } | null
}

/**
 * SOURCE OF TRUTH KEYWORDS: IdentityAdapter
 *
 * WHAT:  Who is calling. One method.
 * WHY:   Kept to a single method on purpose — sign-in/sign-up/sign-out are UI
 *        flows owned by each provider's own screens, not server contracts. The
 *        server only ever needs "resolve the current session".
 * WHERE: Implemented per provider; called by src/trpc/init.ts and layouts.
 */
export interface IdentityAdapter {
  /** Resolve the current request's session, or null when signed out. */
  getSession(): Promise<AdapterSession | null>
}

/**
 * SOURCE OF TRUTH KEYWORDS: AdapterMemberRow, PROVIDER_NEUTRAL_MEMBERSHIP,
 *   COPYABLE_INVITE_LINK, invitationLink
 *
 * WHAT:  One row of an organization's roster — an accepted member or a pending
 *        invitation — in the shape the app's Teams UI already consumes.
 * WHY:   PROVIDER_NEUTRAL_MEMBERSHIP. The Teams screen is the app's own design
 *        and must NOT be rebuilt per provider. Normalising the roster here means
 *        member.list returns the same payload whichever provider stores the
 *        membership, so a single set of components renders both. `role` is the
 *        APP's role name, which is what the permission map is keyed by.
 * WHERE: Returned by TenancyAdapter.listMembers; consumed by
 *        src/trpc/routers/member.ts.
 */
export interface AdapterMemberRow {
  /** Member id, or the invitation id for a pending row. */
  id: string
  /** Null for a pending invitation — nobody has accepted it yet. */
  userId: string | null
  name: string
  email: string
  image: string | null
  role: string
  isPending: boolean
  invitationId: string | null
  /**
   * COPYABLE_INVITE_LINK. The accept URL for a pending row, or null — for an
   * accepted member, and for a provider that owns invitations and therefore
   * hosts no app URL to hand out. Same nullability contract, and the same
   * reason, as AdapterInvitationResult.invitationLink: the roster is the only
   * place a link for an ALREADY-ISSUED invitation can be read, since invite and
   * resend only return one at the moment they run.
   */
  invitationLink: string | null
}

/**
 * SOURCE OF TRUTH KEYWORDS: AdapterInvitationResult
 *
 * WHAT:  The outcome of issuing or re-issuing an invitation.
 * WHY:   `invitationLink` is null when the PROVIDER sends the email, and a
 *        copyable URL when the app does (Better Auth). Modelling it as
 *        nullable rather than assuming a link keeps the invite sheet honest —
 *        it simply omits the copy-link affordance when there is nothing to copy.
 * WHERE: Returned by TenancyAdapter.inviteMember / resendInvitation.
 */
export interface AdapterInvitationResult {
  invitationId: string
  invitationLink: string | null
}

/**
 * SOURCE OF TRUTH KEYWORDS: TenancyAdapter
 *
 * WHAT:  Which organizations a user belongs to, and what a role grants there.
 * WHY:   `getMemberships` is provider-owned (Better Auth's Member table; a
 *        hosted provider's own membership records). `resolvePermissions` is
 *        APP-owned under every provider — it reads the OrganizationRole table
 *        this codebase controls, because hosted providers do not offer
 *        per-tenant runtime roles at the scale a multi-tenant SaaS needs (they
 *        typically cap custom roles per instance, not per tenant).
 *        Keeping it on the tenancy interface — rather than hard-wiring it — lets
 *        a future provider that CAN do this take it over without touching callers.
 * WHERE: Implemented per provider; called by src/trpc/init.ts.
 */
export interface TenancyAdapter {
  /** Every organization membership for a user, newest first. */
  getMemberships(userId: string): Promise<AdapterMembership[]>
  /**
   * Flatten a role into `resource:action` permission strings for one org.
   * Full-access members short-circuit before this is ever called.
   */
  resolvePermissions(organizationId: string, role: string): Promise<string[]>

  /**
   * The organization's roster — accepted members first, then pending invites.
   * PROVIDER_NEUTRAL_MEMBERSHIP: exists so the Teams UI is written once.
   */
  listMembers(organizationId: string): Promise<AdapterMemberRow[]>
  /**
   * Invite by email. `role` is the APP's role name. The provider that OWNS
   * invitations also sends the email, so `invitationLink` is null there — the
   * app has no accept URL to offer. Better Auth returns its own link so the
   * inviter can copy it.
   */
  inviteMember(params: {
    organizationId: string
    email: string
    role: string
    inviterUserId: string
    inviterName: string
    organizationName: string
  }): Promise<AdapterInvitationResult>
  /** Withdraw a pending invitation. */
  cancelInvitation(params: { organizationId: string; invitationId: string }): Promise<void>
  /**
   * Re-issue a pending invitation. Returns the invitation id, which MAY differ
   * from the original: a provider with no resend endpoint has to revoke and
   * re-create.
   */
  resendInvitation(params: {
    organizationId: string
    invitationId: string
    inviterUserId: string
    inviterName: string
    organizationName: string
  }): Promise<AdapterInvitationResult>
  /** Change an accepted member's role. `memberId` is the row id from listMembers. */
  updateMemberRole(params: {
    organizationId: string
    memberId: string
    role: string
  }): Promise<void>
  /** Remove an accepted member from the organization. */
  removeMember(params: { organizationId: string; memberId: string }): Promise<void>

  /** Rename / re-logo the organization. */
  updateOrganization(params: {
    organizationId: string
    name: string
    logo?: string | null
  }): Promise<void>
  /** Delete the organization and everything scoped to it. */
  deleteOrganization(params: { organizationId: string }): Promise<void>
  /** The caller leaves the organization (without deleting it). */
  leaveOrganization(params: { organizationId: string; userId: string }): Promise<void>
}

/**
 * SOURCE OF TRUTH KEYWORDS: EntitlementAdapter
 *
 * WHAT:  What plan an organization is on right now.
 * WHY:   This is the ENTIRE billing seam. Limits, flags, usage counters, the
 *        upgrade modal and <FeatureGate> all read RESOURCES — they only need the
 *        PlanKey to index the perPlan tables. Swapping Stripe for Polar, Lemon Squeezy, or a
 *        provider's own billing product is implementing this one method.
 *        Takes an organizationId rather than reading a session so webhooks and
 *        background jobs can resolve a tier with no request context.
 * WHERE: Implemented per provider; called by src/lib/feature-gate.ts.
 */
export interface EntitlementAdapter {
  getTier(organizationId: string): Promise<AdapterTier>
}

/**
 * SOURCE OF TRUTH KEYWORDS: AdapterCapabilities
 *
 * WHAT:  What the selected provider can actually do, declared rather than assumed.
 * WHY:   Providers are NOT feature-equivalent and pretending otherwise ships
 *        dead buttons — a provider with many equal admins and no
 *        single-owner concept cannot support ownership transfer at all.
 *        Deliberately SMALL: this holds only differences the app actually
 *        branches on. An earlier version also declared which hosted UI each
 *        provider ships (hostedAuthUI, hostedOrgSwitcher, …), but the
 *        @providers-active alias already answers that — the resolved module IS
 *        the provider's UI, so nothing ever asked. Flags nobody reads are just
 *        config that rots. Add one back when it has a consumer, not before.
 * WHERE: Declared on AuthAdapter; read by the UI wrappers, the settings screens,
 *        and assertProviderCapability in src/lib/adapters/provider.ts.
 */
export interface AdapterCapabilities {
  /** A single transferable owner, vs. many equal admins. */
  ownershipTransfer: boolean
  /** Invitations are sent AND accepted by the provider rather than this app. */
  providerInvitations: boolean
  /**
   * Organizations are created by THIS APP writing its own tables (Better Auth),
   * rather than by the provider. False means the app must never create an org
   * locally: the tenancy adapter reads membership from the provider, so
   * a locally-created org would be invisible and the user would loop forever in
   * onboarding.
   */
  appManagedOrganizations: boolean
}


/**
 * SOURCE OF TRUTH KEYWORDS: AuthAdapter, PROVIDER_NEUTRAL_CONTRACT
 *
 * WHAT:  One provider's complete implementation — the three interfaces plus its
 *        declared capabilities and its own id.
 * WHY:   Bundling them means exactly one object is resolved per request and there
 *        is no way to load identity from one provider and tenancy from another.
 *        That mixing is what the isolation rules exist to prevent.
 * WHERE: Returned by getAuthAdapter() in src/lib/adapters/index.ts.
 */
export interface AuthAdapter {
  id: AuthProviderId
  capabilities: AdapterCapabilities
  identity: IdentityAdapter
  tenancy: TenancyAdapter
  entitlement: EntitlementAdapter
}
