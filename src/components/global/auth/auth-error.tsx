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
 * SOURCE OF TRUTH KEYWORDS: AuthError, AuthErrorProps, AUTH_SURFACE
 *
 * WHAT:  The error banner every auth screen shows when an attempt fails —
 *        renders nothing when there is no error.
 * WHY:   AUTH_SURFACE. This treatment was written inside the Better Auth form
 *        and then wanted again on the app-owned invitation screen. Copying the
 *        classes is how one of them quietly stops matching the other, so it
 *        lives here instead — provider-neutral, next to AuthShell, which is the
 *        folder that already owns the chrome shared by every auth route.
 *        `role="alert"` is part of the component rather than a caller's job:
 *        the message appears after a submit the user is waiting on, so a screen
 *        reader has to announce it, and an alert that depends on each call site
 *        remembering the attribute is one that eventually does not announce.
 *        Returning null on an empty message keeps callers free of the
 *        `{error ? <AuthError .../> : null}` wrapper they would otherwise all
 *        repeat.
 * WHERE: The Better Auth sign-in / sign-up forms and the accept-invitation
 *        screen. Imported BY PATH from the provider forms, never through
 *        ./index — that barrel re-exports the provider surfaces, so importing
 *        it from inside one would close an import cycle.
 */

export interface AuthErrorProps {
  /** The message, or null/empty to render nothing. */
  error: string | null | undefined
}

export function AuthError({ error }: AuthErrorProps) {
  if (!error) return null
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
    >
      {error}
    </div>
  )
}
