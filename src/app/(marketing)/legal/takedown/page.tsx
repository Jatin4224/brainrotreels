/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: TakedownPage, TAKEDOWN_IS_FINDABLE,
 *   A_CONTACT_NOT_A_FORM
 *
 * WHAT:  /legal/takedown — how to report content and ask for its removal.
 *
 * WHY:   A_CONTACT_NOT_A_FORM. This page is an email address and instructions,
 *        not a submission form, and that is deliberate for a first version. A
 *        form implies a tracked queue with an SLA behind it; there is no such
 *        queue yet (the portal's moderation queue holds OUR OWN classifier's
 *        decisions, not third-party reports). An address that a person reads is
 *        honest; a form that drops into nothing is worse than no form.
 *
 *        TAKEDOWN_IS_FINDABLE — a rights holder who cannot find a contact
 *        complains to a host or a payment processor instead, which is a far
 *        more expensive conversation. It is linked from the footer of every
 *        public page and listed first on the legal index.
 *
 *        It asks for the specific details that make a report actionable,
 *        because the usual failure is a report naming a video nobody can
 *        identify.
 * WHERE: Linked from the marketing footer and the legal index.
 */

import type { Metadata } from "next";

import { APP_NAME } from "@/lib/config/branding";
import { LegalDocument } from "../_components/legal-document";

export const metadata: Metadata = {
  title: "Report content",
};

export default function TakedownPage() {
  return (
    <LegalDocument title="Report content" updated="22 October 2026">
      <p>
        If something made with {APP_NAME} infringes your rights, misuses your
        likeness, or breaks our content policy, tell us and we will look at it.
      </p>

      <h2>What to send</h2>
      <ul>
        <li>A link to the video, or where you saw it published.</li>
        <li>
          What is wrong with it — which right is infringed, or which part of the
          content policy it breaks.
        </li>
        <li>
          If you are claiming a copyright or trademark, what the original work
          is and your authority to act for the owner.
        </li>
        <li>How to reach you.</li>
      </ul>

      <h2>What happens next</h2>
      <p>
        We acknowledge reports and investigate them. Where a report is
        well-founded we remove the content and may suspend the account that
        produced it. We may pass your report to the account holder, so tell us
        if you need your details withheld.
      </p>

      <h2>Reporting a prompt or a script</h2>
      <p>
        We check prompts, source material and generated scripts automatically
        before anything is produced, and hold borderline cases for review. If
        you believe something got past those checks, say so in your report —
        that is the most useful kind of report we receive, because it tells us
        where the checks are wrong.
      </p>

      <h2>Where to send it</h2>
      <p>
        Email{" "}
        <a href="mailto:abuse@example.com" className="underline">
          abuse@example.com
        </a>
        . Replace this address with a monitored mailbox before launch — a
        reporting route that nobody reads is worse than none.
      </p>
    </LegalDocument>
  );
}
