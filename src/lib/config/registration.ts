/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: REGISTRATION_OPEN
 *
 * WHAT:  Boolean indicating whether self-serve sign-up is allowed.
 * WHY:   Set NEXT_PUBLIC_REGISTRATION_OPEN=false to put the app in
 *        invitation-only mode; the auth.ts databaseHooks.user.create.before
 *        hook enforces this server-side as a last line of defense.
 * WHERE: Read by auth.ts (server gate) and the sign-up UI (hide form).
 */
export const REGISTRATION_OPEN =
  process.env["NEXT_PUBLIC_REGISTRATION_OPEN"] !== "false";
