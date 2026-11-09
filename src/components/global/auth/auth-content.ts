/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_SCREEN_COPY, AUTH_PANEL_COPY,
 *   AUTH_MOBILE_TAG, AuthScreenCopy, AuthPanelCopy, AuthFormMode,
 *   PAGE_OWNED_COPY, AUTH_SURFACE, OPERATOR_OWNS_THESE_CLAIMS, HERO_COPY
 *
 * WHAT:  Every word the sign-in and sign-up screens say that is not a field
 *        label — each mode's two headings, lead, button and cross-link — plus
 *        the pitch on the panel beside the desktop form.
 *
 * WHY:   PAGE_OWNED_COPY, held apart from the components that render it for
 *        the same reason `landing-content.ts` is: a copy change becomes a diff
 *        a non-engineer can follow, and the markup stays readable. It sits in
 *        `components/global/auth` rather than beside one route because BOTH
 *        auth routes read it — a copy of it under `sign-in/_components` is how
 *        the two screens start describing the same product differently.
 *
 *        A `Record<AuthFormMode, …>` and not two loose constants: the mode
 *        union is the source of truth for how many auth screens exist, so a
 *        third mode fails the typecheck HERE until somebody writes its words,
 *        instead of shipping a screen with an empty heading.
 *
 *        Plain data, no "use client" — the pages are Server Components and
 *        only the form beneath them is interactive, so none of this is sent to
 *        the browser twice.
 *
 * WHERE: Read by ./auth-hero.tsx and ./auth-showcase.tsx. The landing page's
 *        own copy stays in
 *        src/app/(marketing)/_components/landing-content.ts.
 */

import type {
  AuthFormMode,
  AuthPanelCopy,
  AuthScreenCopy,
} from "@/lib/types";

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_SCREEN_COPY, AuthScreenCopy, AuthFormMode,
 *   TWO_HEADINGS_ONE_SCREEN
 *
 * WHAT:  The words for each auth mode, keyed by mode.
 * WHY:   Two headings per mode on purpose — see TWO_HEADINGS_ONE_SCREEN on
 *        `AuthScreenCopy`. The compact `title`/`lead` pair is what the form
 *        column says once the panel on the right is carrying the pitch; the
 *        `mobileHeadline*` trio is what it says when there is no panel.
 * WHERE: ./auth-hero.tsx.
 */
export const AUTH_SCREEN_COPY: Record<AuthFormMode, AuthScreenCopy> = {
  "sign-in": {
    title: "Welcome back",
    lead: "Sign in to pick up your drafts.",
    mobileHeadlineBefore: "Your feed missed",
    mobileHeadlineHighlight: "you",
    mobileHeadlineAfter: "",
    submitLabel: "Sign in",
    footerPrompt: "New here?",
    footerCta: "Create account",
  },
  "sign-up": {
    title: "Create your account",
    lead: "Your first short is on us.",
    mobileHeadlineBefore: "Make shorts people",
    mobileHeadlineHighlight: "actually",
    mobileHeadlineAfter: "watch",
    submitLabel: "Create account",
    footerPrompt: "Already creating?",
    footerCta: "Sign in",
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_PANEL_COPY, AuthPanelCopy, HERO_COPY,
 *   AUTH_MESSAGE_PANEL, OPERATOR_OWNS_THESE_CLAIMS
 *
 * WHAT:  The pitch on the panel beside the desktop form.
 *
 * WHY:   ⚠ THESE WORDS MIRROR `HERO_COPY` in
 *        src/app/(marketing)/_components/landing-content.ts, deliberately: a
 *        visitor presses "Get started" on the landing page and lands here, so
 *        the two must say the same thing. They are duplicated rather than
 *        imported because `HERO_COPY` is route-local and a global component
 *        reaching into a route's private `_components` is the wrong
 *        direction. CHANGE BOTH TOGETHER.
 *
 *        OPERATOR_OWNS_THESE_CLAIMS: `socialProof` is the operator's figures,
 *        supplied with the design and unverifiable from this codebase. It is
 *        the line most likely to go stale, and the one a visitor sees twice
 *        inside a single click.
 * WHERE: ./auth-showcase.tsx.
 */
export const AUTH_PANEL_COPY: AuthPanelCopy = {
  headlineBefore: "Create content people",
  headlineHighlight: "actually",
  headlineAfter: "want to watch",
  lead: "Turn any idea, script, URL or document into a finished short with visuals, voice, sound and editing handled for you.",
  socialProof: "12,400+ creators · 38M views generated",
};

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_MOBILE_TAG, HERO_COPY
 *
 * WHAT:  The small tilted pill beside the wordmark on mobile.
 * WHY:   The short form of the landing hero's "Ready to post in 41s". Mobile
 *        only: at `lg` the same claim would compete with the panel's headline
 *        for the same glance, and the panel wins.
 * WHERE: Passed as <AuthShell headerTag> by the (auth) pages.
 */
export const AUTH_MOBILE_TAG = "41s to post";
