/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SignInPage, AUTH_SURFACE, AuthHero, AuthShowcase,
 *   AUTH_MOBILE_TAG, RETURN_TO_AFTER_AUTH, OPEN_REDIRECT_GUARD
 *
 * WHAT:  /sign-in route — the split auth screen in sign-in mode: the wordmark
 *        in the top bar, the heading and form on the left, the message panel
 *        on the right, and the legal line along the bottom. This is the route
 *        AUTH_ROUTES.signIn points at, and the destination
 *        AuthRedirectObserver pushes unauthenticated users to.
 * WHY:   Stays a composition of global pieces so all auth UI logic lives in
 *        one place; mode is the only difference from /sign-up. The chrome
 *        (hero, panel, footer) is assembled HERE and in AuthShell rather than
 *        inside <AuthForm> because it is provider-neutral — swapping the auth
 *        provider must not change what the screen says or how it is laid out
 *        (PROVIDER_ISOLATION).
 * WHERE: Linked from AUTH_ROUTES.signIn (src/lib/config/auth-routes.ts);
 *        proxy.ts bounces /sign-up here when registration is closed.
 */

import type { Metadata } from "next";

import {
  AuthForm,
  AuthHero,
  AuthShell,
  AuthShowcase,
  AUTH_MOBILE_TAG,
} from "@/components/global/auth";
import { resolveAuthCallback } from "@/lib/config";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string | string[] }>;
}) {
  /* RETURN_TO_AFTER_AUTH: whoever sent the visitor here may have said where to
   * put them afterwards — an invitation link is the case that matters, since
   * dropping it strands an invitee on the dashboard with no idea they were
   * invited. resolveAuthCallback refuses anything that is not a site-relative
   * path (OPEN_REDIRECT_GUARD), and AuthScreen falls back to '/' on null. */
  const { callbackURL } = await searchParams;
  const destination = resolveAuthCallback(callbackURL);

  return (
    <AuthShell headerTag={AUTH_MOBILE_TAG} aside={<AuthShowcase />}>
      <AuthHero mode="sign-in" className="mb-7" />
      <AuthForm
        mode="sign-in"
        {...(destination ? { callbackURL: destination } : {})}
      />
    </AuthShell>
  );
}
