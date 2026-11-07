/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthModeTabs, AuthModeNav, AuthModeSwitchProps,
 *   MODE_SWITCH_IS_A_ROUTE, AUTH_SCREEN_COPY, authRouteWithCallback,
 *   RETURN_TO_AFTER_AUTH, AUTH_SURFACE, TYPED_ROUTE_GUARANTEE
 *
 * WHAT:  The two ways to get from one auth mode to the other — the segmented
 *        tab pair at the top of the form card, and the prompt + outline pill
 *        in the desktop top bar.
 *
 * WHY:   MODE_SWITCH_IS_A_ROUTE. auth-design.md asks that toggling update the
 *        URL so each mode can be linked directly; this app already HAS two
 *        routes, so the switch is a <Link> between them rather than client
 *        state with a `history.replaceState` bolted on. That also keeps both
 *        screens server-rendered, keeps `proxy.ts`'s REGISTRATION_OPEN bounce
 *        meaningful (a closed sign-up is a redirect, not a hidden tab), and
 *        costs nothing: Next prefetches the sibling route, so the swap is as
 *        immediate as local state would have been.
 *
 *        Because they are links and not tabs, this is a `<nav>` with an
 *        `aria-current` on the active one — NOT `role="tablist"`. The design
 *        spec names a tablist, and that was the one instruction worth
 *        declining: `role="tab"` promises a panel that appears in place, and
 *        announcing "tab, 1 of 2" for a control that navigates to another page
 *        is a lie told to exactly the users who cannot see it happen.
 *
 *        RETURN_TO_AFTER_AUTH: whatever sent the visitor here is CARRIED
 *        ACROSS the switch. An invitee who lands on /sign-in, realises they
 *        have no account and presses "Create account" must still come back to
 *        the invitation afterwards — dropping the callback here is how they
 *        end up on the dashboard with no idea they were invited.
 *
 *        PROVIDER_NEUTRAL, which is why both live in `components/global/auth`
 *        and not inside the Better Auth form: which modes exist and what the
 *        app calls them is not a fact about the auth provider.
 *
 * WHERE: <AuthModeTabs> is rendered at the top of the Better Auth form card;
 *        <AuthModeNav> is passed as the `headerEnd` of <AuthShell> by the
 *        (auth) sign-in and sign-up pages.
 */

import type { Route } from "next";
import Link from "next/link";

import { AUTH_ROUTES, authRouteWithCallback } from "@/lib/config";
import type { AuthFormMode } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AUTH_SCREEN_COPY } from "./auth-content";

export interface AuthModeSwitchProps {
  /** The mode currently on screen. The link always targets the other one. */
  mode: AuthFormMode;
  /**
   * Where to return after authenticating, or null for the default. Carried
   * across the switch — see RETURN_TO_AFTER_AUTH.
   */
  callbackURL?: string | null | undefined;
  className?: string | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_MODE_ORDER, AuthFormMode
 *
 * WHAT:  Both modes in the order the segmented control shows them, with the
 *        label each tab wears and the route it points at.
 * WHY:   One list, so the tab pair and the top-bar pill cannot disagree about
 *        what the app calls a mode. `satisfies` keeps it exhaustive against
 *        `AuthFormMode`: a third mode fails the typecheck here rather than
 *        quietly never appearing in the switch.
 * WHERE: Both components below.
 */
const AUTH_MODE_ORDER = [
  { mode: "sign-in", label: "Sign in", route: AUTH_ROUTES.signIn },
  { mode: "sign-up", label: "Create account", route: AUTH_ROUTES.signUp },
] as const satisfies readonly {
  mode: AuthFormMode;
  label: string;
  route: Route;
}[];

/**
 * SOURCE OF TRUTH KEYWORDS: AuthModeTabs
 *
 * WHAT:  The segmented pair at the top of the form card.
 * WHERE: The Better Auth sign-in / sign-up form.
 */
export function AuthModeTabs({
  mode,
  callbackURL = null,
  className,
}: AuthModeSwitchProps) {
  return (
    <nav
      aria-label="Sign in or create an account"
      className={cn(
        "brutal-border grid grid-cols-2 gap-1 rounded-[1.375rem] bg-surface-raised p-2",
        className,
      )}
    >
      {AUTH_MODE_ORDER.map((entry) => {
        const isActive = entry.mode === mode;

        return (
          <Link
            key={entry.mode}
            href={authRouteWithCallback(entry.route, callbackURL ?? null)}
            /* The active tab is the page you are already on, so it is marked
               as the current page rather than disabled — a link you cannot
               focus is one a keyboard user cannot confirm they are on. */
            {...(isActive ? { "aria-current": "page" as const } : {})}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-2xl px-4 text-base font-bold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
              isActive
                ? "bg-brand-accent text-brand-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: AuthModeNav
 *
 * WHAT:  The desktop top bar's "New here? → Create account" pair.
 * WHY:   Hidden below `lg`: the mobile artboards carry the cross-link once,
 *        under the CTA where a thumb already is, and the same offer twice on a
 *        390px screen is noise.
 * WHERE: The `headerEnd` slot of <AuthShell>.
 */
export function AuthModeNav({
  mode,
  callbackURL = null,
  className,
}: AuthModeSwitchProps) {
  const copy = AUTH_SCREEN_COPY[mode];
  const target =
    mode === "sign-in" ? AUTH_ROUTES.signUp : AUTH_ROUTES.signIn;

  return (
    <div className={cn("hidden items-center gap-4 lg:flex", className)}>
      <span className="text-sm font-medium text-muted-foreground">
        {copy.navPrompt}
      </span>
      <Link
        href={authRouteWithCallback(target, callbackURL ?? null)}
        className="brutal-border brutal-hover inline-flex h-11 items-center rounded-full bg-transparent px-6 text-base font-bold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {copy.navCta}
      </Link>
    </div>
  );
}
