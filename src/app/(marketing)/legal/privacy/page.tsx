/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PrivacyPage, PLACEHOLDER_IS_LOUD,
 *   PRIVACY_DESCRIBES_THE_REAL_SYSTEM
 *
 * WHAT:  /legal/privacy — the privacy policy.
 * WHY:   PRIVACY_DESCRIBES_THE_REAL_SYSTEM. This draft is written from what the
 *        code actually does rather than from a template: the subprocessor list
 *        is the provider seams this app really has (Anthropic, ElevenLabs,
 *        Cloudflare R2, AWS Lambda, Stripe, Resend, Upstash, Inngest, Sentry,
 *        PostHog), the retention section reflects that moderation records
 *        deliberately outlive their subjects, and the analytics section
 *        reflects that autocapture and session recording are switched off.
 *        A privacy policy that does not match the system is worse than none,
 *        because it is a statement rather than a guess.
 *
 *        The WORDS still need counsel, and jurisdiction-specific rights (GDPR
 *        lawful bases, CCPA categories, a DPA) are deliberately absent rather
 *        than invented — see the banner.
 * WHERE: Linked from the footer and the legal index.
 */

import type { Metadata } from "next";

import { APP_NAME } from "@/lib/config/branding";
import { LegalDocument } from "../_components/legal-document";

export const metadata: Metadata = {
  title: "Privacy policy",
};

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy policy" updated="22 October 2026">
      <p>
        This describes what {APP_NAME} collects, why, and who else sees it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details</strong> — your name, email address and
          password hash, and which workspaces you belong to.
        </li>
        <li>
          <strong>What you make</strong> — the prompts, source material,
          scripts, narration audio and videos in your workspace.
        </li>
        <li>
          <strong>Billing details</strong> — handled by Stripe. We store a
          customer reference and a card fingerprint used to prevent repeated
          free trials; we never see or store your card number.
        </li>
        <li>
          <strong>Operational records</strong> — audit entries for actions taken
          in a workspace, including the IP address and browser agent they came
          from, and content-safety decisions about what you asked us to
          generate.
        </li>
      </ul>

      <h2>Who else processes it</h2>
      <p>
        Making a video means sending parts of your content to providers who do
        the work. We use: Anthropic (writing scripts and classifying content),
        ElevenLabs (synthesising narration and timing captions), Cloudflare R2
        (storing media), AWS (rendering video), Stripe (payments), Resend
        (email), Upstash (rate limiting), Inngest (running background work),
        Sentry (error reports) and PostHog (product analytics).
      </p>
      <p>
        Your prompts, scripts and audio reach the AI providers above. Error
        reports and analytics carry identifiers and page paths, not your content.
      </p>

      <h2>Analytics</h2>
      <p>
        We record page views and a small set of product milestones — account
        created, first script, first video, first render, purchase. We do not
        use automatic click or form capture, and we do not record sessions, so
        the contents of your editor are never sent to an analytics provider. If
        you decline analytics cookies, no analytics are loaded at all.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          Your projects and media stay until you delete them or close the
          workspace.
        </li>
        <li>
          Audit entries and content-safety decisions are kept after the project
          they refer to is deleted, so that a decision can be explained or
          appealed later. They are removed when the workspace is deleted.
        </li>
        <li>Billing records are kept as long as the law requires.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>Delete a project, or the whole workspace, at any time.</li>
        <li>Decline analytics cookies without losing any functionality.</li>
        <li>Ask us for a copy of your data, or for its deletion.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Media is stored in private buckets and reached only through short-lived
        signed links. Access to a workspace&apos;s data is scoped to its
        members. We do not sell personal data.
      </p>
    </LegalDocument>
  );
}
