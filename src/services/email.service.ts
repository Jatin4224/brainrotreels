/*

 */

import "server-only";

/**
 * SOURCE OF TRUTH KEYWORDS: sendVerificationEmail, sendPasswordResetEmail,
 *   sendOrganizationInvitationEmail, sendProjectReadyEmail,
 *   sendRenderFailedEmail, sendLowBalanceEmail, sendFootageFailedEmail,
 *   EmailSendResult, renderAndSend
 *
 * WHAT:  The single transactional-email abstraction — renders a React Email
 *        template to HTML and sends it through Resend.
 * WHY:   Services only do one job; this one owns "turn a template + props into
 *        a delivered email". It fail-soft no-ops when Resend isn't configured
 *        (warns + returns a skipped result) so local dev runs without a key —
 *        Better Auth additionally logs the verification/reset URL in that case.
 * WHERE: Called by src/lib/better-auth/auth.ts (verification + reset hooks) and
 *        by the invitation router (src/trpc/routers/invitation.ts). Renders
 *        templates from src/lib/email-templates; sends via Resend
 *        (src/lib/config/resend.ts).
 */

import * as React from "react";
import { render } from "@react-email/render";
import {
  getResendClient,
  RESEND_DEFAULT_FROM,
  isResendConfigured,
} from "@/lib/config/resend";
import {
  EmailVerificationEmail,
  FootageFailedEmail,
  LowBalanceEmail,
  PasswordResetEmail,
  ProjectReadyEmail,
  RenderFailedEmail,
  TeamInvitationEmail,
} from "@/lib/email-templates";
import { APP_URL } from "@/lib/config/branding";
import { recordDevEmail } from "@/lib/dev-email-outbox";

/**
 * SOURCE OF TRUTH KEYWORDS: EmailSendResult
 *
 * WHAT:  Uniform return shape for every send — success flag, optional message
 *        id, optional error, and a `skipped` flag when Resend is unconfigured.
 * WHY:   Callers can log/branch without try/catch; a skipped send is not an
 *        error (it's expected in local dev without a key).
 * WHERE: Returned by every sender below.
 */
export interface EmailSendResult {
  success: boolean;
  skipped: boolean;
  messageId?: string;
  error?: string;
}

const SKIPPED: EmailSendResult = { success: false, skipped: true };

/* Renders the template to HTML and sends via Resend. No-ops (warns) when the
 * API key is unset so the surrounding flow (sign-up, invite) still succeeds —
 * and records the action link to the dev outbox so the UI can surface it. */
