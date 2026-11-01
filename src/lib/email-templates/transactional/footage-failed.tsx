/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: FootageFailedEmail, FootageFailedEmailProps,
 *   REFUND_IS_THE_HEADLINE, THE_PROMPT_IS_THE_IDENTIFIER,
 *   NO_PROVIDER_DETAIL_IN_EMAIL, NO_ONE_CLICK_SPEND
 *
 * WHAT:  React Email template telling someone a clip they asked for could not
 *        be generated, and that the credits are back.
 *
 * WHY:   REFUND_IS_THE_HEADLINE, the same rule the render-failure email
 *        follows and for the same reason — the only genuinely NEW information
 *        in a failure email is that nobody was charged, so it goes in the
 *        first line and in the subject.
 *
 *        THE_PROMPT_IS_THE_IDENTIFIER. A clip has no title, so the prompt is
 *        the only thing that tells a person WHICH request this is about — and
 *        someone who queued several needs that. It is truncated by the sender
 *        rather than here, because a subject line and a paragraph have
 *        different budgets.
 *
 *        NO_PROVIDER_DETAIL_IN_EMAIL. `reason` is the plain sentence the
 *        workflow already wrote for the screen, never a provider message or a
 *        model's own error. An email is forwarded, pasted into chats and kept
 *        forever, which makes it the worst place for a detail naming our
 *        vendors.
 *
 *        NO_ONE_CLICK_SPEND: it links to the footage studio rather than
 *        offering a retry link. A regeneration costs credits, and a spend
 *        triggered from a mail client is not a decision somebody should make
 *        without seeing their balance first. Same reasoning as the render
 *        email's refusal to offer a retry.
 * WHERE: Rendered by sendFootageFailedEmail in src/services/email.service.ts.
 */

import * as React from "react";
import { Text } from "@react-email/components";
import { BaseLayout, EmailButton, emailStyles } from "../base-layout";

export interface FootageFailedEmailProps {
  /** The prompt, already truncated by the sender. */
  prompt: string;
  studioLink: string;
  /** The plain-language cause. Never a provider message. */
  reason: string;
  /** Omitted when nothing was held — then the email says so instead. */
  refundedCredits?: number;
  recipientName?: string;
}

export function FootageFailedEmail({
  prompt,
  studioLink,
  reason,
  refundedCredits,
  recipientName,
}: FootageFailedEmailProps) {
  return (
    <BaseLayout preview="That clip could not be generated">
      <Text style={emailStyles.title}>That clip did not come out</Text>

      <Text style={emailStyles.paragraph}>
        {recipientName ? `${recipientName}, ` : ""}the clip you asked for —{" "}
        <strong>{prompt}</strong> — could not be generated.{" "}
        {/* REFUND_IS_THE_HEADLINE — first paragraph, every time. */}
        {refundedCredits !== undefined && refundedCredits > 0
          ? `The ${refundedCredits} credits that were held for it have been returned to your balance.`
          : "No credits were charged."}
      </Text>

      <Text style={emailStyles.paragraph}>{reason}</Text>

      <EmailButton href={studioLink}>Open the footage studio</EmailButton>

      <Text style={emailStyles.note}>
        Or paste this link into your browser: {studioLink}
      </Text>
    </BaseLayout>
  );
}

export default FootageFailedEmail;
