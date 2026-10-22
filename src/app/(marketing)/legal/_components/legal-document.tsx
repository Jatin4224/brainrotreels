/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: LegalDocument, PlaceholderNotice,
 *   PLACEHOLDER_IS_LOUD, NOT_LEGAL_ADVICE, LEGAL_IS_A_LAUNCH_BLOCKER
 *
 * WHAT:  The shell every legal page renders inside, and the banner that says
 *        the words in it are not final.
 *
 * WHY:   PLACEHOLDER_IS_LOUD. These documents are SCAFFOLDING: the routes, the
 *        structure and the headings are real, and the prose is a starting
 *        point written by a developer, not a lawyer. The banner is deliberately
 *        impossible to miss and impossible to remove by accident — a single
 *        `placeholder` prop on this component controls it, so shipping a
 *        finished document is one boolean per page rather than a hunt through
 *        the copy for disclaimers.
 *
 *        NOT_LEGAL_ADVICE, and the failure mode this guards against is
 *        specific: a terms page that LOOKS finished is one that gets linked
 *        from a checkout, agreed to by a customer, and relied on in a dispute.
 *        A visible banner is the difference between unfinished work and a false
 *        representation.
 *
 *        LEGAL_IS_A_LAUNCH_BLOCKER — the phase ships the public beta, and these
 *        documents are the one part of it that cannot be completed by writing
 *        code. They are tracked as a blocker in the Phase 10 notes rather than
 *        quietly ticked.
 *
 *        `updated` is a REQUIRED prop rather than `new Date()`, because a legal
 *        document's date is the date its TERMS changed, not the date the page
 *        was rendered — and a page that silently redates itself on every deploy
 *        is worse than one with no date at all.
 * WHERE: Every page under src/app/(marketing)/legal/.
 */

import type * as React from "react";

import { APP_NAME } from "@/lib/config/branding";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface LegalDocumentProps {
  title: string;
  /** When the TERMS last changed — not when the page was built. */
  updated: string;
  /**
   * True while the copy is scaffolding. Set it to false only when a lawyer has
   * approved the words on the page — see PLACEHOLDER_IS_LOUD.
   */
  placeholder?: boolean;
  children: React.ReactNode;
}

export function LegalDocument({
  title,
  updated,
  placeholder = true,
  children,
}: LegalDocumentProps) {
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-xs text-muted-foreground">Last updated {updated}</p>
      </header>

      {placeholder ? <PlaceholderNotice /> : null}

      {/* Styled with ORDINARY utilities and descendant selectors rather than
          the typography plugin's `prose` classes, because this project does not
          have that plugin installed — and adding a dependency to format four
          documents would be the wrong trade. Every colour is a theme token, so
          the documents read in both themes like every other surface. */}
      <div className="flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground [&_a]:underline [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_li]:ml-4 [&_li]:list-disc [&_strong]:text-foreground [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>

      <p className="text-xs text-muted-foreground">
        Questions about this document? Write to{" "}
        <a href={`mailto:legal@${hostFromAppName()}`} className="underline">
          legal@{hostFromAppName()}
        </a>
        .
      </p>
    </article>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: PlaceholderNotice, PLACEHOLDER_IS_LOUD
 *
 * WHAT:  The banner that says this document is not final.
 * WHY:   `destructive` rather than a neutral note, deliberately: this is the
 *        most severe thing on the page and a muted callout is one a reader
 *        skips. It names what is missing (counsel review) and what to do
 *        (replace before launch), because a warning with no action is one
 *        somebody dismisses.
 * WHERE: LegalDocument, whenever `placeholder` is true.
 */
function PlaceholderNotice() {
  return (
    <Alert variant="destructive">
      <AlertTitle>Draft — not reviewed by a lawyer</AlertTitle>
      <AlertDescription>
        This document is scaffolding. The structure is real and the wording is a
        developer&apos;s first draft; it is not legal advice and it has not been
        reviewed by counsel. Replace the copy before opening sign-ups to the
        public.
      </AlertDescription>
    </Alert>
  );
}

/* A contact address derived from the brand rather than hardcoded, so a rename
 * does not leave a dead mailbox in four documents. It is a best guess at the
 * domain and is expected to be replaced along with the copy. */
function hostFromAppName(): string {
  return `${APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`;
}
