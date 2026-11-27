/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ResetPasswordPage
 *
 * WHAT:  /reset-password route — set a new password from the email link's token.
 * WHY:   The form reads `?token=` via useSearchParams, so it's wrapped in a
 *        Suspense boundary (Next.js requirement for static-generation compat).
 * WHERE: AUTH_ROUTES.resetPassword; the reset-link email lands here.
 */

import { Suspense } from "react";
import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/global/auth";

export const metadata: Metadata = {
  title: "Reset password",
};

export default function ResetPasswordPage() {
  return (
    /* THE FLOW KEEPS ITS SHAPE, and the shell that keeps it is the group's
       layout now — see the same note on /forgot-password. Only the form
       differs, which is the one thing that should. */
    <>
      {/* my-auto: the split shell top-aligns the form column below lg,
          which is right for sign-in and sign-up because their CTA is pinned
          to the bottom and fills the gap. These two have no pin — a single
          field and a button — so without this they sat at the top of a phone
          screen with 370px of nothing under them. Centred on mobile, and a
          no-op from lg up where the column already centres itself. */}
      <div className="my-auto">
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </>
  );
}
