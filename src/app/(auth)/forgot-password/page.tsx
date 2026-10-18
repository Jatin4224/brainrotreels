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
 * SOURCE OF TRUTH KEYWORDS: ForgotPasswordPage
 *
 * WHAT:  /forgot-password route — request a password-reset email.
 * WHERE: AUTH_ROUTES.forgotPassword; linked from the sign-in form.
 */

import type { Metadata } from 'next'

import { AuthShell, ForgotPasswordForm } from '@/components/global/auth'

export const metadata: Metadata = {
  title: 'Forgot password',
}

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <ForgotPasswordForm />
    </AuthShell>
  )
}