async function renderAndSend(args: {
  to: string;
  subject: string;
  template: React.ReactElement;
  /* The primary action URL in the email (verification / reset / invite link).
   * Recorded to the dev outbox when the send is skipped for lack of an API key. */
  devLink?: string;
}): Promise<EmailSendResult> {
  if (!isResendConfigured()) {
    console.warn(
      `[email] RESEND_API_KEY not set — skipping "${args.subject}" to ${args.to}.`,
    );
    if (args.devLink) {
      recordDevEmail({
        to: args.to,
        subject: args.subject,
        link: args.devLink,
      });
    }
    return SKIPPED;
  }

  const client = getResendClient();
  if (!client) return SKIPPED;

  try {
    const html = await render(args.template);
    const { data, error } = await client.emails.send({
      from: RESEND_DEFAULT_FROM,
      to: args.to,
      subject: args.subject,
      html,
    });
    if (error) {
      console.error("[email] Resend send failed:", error);
      return { success: false, skipped: false, error: error.message };
    }
    return { success: true, skipped: false, messageId: data?.id };
  } catch (err) {
    console.error("[email] render/send threw:", err);
    return {
      success: false,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: sendVerificationEmail
 *
 * WHAT:  Sends the email-verification message with the Better Auth link.
 * WHERE: Called by emailVerification.sendVerificationEmail in auth.ts.
 */
export function sendVerificationEmail(args: {
  to: string;
  verificationLink: string;
}): Promise<EmailSendResult> {
  return renderAndSend({
    to: args.to,
    subject: "Verify your email",
    template: React.createElement(EmailVerificationEmail, {
      verificationLink: args.verificationLink,
    }),
    devLink: args.verificationLink,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: sendPasswordResetEmail
 *
 * WHAT:  Sends the password-reset message with the Better Auth link.
 * WHERE: Called by emailAndPassword.sendResetPassword in auth.ts.
 */
export function sendPasswordResetEmail(args: {
  to: string;
  resetLink: string;
}): Promise<EmailSendResult> {
  return renderAndSend({
    to: args.to,
    subject: "Reset your password",
    template: React.createElement(PasswordResetEmail, {
      resetLink: args.resetLink,
    }),
    devLink: args.resetLink,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: sendProjectReadyEmail, LINK_GOES_TO_THE_PREVIEW,
 *   LINK_IS_BUILT_HERE
 *
 * WHAT:  Sends the "your video is ready" message.
 * WHY:   LINK_IS_BUILT_HERE, from `APP_URL` and the project id, rather than
 *        being passed in. Every other sender takes a link because the link is
 *        a CREDENTIAL somebody else minted — a verification token, an invite
 *        token. This one is just a route, and asking a workflow to assemble a
 *        URL would put the app's own path shape inside a background job.
 *
 *        No `devLink`. The dev outbox exists so a developer with no Resend key
 *        can still complete an auth flow that is BLOCKED without the email;
 *        this message is a convenience, and the video is sitting on the
 *        project screen either way.
 * WHERE: The `notify` step of src/inngest/functions/project-generate.ts.
 */
export function sendProjectReadyEmail(args: {
  to: string;
  projectId: string;
  projectTitle: string;
  recipientName?: string | null;
}): Promise<EmailSendResult> {
  return renderAndSend({
    to: args.to,
    subject: `${args.projectTitle} is ready to watch`,
    template: React.createElement(ProjectReadyEmail, {
      projectTitle: args.projectTitle,
      previewLink: `${APP_URL}/dashboard/projects/${args.projectId}/preview`,
      ...(args.recipientName ? { recipientName: args.recipientName } : {}),
    }),
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: sendRenderFailedEmail, REFUND_IS_THE_HEADLINE
 *
 * WHAT:  Sends the "that render did not finish" message.
 * WHY:   `reason` is REQUIRED and is expected to be the plain sentence the
 *        pipeline already built — there is no optional fallback, so a caller
 *        cannot send this email without having decided what to tell the
 *        customer. A generic "something went wrong" email is worse than none.
 *
 *        `refundedCredits` is optional because the two cases differ in the
 *        copy: credits returned, or nothing charged at all. Passing `0` and
 *        passing nothing therefore mean the same thing to the template, which
 *        is handled there rather than here.
 * WHERE: The render workflow's failure path.
 */
export function sendRenderFailedEmail(args: {
  to: string;
  projectId: string;
  projectTitle: string;
  reason: string;
  refundedCredits?: number;
  recipientName?: string | null;
}): Promise<EmailSendResult> {
  return renderAndSend({
    to: args.to,
    /* The refund in the SUBJECT, not just the body — most people decide
     * whether to worry from the subject line alone. */
    subject:
      args.refundedCredits !== undefined && args.refundedCredits > 0
        ? `${args.projectTitle} could not be rendered — credits refunded`
        : `${args.projectTitle} could not be rendered`,
    template: React.createElement(RenderFailedEmail, {
      projectTitle: args.projectTitle,
      projectLink: `${APP_URL}/dashboard/projects/${args.projectId}/preview`,
      reason: args.reason,
      ...(args.refundedCredits !== undefined
        ? { refundedCredits: args.refundedCredits }
        : {}),
      ...(args.recipientName ? { recipientName: args.recipientName } : {}),
    }),
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: sendFootageFailedEmail, FOOTAGE_PROMPT_IN_THE_SUBJECT,
 *   REFUND_IS_THE_HEADLINE, ONLY_THE_FAILURE_IS_EMAILED
 *
 * WHAT:  Sends the "that clip could not be generated" notice.
 *
 * WHY:   ONLY_THE_FAILURE_IS_EMAILED, and the asymmetry is the decision worth
 *        recording. A SUCCESSFUL clip needs no email: the footage studio polls
 *        while anything is processing and the clip appears in the grid, which
 *        is how every other asset ingest in this product reports itself. A
 *        FAILURE is different on two counts — the generation has a ten-minute
 *        ceiling, so the person has very likely closed the tab, and credits
 *        moved and came back, which is information they cannot see from a grid
 *        they are not looking at. Emailing every success instead would be
 *        twenty messages a month on the Pro allowance, which is how a useful
 *        notification becomes a filter rule.
 *
 *        FOOTAGE_PROMPT_IN_THE_SUBJECT, truncated here rather than in the
 *        template: a prompt may be five hundred characters and a subject line
 *        cannot, while the body can afford more. A clip has no title, so the
 *        prompt is the only thing that identifies WHICH request failed for
 *        somebody who queued several.
 *
 *        REFUND_IS_THE_HEADLINE, as in the render email.
 * WHERE: The footage workflow's failure paths.
 */
export function sendFootageFailedEmail(args: {
  to: string;
  prompt: string;
  reason: string;
  refundedCredits?: number;
  recipientName?: string | null;
}): Promise<EmailSendResult> {
  /* Short enough for a subject line that is not truncated by a mail client,
   * which is where the ellipsis would land anyway. */
  const short = truncatePrompt(args.prompt, 60);

  return renderAndSend({
    to: args.to,
    subject:
      args.refundedCredits !== undefined && args.refundedCredits > 0
        ? `“${short}” could not be generated — credits returned`
        : `“${short}” could not be generated`,
    template: React.createElement(FootageFailedEmail, {
      /* The body affords more than the subject, so it truncates later. */
      prompt: truncatePrompt(args.prompt, 160),
      studioLink: `${APP_URL}/dashboard/footage`,
      reason: args.reason,
      ...(args.refundedCredits !== undefined
        ? { refundedCredits: args.refundedCredits }
        : {}),
      ...(args.recipientName ? { recipientName: args.recipientName } : {}),
    }),
  });
}

/* An ellipsis on a word boundary where there is one nearby, so a truncated
 * prompt still reads as a phrase rather than being cut mid-word. */
function truncatePrompt(prompt: string, max: number): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= max) return trimmed;

  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: sendLowBalanceEmail, ONE_WARNING_NOT_A_DRIP,
 *   WARN_BEFORE_IT_BITES
 *
 * WHAT:  Sends the "running low on credits" warning.
 *
 * WHY:   ONE_WARNING_NOT_A_DRIP is the CALLER's responsibility and is stated
 *        here because it is the thing that will be got wrong. A balance below
 *        a threshold is a STATE, not an event: anything that checks it on a
 *        timer or on every read would send this email repeatedly, and a
 *        warning that arrives daily is a warning that gets filtered. Whatever
 *        calls this must remember that it already has — there is no
 *        suppression inside this function, because the sender cannot know what
 *        the right window is for a given plan.
 *
 *        No `devLink`. The dev outbox exists so a developer with no Resend key
 *        can complete an auth flow that is BLOCKED without the email; this one
 *        is a courtesy and the balance is on screen anyway.
 * WHERE: Phase 10's cost-alert path; not yet wired to a scheduled check — see
 *        the Phase 10 notes.
 */
export function sendLowBalanceEmail(args: {
  to: string;
  organizationName: string;
  balance: number;
  approximateVideosLeft?: number;
}): Promise<EmailSendResult> {
  return renderAndSend({
    to: args.to,
    subject: `${args.organizationName} is running low on credits`,
    template: React.createElement(LowBalanceEmail, {
      organizationName: args.organizationName,
      balance: args.balance,
      topUpLink: `${APP_URL}/dashboard/settings/credits`,
      ...(args.approximateVideosLeft !== undefined
        ? { approximateVideosLeft: args.approximateVideosLeft }
        : {}),
    }),
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: sendOrganizationInvitationEmail
 *
 * WHAT:  Sends the team-invitation message with the accept link.
 * WHERE: Called by the invitation.create / invitation.resend router handlers.
 */
export function sendOrganizationInvitationEmail(args: {
  to: string;
  inviterName: string;
  organizationName: string;
  invitationLink: string;
  role?: string;
}): Promise<EmailSendResult> {
  return renderAndSend({
    to: args.to,
    subject: `You're invited to join ${args.organizationName}`,
    template: React.createElement(TeamInvitationEmail, {
      inviterName: args.inviterName,
      organizationName: args.organizationName,
      invitationLink: args.invitationLink,
      ...(args.role !== undefined ? { role: args.role } : {}),
    }),
    devLink: args.invitationLink,
  });
}
