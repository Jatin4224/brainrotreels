/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthFlowLayout, AUTH_FLOW_GROUP,
 *   THE_PANEL_OUTLIVES_THE_PAGE, AuthShell, AuthShowcase, AUTH_MOBILE_TAG,
 *   ONE_LOOP_ONE_DURATION, NO_AUTH_IN_THIS_GROUP
 *
 * WHAT:  The shell every screen of the credential flow shares — sign-in,
 *        sign-up, forgot-password and reset-password. It renders the split
 *        page (form column left, animated showcase right); the pages render
 *        only their heading and their form.
 *
 * WHY:   THE_PANEL_OUTLIVES_THE_PAGE, and this is a MOTION fix before it is
 *        an architectural one. All four pages used to mount their own
 *        `<AuthShell aside={<AuthShowcase />}>`, and `SignInPage` and
 *        `SignUpPage` are different component types at the same position in
 *        the tree — so switching the mode tabs unmounted the subtree and
 *        remounted the showcase, restarting its 3.4s loop from 0%. The panel
 *        snapped from wherever it was in the story (reels fanned out, say)
 *        back to the document falling, on the one interaction these screens
 *        are for. A LAYOUT is not remounted across sibling navigations, so
 *        the loop now runs continuously while the form beside it changes —
 *        which is the whole argument for ONE_LOOP_ONE_DURATION extended to
 *        the page lifecycle.
 *
 *        A NESTED GROUP and not `(auth)/layout.tsx`, because
 *        accept-invitation is also an `(auth)` route and deliberately has NO
 *        aside — it is a one-column confirmation, not a sales surface, and a
 *        layout it cannot opt out of would have forced the panel onto it.
 *        `(flow)` is path-transparent, so every URL is unchanged.
 *
 *        NO_AUTH_IN_THIS_GROUP still holds: nothing here reads a session.
 * WHERE: Wraps src/app/(auth)/(flow)/{sign-in,sign-up,forgot-password,
 *        reset-password}/page.tsx. The entrance those pages play on arrival
 *        is ./template.tsx, which is the file that DOES remount.
 */

import { AuthShell, AuthShowcase, AUTH_MOBILE_TAG } from "@/components/global/auth";

export default function AuthFlowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthShell headerTag={AUTH_MOBILE_TAG} aside={<AuthShowcase />}>
      {children}
    </AuthShell>
  );
}
