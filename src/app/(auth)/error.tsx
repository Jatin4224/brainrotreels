"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AuthError, TWO_DESIGN_FAMILIES, SOFT_BRUTALISM,
 *   AUTH_ROUTES, RouteError, card=false, NO_AUTH_LAYOUT
 *
 * WHAT:  The boundary for sign-in, sign-up, password reset and invitation
 *        acceptance.
 *
 * WHY:   NO_AUTH_LAYOUT — `(auth)` has no layout of its own, so this renders
 *        straight inside the root layout and has to supply its own centring.
 *
 *        Brutalist chrome with `card={false}` for the reason given in the
 *        marketing boundary (TWO_DESIGN_FAMILIES): the auth screens are drawn
 *        in the same family as marketing, not in the product's tactile one.
 *
 *        The way out is sign-in rather than the homepage, and taken from
 *        AUTH_ROUTES rather than written as a literal — a visitor who hit an
 *        error here was trying to get INTO the app, and sending them to the
 *        marketing page makes them find the door again. Typed routes mean a
 *        path that stopped existing would fail the build rather than 404.
 *
 * WHERE: Rendered by Next.js for any throw under src/app/(auth).
 */

import { RouteError } from "@/components/global/route-error";
import { AUTH_ROUTES } from "@/lib/config/auth-routes";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="brutal-border brutal-shadow-lg w-full max-w-md rounded-2xl bg-card px-6">
        <RouteError
          error={error}
          reset={reset}
          logger="ui.auth"
          titleAs="h1"
          description="We could not load this step. Trying again usually clears it."
          action={{ href: AUTH_ROUTES.signIn, label: "Back to sign in" }}
          card={false}
        />
      </div>
    </main>
  );
}
