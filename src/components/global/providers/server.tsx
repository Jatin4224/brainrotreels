/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: OrgSwitcher, UserMenu, AuthScreen, MemberManagement,
 *   BillingScreen, Onboarding, ForgotPasswordScreen, ResetPasswordScreen,
 *   AuthBoundary, PROVIDER_SURFACE, PROVIDER_ISOLATION, SERVER_PROVIDER_BRANCH
 *
 * WHAT:  The provider-aware UI surfaces, branched in a SERVER component.
 * WHY:   SERVER_PROVIDER_BRANCH — this file has no `'use client'` directive, so
 *        the branch runs during server rendering. React only serialises a client
 *        reference for the component actually returned, which means the
 *        unselected provider's UI never enters the browser bundle AT ALL.
 *        The earlier client-side barrel could not achieve that: a `'use client'`
 *        module imports every provider into the client graph and relies on the
 *        bundler constant-folding the dead ones away, which it only did
 *        partially — the unselected provider's symbols survived in the build.
 *        This also removes the last lazy boundary from the app shell — the
 *        chosen surface is part of the server-rendered HTML with no chunk to
 *        fetch, which is the behaviour the rest of this template already has.
 *        Surfaces take NO props on purpose: each resolves its own organization,
 *        so a server parent can render one and pass it to a client component as
 *        children without threading tenant state through the tree.
 * WHERE: Imported by server components — the root layout, the (auth) routes, the
 *        onboarding page, the dashboard/portal layouts, and the Teams and
 *        Billing pages. Client components receive these as props/children.
 */

import type * as React from "react";
import type { Route } from "next";

import type { AuthFormMode } from "@/lib/types";

import {
  ActiveAuthBoundary,
  ActiveAuthScreen,
  ActiveBillingScreen,
  ActiveForgotPasswordScreen,
  ActiveMemberManagement,
  ActiveOnboarding,
  ActiveOrganizationAdvanced,
  ActiveOrgSwitcher,
  ActiveResetPasswordScreen,
  ActiveUserMenu,
} from "@providers-active";

/**
 * SOURCE OF TRUTH KEYWORDS: AuthBoundary
 *
 * WHAT:  Root provider context for the selected provider, or a passthrough.
 * WHY:   Server-branched so a provider's own context component is only
 *        serialised into a deployment that selected it. Renders no wrapper
 *        element — this sits directly inside <body>, where an extra div would
 *        break the flex-column page layout.
 * WHERE: Mounted by src/app/layout.tsx around TRPCReactProvider.
 */
export function AuthBoundary({ children }: { children: React.ReactNode }) {
  return <ActiveAuthBoundary>{children}</ActiveAuthBoundary>;
}

/** Sidebar-header organization switcher. */
export function OrgSwitcher() {
  return <ActiveOrgSwitcher />;
}

/** Sidebar-footer account menu. */
export function UserMenu() {
  return <ActiveUserMenu />;
}

/**
 * SOURCE OF TRUTH KEYWORDS: AuthScreenProps, AuthScreen
 *
 * WHAT:  Props for the sign-in / sign-up surface.
 * WHY:   `callbackURL` defaults here rather than being forwarded as
 *        `Route | undefined`, because `exactOptionalPropertyTypes` makes an
 *        explicit undefined incompatible with an optional prop. Typed `Route`
 *        (TYPED_ROUTE_GUARANTEE) so a post-auth destination that does not exist
 *        fails at compile time instead of landing the user on a 404.
 * WHERE: Consumed by the (auth) route pages.
 */
export interface AuthScreenProps {
  mode: AuthFormMode;
  callbackURL?: Route;
}

/** Sign-in / sign-up surface. */
export function AuthScreen({ mode, callbackURL = "/" }: AuthScreenProps) {
  return <ActiveAuthScreen mode={mode} callbackURL={callbackURL} />;
}

/** Request-a-reset-link surface. A hosted provider folds this into sign-in. */
export function ForgotPasswordScreen() {
  return <ActiveForgotPasswordScreen />;
}

/** Set-a-new-password surface. A hosted provider folds this into sign-in. */
export function ResetPasswordScreen() {
  return <ActiveResetPasswordScreen />;
}

/** Team membership surface. */
export function MemberManagement() {
  return <ActiveMemberManagement />;
}

/** Billing settings surface. */
export function BillingScreen() {
  return <ActiveBillingScreen />;
}

/**
 * SOURCE OF TRUTH KEYWORDS: OrganizationAdvanced, PROVIDER_ONLY_SECTION
 *
 * WHAT:  The provider-only organization settings section, or nothing.
 * WHY:   PROVIDER_ONLY_SECTION — a hosted provider models things this app does
 *        not (verified domains, org-level SSO) and Better Auth has no
 *        equivalent. Rendering one clearly-labelled section keeps that
 *        difference visible instead of branching inside the shared settings
 *        screen. Better Auth renders null, so the page mounts this
 *        unconditionally with no capability check.
 * WHERE: Rendered at the bottom of the organization settings page.
 */
export function OrganizationAdvanced() {
  return <ActiveOrganizationAdvanced />;
}

/** Create-an-organization wizard. */
export function Onboarding() {
  return <ActiveOnboarding />;
}
