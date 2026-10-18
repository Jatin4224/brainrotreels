/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: AcceptInvitation, SERVER_RESOLVED_VIEWER,
 *   RETURN_TO_AFTER_AUTH, authRouteWithCallback, viewerEmail, WRONG_ACCOUNT
 *
 * WHAT:  Client surface for /accept-invitation — shows who invited whom, and
 *        the one action that actually applies: accept, sign in, create an
 *        account, or switch account.
 * WHY:   Acceptance is a mutation behind a button (not a GET side effect), so a
 *        link prefetch can't silently join an org. The server mutation is the
 *        real authority on email-match/expiry; this just surfaces its errors.
 *        SERVER_RESOLVED_VIEWER: `viewerEmail` is a PROP, not a query. Asking
 *        an authProcedure "am I signed in?" made the global AuthRedirectObserver
 *        fire on the UNAUTHORIZED and replace this page with a bare /sign-in —
 *        the invitee never saw the invitation at all. The signed-out branch
 *        below only ever renders because nothing here throws UNAUTHORIZED.
 *        RETURN_TO_AFTER_AUTH: every route out of this page carries this page
 *        back as the callback, so authenticating RETURNS the invitee to the
 *        invitation instead of dropping them on the dashboard — or worse, in
 *        onboarding, being asked to create the organization they were invited
 *        to. An invitee usually has no account yet, so "Create account" is
 *        offered as prominently as sign-in.
 *        WRONG_ACCOUNT is caught before the click, not after: the server
 *        rejects a mismatched email, but that error arrives as a failed action
 *        the user cannot interpret. Comparing here says which account they are
 *        in and which one the invite needs.
 * WHERE: Rendered by src/app/(auth)/accept-invitation/page.tsx, which resolves
 *        viewerEmail from getServerSession. Calls trpc.invitation.get / .accept
 *        and the provider-neutral setActiveOrganization action.
 */

import * as React from 'react'
import { Loader2Icon, MailIcon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { setActiveOrganization } from '@/lib/adapters/actions.client'
import { AUTH_ROUTES, ROUTES, authRouteWithCallback } from '@/lib/config'
import { Button } from '@/components/ui/button'
/* By path, not through ./index: that barrel re-exports the auth SCREENS, and
 * pulling the whole provider surface in here just for a banner is backwards. */
import { AuthError } from '@/components/global/auth/auth-error'

export function AcceptInvitation({
  invitationId,
  viewerEmail,
}: {
  invitationId: string
  /** Signed-in viewer's address, or null when anonymous. Resolved server-side. */
  viewerEmail: string | null
}) {
  const [error, setError] = React.useState<string | null>(null)
  const [isAccepting, setIsAccepting] = React.useState(false)

  const signedIn = viewerEmail !== null

  /* This exact page, so authenticating comes back to the invitation rather than
   * to the dashboard. authRouteWithCallback encodes it, which is what keeps the
   * `?id=` from being read as a param of the AUTH route instead. */
  const returnHere = `/accept-invitation?id=${encodeURIComponent(invitationId)}`
  const signInHref = authRouteWithCallback(AUTH_ROUTES.signIn, returnHere)
  const signUpHref = authRouteWithCallback(AUTH_ROUTES.signUp, returnHere)

  const invitationQuery = trpc.invitation.get.useQuery({ invitationId })
  const acceptMutation = trpc.invitation.accept.useMutation()

  const invitation = invitationQuery.data
  /* Compared case-insensitively, exactly as the accept mutation does — a viewer
   * whose address differs only in case is the RIGHT account, not the wrong one. */
  const wrongAccount =
    viewerEmail !== null &&
    invitation !== undefined &&
    invitation !== null &&
    viewerEmail.toLowerCase() !== invitation.email.toLowerCase()

  async function handleAccept() {
    setError(null)
    setIsAccepting(true)
    try {
      const result = await acceptMutation.mutateAsync({ invitationId })
      await setActiveOrganization({
        organizationId: result.organizationId,
        organizationSlug: result.slug,
      })
      window.location.assign(ROUTES.dashboard)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invitation.')
      setIsAccepting(false)
    }
  }

  if (invitationQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!invitation || invitation.expired) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Invitation unavailable</h1>
        <p className="text-balance text-sm text-muted-foreground">
          This invitation is invalid or has expired. Ask the organization owner to send a new
          one.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Same heading rhythm as AuthHeading in the sign-in form, so arriving
          here and then signing in does not feel like two different products. */}
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Join {invitation.organizationName}</h1>
        <p className="text-balance text-sm text-muted-foreground">
          You have been invited to join as{' '}
          <span className="font-medium text-foreground">{invitation.role ?? 'member'}</span>.
        </p>
      </div>

      {/* The invited address is the thing the whole screen turns on — which
          account to use, and what the wrong-account message refers to — so it
          reads as a stated fact rather than a sentence in the body copy. */}
      <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
        <MailIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{invitation.email}</span>
      </div>

      <AuthError error={error} />

      <div className="flex flex-col gap-3">
        {!signedIn ? (
          <>
            <Button className="w-full" onClick={() => window.location.assign(signUpHref)}>
              Create account
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.location.assign(signInHref)}
            >
              I already have an account
            </Button>
            <p className="text-balance text-center text-xs text-muted-foreground">
              Use the address above — an invitation only accepts the account it was sent to.
            </p>
          </>
        ) : wrongAccount ? (
          /* WRONG_ACCOUNT: the server would refuse this, but only after a click
             that looks like it should have worked. Say so up front, and name
             both addresses so the fix is obvious. */
          <>
            <p className="text-balance text-center text-sm text-muted-foreground">
              You are signed in as <span className="font-medium text-foreground">{viewerEmail}</span>,
              which is not the invited address.
            </p>
            <Button className="w-full" onClick={() => window.location.assign(signInHref)}>
              Switch account
            </Button>
          </>
        ) : (
          <Button className="w-full" onClick={handleAccept} disabled={isAccepting}>
            {isAccepting ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                Accepting…
              </>
            ) : (
              'Accept invitation'
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
