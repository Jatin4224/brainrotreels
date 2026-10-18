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
 * SOURCE OF TRUTH KEYWORDS: SignInPage
 *
 * WHAT:  /sign-in route — renders the shared AuthShell + AuthForm in
 *        sign-in mode. This is the route AUTH_ROUTES.signIn points at, and
 *        the destination AuthRedirectObserver pushes unauthenticated users to.
 * WHY:   Stays a thin shell so all auth UI logic lives in one global form
 *        component; mode swap is the only difference from /sign-up.
 * WHERE: Linked from AUTH_ROUTES.signIn (src/lib/config/auth-routes.ts);
 *        proxy.ts bounces /sign-up here when registration is closed.
 */

import type { Metadata } from 'next'

import { AuthForm, AuthShell } from '@/components/global/auth'
import { resolveAuthCallback } from '@/lib/config'

export const metadata: Metadata = {
  title: 'Sign in',
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string | string[] }>
}) {
  /* RETURN_TO_AFTER_AUTH: whoever sent the visitor here may have said where to
   * put them afterwards — an invitation link is the case that matters, since
   * dropping it strands an invitee on the dashboard with no idea they were
   * invited. resolveAuthCallback refuses anything that is not a site-relative
   * path (OPEN_REDIRECT_GUARD), and AuthScreen falls back to '/' on null. */
  const { callbackURL } = await searchParams
  const destination = resolveAuthCallback(callbackURL)

  return (
    <AuthShell>
      <AuthForm mode="sign-in" {...(destination ? { callbackURL: destination } : {})} />
    </AuthShell>
  )
}
