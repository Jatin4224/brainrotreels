/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: RenderFailedEmail, RenderFailedEmailProps,
 *   REFUND_IS_THE_HEADLINE, NO_PROVIDER_DETAIL_IN_EMAIL
 *
 * WHAT:  React Email template telling someone a render failed and their
 *        credits are back.
 *
 * WHY:   REFUND_IS_THE_HEADLINE. The customer already knows it failed — they
 *        were watching — so the only NEW information this email carries is that
 *        they have not been charged. That goes in the first line and in the
 *        subject, because an email about a failure that does not mention the
 *        money is the one that generates a support ticket.
 *
 *        NO_PROVIDER_DETAIL_IN_EMAIL. `reason` is the plain sentence the
 *        pipeline already built (FAILURE_IS_EXPLAINED_NOT_DUMPED), never a
 *        provider message or a stack. An email is forwarded, pasted into
 *        chats and kept forever, so it is the worst possible place for a
 *        detail that names our vendors or our internals.
 *
 *        It links to the PROJECT rather than offering a retry link, because a
 *        retry costs credits and a one-click spend from an email is not a
 *        decision somebody should make without seeing the current state.
 * WHERE: Rendered by sendRenderFailedEmail in src/services/email.service.ts.
 */

import * as React from "react";
import { Text } from "@react-email/components";
import { BaseLayout, EmailButton, emailStyles } from "../base-layout";

export interface RenderFailedEmailProps {
  projectTitle: string;
  projectLink: string;
  /** The plain-language cause. Never a provider message. */
  reason: string;
  /** Omitted when nothing was held — then the email says so instead. */
  refundedCredits?: number;
  recipientName?: string;
}

export function RenderFailedEmail({
  projectTitle,
  projectLink,
  reason,
  refundedCredits,
  recipientName,
}: RenderFailedEmailProps) {
  return (
    <BaseLayout preview={`${projectTitle} could not be rendered`}>
      <Text style={emailStyles.title}>That render did not finish</Text>

      <Text style={emailStyles.paragraph}>
        {recipientName ? `${recipientName}, ` : ""}
        <strong>{projectTitle}</strong> could not be rendered.{" "}
        {/* REFUND_IS_THE_HEADLINE — first paragraph, every time. */}
        {refundedCredits !== undefined && refundedCredits > 0
          ? `The ${refundedCredits} credits that were held for it have been returned to your balance.`
          : "No credits were charged."}
      </Text>

      <Text style={emailStyles.paragraph}>{reason}</Text>

      <EmailButton href={projectLink}>Open the project</EmailButton>

      <Text style={emailStyles.note}>
        Or paste this link into your browser: {projectLink}
      </Text>
    </BaseLayout>
  );
}

export default RenderFailedEmail;
