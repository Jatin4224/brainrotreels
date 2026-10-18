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
 * SOURCE OF TRUTH KEYWORDS: ResetPasswordPage
 *
 * WHAT:  /reset-password route — set a new password from the email link's token.
 * WHY:   The form reads `?token=` via useSearchParams, so it's wrapped in a
 *        Suspense boundary (Next.js requirement for static-generation compat).
 * WHERE: AUTH_ROUTES.resetPassword; the reset-link email lands here.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'

import { AuthShell, ResetPasswordForm } from '@/components/global/auth'

export const metadata: Metadata = {
  title: 'Reset password',
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  )
}
