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
 * SOURCE OF TRUTH KEYWORDS: TeamInvitationEmail, TeamInvitationEmailProps
 *
 * WHAT:  React Email template inviting a user to join an organization.
 * WHY:   The invitation flow (invitation.create router) builds the accept link
 *        and sends this; Better Auth's own sendInvitationEmail hook is a no-op
 *        because we send manually with full control over the link/copy.
 * WHERE: Rendered by sendOrganizationInvitationEmail in
 *        src/services/email.service.ts.
 */

import * as React from 'react'
import { Text } from '@react-email/components'
import { BaseLayout, EmailButton, emailStyles } from '../base-layout'

export interface TeamInvitationEmailProps {
  inviterName: string
  organizationName: string
  invitationLink: string
  role?: string
}

export function TeamInvitationEmail({
  inviterName,
  organizationName,
  invitationLink,
  role,
}: TeamInvitationEmailProps) {
  return (
    <BaseLayout preview={`You've been invited to join ${organizationName}`}>
      <Text style={emailStyles.title}>Join {organizationName}</Text>
      <Text style={emailStyles.paragraph}>
        {inviterName} invited you to join <strong>{organizationName}</strong>
        {role ? (
          <>
            {' '}
            as <strong>{role}</strong>
          </>
        ) : null}
        . Accept the invitation to get started.
      </Text>
      <EmailButton href={invitationLink}>Accept invitation</EmailButton>
      <Text style={emailStyles.note}>
        Or paste this link into your browser: {invitationLink}
      </Text>
    </BaseLayout>
  )
}

export default TeamInvitationEmail
