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
 * SOURCE OF TRUTH KEYWORDS: ACTIVE_PROVIDER_SURFACES, PROVIDER_ALIAS
 *
 * WHAT:  The Better Auth implementation of every provider-owned UI surface.
 * WHY:   PROVIDER_ALIAS — every `active.<provider>.tsx` has an IDENTICAL export
 *        shape, and next.config.ts aliases `./active` to exactly one of them at
 *        build time. That is what actually keeps the other provider out of the
 *        bundle: a runtime `if` cannot, because the module graph is static, so
 *        every statically imported `'use client'` module gets a chunk whether or
 *        not the branch ever renders it. Resolving the alias means the other
 *        provider's modules are never in the graph to begin with.
 * WHERE: Resolved through ./active by ./server.tsx. Never import this file
 *        directly — importing it by name defeats the alias.
 */

import type * as React from 'react'
import type { Route } from 'next'

import { TeamSwitcher } from './better-auth/org-switcher'
import { NavUser } from './better-auth/user-menu'
import { AuthForm } from './better-auth/auth-form'
import { ForgotPasswordForm } from './better-auth/forgot-password-form'
import { ResetPasswordForm } from './better-auth/reset-password-form'
import { BetterAuthMemberManagement } from './better-auth/member-management'
import { BetterAuthBillingScreen } from './better-auth/billing-screen'
import { BetterAuthOnboarding } from './better-auth/onboarding'
import { BetterAuthOrganizationAdvanced } from './better-auth/organization-advanced'
import type { AuthFormMode } from '@/lib/types'

/* Better Auth needs no React context of its own. */
export function ActiveAuthBoundary({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export const ActiveOrgSwitcher = TeamSwitcher
export const ActiveUserMenu = NavUser
export const ActiveMemberManagement = BetterAuthMemberManagement
export const ActiveBillingScreen = BetterAuthBillingScreen
export const ActiveOrganizationAdvanced = BetterAuthOrganizationAdvanced
export const ActiveOnboarding = BetterAuthOnboarding
export const ActiveForgotPasswordScreen = ForgotPasswordForm
export const ActiveResetPasswordScreen = ResetPasswordForm

export function ActiveAuthScreen({
  mode,
  callbackURL,
}: {
  mode: AuthFormMode
  callbackURL: Route
}) {
  return <AuthForm mode={mode} callbackURL={callbackURL} />
}
