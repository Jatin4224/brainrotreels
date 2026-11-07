/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SignInPage, AUTH_SURFACE, AuthHero, AuthShowcase,
 *   AuthModeNav, RETURN_TO_AFTER_AUTH, OPEN_REDIRECT_GUARD
 *
 * WHAT:  /sign-in route — the split auth screen in sign-in mode: the wordmark
 *        and the "New here? → Create account" pair in the top bar, the
 *        headline and form on the left, the showcase panel on the right.
 *        This is the route AUTH_ROUTES.signIn points at, and the destination
 *        AuthRedirectObserver pushes unauthenticated users to.
 * WHY:   Stays a composition of global pieces so all auth UI logic lives in
 *        one place; mode is the only difference from /sign-up. The chrome
 *        (hero, nav, showcase) is assembled HERE rather than inside
 *        <AuthForm> because it is provider-neutral — swapping the auth
 *        provider must not change what the screen says or how it is laid out
 *        (PROVIDER_ISOLATION).
 * WHERE: Linked from AUTH_ROUTES.signIn (src/lib/config/auth-routes.ts);
 *        proxy.ts bounces /sign-up here when registration is closed.
 */

import type { Metadata } from "next";

import {
  AuthForm,
  AuthHero,
  AuthModeNav,
  AuthShell,
  AuthShowcase,
  AUTH_SHOWCASE_COPY,
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
    <AuthShell
      headerTag={AUTH_SHOWCASE_COPY.renderedBadgeShort}
      headerEnd={<AuthModeNav mode="sign-in" callbackURL={destination} />}
      aside={<AuthShowcase />}
    >
      <AuthHero mode="sign-in" className="mb-8 lg:mb-10" />
      <AuthForm
        mode="sign-in"
        {...(destination ? { callbackURL: destination } : {})}
      />
    </AuthShell>
  );
}
