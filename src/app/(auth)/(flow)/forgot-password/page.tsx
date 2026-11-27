/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ForgotPasswordPage
 *
 * WHAT:  /forgot-password route — request a password-reset email.
 * WHERE: AUTH_ROUTES.forgotPassword; linked from the sign-in form.
 */

import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/global/auth";

export const metadata: Metadata = {
  title: "Forgot password",
};

export default function ForgotPasswordPage() {
  return (
    /* THE FLOW KEEPS ITS SHAPE, and the shell that keeps it is now the
       group's layout — this page once mounted its own AuthShell with no
       aside, so clicking "Forgot password?" from the split sign-in screen
       collapsed the page into a centred single column and the product
       vanished. Sharing one layout with /sign-in and /sign-up makes that
       impossible to regress, and the panel's loop no longer restarts on the
       way here (THE_PANEL_OUTLIVES_THE_PAGE). Only the form differs, which is
       the one thing that should. */
    <>
      {/* my-auto: the split shell top-aligns the form column below lg,
          which is right for sign-in and sign-up because their CTA is pinned
          to the bottom and fills the gap. These two have no pin — a single
          field and a button — so without this they sat at the top of a phone
          screen with 370px of nothing under them. Centred on mobile, and a
          no-op from lg up where the column already centres itself. */}
      <div className="my-auto">
        <ForgotPasswordForm />
      </div>
    </>
  );
}
