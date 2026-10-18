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
 * SOURCE OF TRUTH KEYWORDS: SignUpPage
 *
 * WHAT:  /sign-up route — renders AuthShell + AuthForm in sign-up mode.
 *        Hidden behind the proxy.ts redirect when REGISTRATION_OPEN=false,
 *        so reaching this file implies registration is open.
 * WHY:   Mirrors sign-in/page.tsx; keeps every page in (auth) cookie-cutter.
 * WHERE: Bounced to /sign-in by src/proxy.ts when REGISTRATION_OPEN=false.
 */

import type { Metadata } from 'next'

import { AuthForm, AuthShell } from '@/components/global/auth'
import { resolveAuthCallback } from '@/lib/config'

export const metadata: Metadata = {
  title: 'Create account',
}

export default async function SignUpPage({
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
      <AuthForm mode="sign-up" {...(destination ? { callbackURL: destination } : {})} />
    </AuthShell>
  )
}
