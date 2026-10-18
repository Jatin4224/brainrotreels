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
 * SOURCE OF TRUTH KEYWORDS: AcceptInvitationPage, SERVER_RESOLVED_VIEWER,
 *   getServerSession, viewerEmail
 *
 * WHAT:  /accept-invitation route — renders the invitation accept surface
 *        inside the shared AuthShell. Reads the `id` query param.
 * WHY:   Only reachable under a provider whose invitations THIS APP owns. When
 *        the PROVIDER sends and accepts the invite, its own ticket link
 *        completes the join and this route would only ever show "invitation not
 *        found" — so it redirects to sign-in instead of showing a dead end.
 *        SERVER_RESOLVED_VIEWER: who is signed in is resolved HERE and passed
 *        down, never probed from the client. The client used to answer it by
 *        firing an authProcedure query and reading UNAUTHORIZED as "signed
 *        out" — but AuthRedirectObserver watches the same cache and bounced the
 *        visitor to a bare /sign-in before the page could render, so an invitee
 *        following their link saw a sign-in form with no mention of the
 *        invitation. An auth probe that MUST NOT trigger the global auth
 *        redirect cannot be a tRPC error; it has to be a server read.
 *        Resolving it here also removes a round trip and the loading flash.
 * WHERE: Linked from the invitation email; the client component
 *        (AcceptInvitation) drives the accept flow. Session comes from
 *        src/lib/adapters/session (PROVIDER_NEUTRAL_SESSION).
 */

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getAdapterCapabilities } from '@/lib/adapters'
import { getServerSession } from '@/lib/adapters/session'
import { AUTH_ROUTES } from '@/lib/config'
import { AuthShell } from '@/components/global/auth'
import { AcceptInvitation } from './_components/accept-invitation'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = {
  title: 'Accept invitation',
}

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const { id } = await searchParams

  /* PROVIDER_ISOLATION: a provider that owns invitations performs the join from
   * its own ticket link, so this route has nothing to accept. Send the visitor
   * somewhere useful rather than rendering an error about a local invitation
   * that never existed. */
  const capabilities = await getAdapterCapabilities()
  if (capabilities.providerInvitations) redirect(AUTH_ROUTES.signIn)

  const session = await getServerSession()

  return (
    <AuthShell>
      {id ? (
        <AcceptInvitation invitationId={id} viewerEmail={session?.user.email ?? null} />
      ) : (
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Invitation unavailable</CardTitle>
            <CardDescription>This link is missing its invitation reference.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </AuthShell>
  )
}
