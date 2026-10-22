/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: TermsPage, PLACEHOLDER_IS_LOUD, NOT_LEGAL_ADVICE
 *
 * WHAT:  /legal/terms — the terms of service.
 * WHY:   SCAFFOLDING. The sections are the ones a generative-video product
 *        actually needs, and several of them encode decisions this codebase has
 *        already made — the content policy mirrors MODERATION_CATEGORIES, the
 *        credit clause mirrors how the ledger behaves, and the output-ownership
 *        clause is the one a customer will ask about first. The WORDS are a
 *        developer's draft and are marked as such on the page.
 * WHERE: Linked from the footer and the legal index.
 */

import type { Metadata } from "next";

import { APP_NAME } from "@/lib/config/branding";
import { LegalDocument } from "../_components/legal-document";

export const metadata: Metadata = {
  title: "Terms of service",
};

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of service" updated="22 October 2026">
      <p>
        These terms govern your use of {APP_NAME}. By creating an account you
        agree to them.
      </p>

      <h2>What the service does</h2>
      <p>
        {APP_NAME} generates short-form videos from text you supply. It writes a
        script, synthesises narration, times captions and renders a video file.
        Parts of the pipeline use third-party AI providers.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You are responsible for everything done under your account.</li>
        <li>
          An account belongs to a workspace. Anyone you invite can use the
          workspace&apos;s credits and see its projects.
        </li>
        <li>
          We may require a verified email address before you can generate
          videos.
        </li>
      </ul>

      <h2>What you may not make</h2>
      <p>
        You may not use the service to produce content that sexualises a minor,
        sexually explicit material, graphic violence, content targeting a group
        with hatred, harassment of a person, material promoting self-harm,
        instructions for illegal acts, extremist or terrorist material,
        impersonation or deliberate misinformation, or another person&apos;s
        private information.
      </p>
      <p>
        We check prompts, source material and generated scripts automatically
        before generating, and we may refuse or hold work for review. A refusal
        names the category it was refused under. We may suspend an account that
        repeatedly attempts prohibited content.
      </p>

      <h2>Content you supply</h2>
      <p>
        You keep ownership of what you upload and of the text you write. You are
        responsible for having the rights to it — including rights to any
        footage, music or likeness you supply. You grant us the licence needed
        to process it in order to make your video.
      </p>

      <h2>Content you generate</h2>
      <p>
        Subject to these terms and to the rights of others, you own the videos
        you generate and may use them commercially. We make no claim to them. We
        cannot guarantee that generated output is unique, accurate, or free of
        third-party rights, and you are responsible for reviewing it before
        publishing.
      </p>

      <h2>Credits and plans</h2>
      <ul>
        <li>
          Paid work consumes credits. Credits are reserved when work starts and
          charged when it completes.
        </li>
        <li>
          If work fails, the reserved credits are returned. You are charged for
          the steps that finished.
        </li>
        <li>
          Plans cap how much you can hold and how much you can generate per day.
        </li>
        <li>
          Credits have no cash value and are not transferable between
          workspaces.
        </li>
      </ul>
      <p>
        Refunds are covered by the refund policy, which forms part of these
        terms.
      </p>

      <h2>Availability</h2>
      <p>
        The service is provided as-is. We do not promise it will be
        uninterrupted. Parts of it depend on third-party providers, and when one
        is unavailable the affected work is refused rather than completed
        incorrectly.
      </p>

      <h2>Ending the agreement</h2>
      <p>
        You may stop using the service and delete your workspace at any time. We
        may suspend or end access for breach of these terms, non-payment, or to
        comply with the law.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. Material changes will be notified before they
        take effect.
      </p>
    </LegalDocument>
  );
}
