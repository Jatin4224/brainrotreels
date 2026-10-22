/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: RefundsPage, PLACEHOLDER_IS_LOUD,
 *   REFUNDS_MATCH_THE_LEDGER
 *
 * WHAT:  /legal/refunds — the refund policy.
 * WHY:   REFUNDS_MATCH_THE_LEDGER. Every clause here describes behaviour the
 *        code already has: a hold released on failure, a partial release when
 *        work came in shorter than estimated, a fully degraded alignment not
 *        charged at all, and a cancelled run returning what it reserved. A
 *        refund policy that promised something the ledger does not do would be
 *        a commitment nobody could honour, so this one was written by reading
 *        src/services/credits.service.ts.
 * WHERE: Linked from the footer, the legal index and the pricing page.
 */

import type { Metadata } from "next";

import { LegalDocument } from "../_components/legal-document";

export const metadata: Metadata = {
  title: "Refund policy",
};

export default function RefundsPage() {
  return (
    <LegalDocument title="Refund policy" updated="22 October 2026">
      <h2>Work that fails</h2>
      <p>
        Credits are reserved before paid work starts and charged when it
        finishes. If a step fails, the reservation is returned automatically —
        you do not need to ask, and you are charged only for the steps that
        completed.
      </p>
      <ul>
        <li>
          A render that fails or times out returns everything it reserved.
        </li>
        <li>
          A generation that stops part-way keeps the charge for the script and
          narration that were produced, and returns the rest.
        </li>
        <li>
          If you cancel a generation, whatever it had reserved is returned.
        </li>
        <li>
          If caption timing falls back to even spacing because the provider was
          unavailable, that step is not charged.
        </li>
        <li>
          Work that came out shorter than estimated is charged at the shorter
          length, and the difference is returned.
        </li>
      </ul>

      <h2>Credits you bought</h2>
      <p>
        Credit purchases are final. Credits do not expire while your workspace
        is open, have no cash value, and cannot be transferred between
        workspaces or converted back to money. If a purchase was charged twice
        or charged in error, contact us and we will refund it.
      </p>

      <h2>Subscriptions</h2>
      <p>
        Subscriptions are billed in advance for the period you chose. You can
        cancel at any time and keep access until the end of the period already
        paid for; we do not pro-rate a partial period. A free trial can be
        cancelled before it ends at no charge.
      </p>

      <h2>Work you are unhappy with</h2>
      <p>
        Generated output is produced by AI models and varies. We do not refund
        credits for a video that completed successfully but was not what you
        hoped for — the output is yours to regenerate or edit. If output is
        unusable because of a fault on our side, contact us.
      </p>

      <h2>How to ask</h2>
      <p>
        Write to us with your workspace name and what happened. Refunds are
        returned to the original payment method.
      </p>
    </LegalDocument>
  );
}
