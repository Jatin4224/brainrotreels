/*

/**
 * SOURCE OF TRUTH KEYWORDS: BaseLayout, emailStyles, EmailButton,
 *   EmailVerificationEmail, PasswordResetEmail, TeamInvitationEmail
 *
 * WHAT:  Barrel for the transactional email templates and the shared layout.
 * WHY:   Single import surface so the email service references templates by
 *        name without reaching into the folder structure.
 * WHERE: Imported by src/services/email.service.ts.
 */

export { BaseLayout, emailStyles, EmailButton } from "./base-layout";
export {
  EmailVerificationEmail,
  type EmailVerificationEmailProps,
} from "./transactional/email-verification";
export {
  PasswordResetEmail,
  type PasswordResetEmailProps,
} from "./transactional/password-reset";
export {
  TeamInvitationEmail,
  type TeamInvitationEmailProps,
} from "./transactional/team-invitation";
