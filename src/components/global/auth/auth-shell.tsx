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
 * SOURCE OF TRUTH KEYWORDS: AuthShell, AuthShellProps, AUTH_SURFACE
 *
 * WHAT:  Centered full-viewport wrapper used by every (auth) route — logo +
 *        BRANDING.appName above an arbitrary child slot, on the open page
 *        background.
 * WHY:   Pulled out of the page files so future auth pages (forgot, reset,
 *        verify, 2fa) inherit the same chrome without duplicating layout
 *        markup, and so a branding redesign is a one-file change.
 *        AUTH_SURFACE: NO card, panel, or border — the auth screens sit
 *        directly on the page background, and this is the one file that decides
 *        that. They previously disagreed: sign-in, sign-up, forgot and reset
 *        were bare while accept-invitation drew its own <Card>, so the same
 *        flow changed shape halfway through. Owning the surface here is what
 *        keeps them identical; a form that reintroduces its own container is
 *        the bug this file exists to prevent.
 *        `max-w-md` over the original `max-w-sm`: at 24rem a two-field form
 *        plus a provider button reads as cramped, and the invitation screen —
 *        which carries an email address and three buttons — was visibly tight.
 *        Nothing else constrains the children, so a screen is free to be as
 *        tall as it needs.
 * WHERE: Used by the (auth) route group pages under src/app/(auth)/.
 */

import * as React from 'react'

import { PlatformLogo } from '@/components/global/platform-logo'

export interface AuthShellProps {
  children: React.ReactNode
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background p-6 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-8">
        <div className="self-center">
          <PlatformLogo href="/" />
        </div>
        {children}
      </div>
    </div>
  )
}
