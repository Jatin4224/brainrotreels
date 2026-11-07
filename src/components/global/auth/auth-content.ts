/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_SCREEN_COPY, AUTH_SHOWCASE_CARDS,
 *   AUTH_SHOWCASE_COPY, AuthScreenCopy, AuthShowcaseCard, AuthFormMode,
 *   PAGE_OWNED_COPY, AUTH_SURFACE, OPERATOR_OWNS_THESE_CLAIMS
 *
 * WHAT:  Every word the sign-in and sign-up screens say that is not a field
 *        label — the two modes' badges, split headlines, leads, top-bar
 *        prompts and button labels — plus the decor copy of the desktop
 *        showcase panel.
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
 *        instead of shipping a screen with an empty headline.
 *
 *        Plain data, no "use client" — the pages are Server Components and
 *        only the form beneath them is interactive, so none of this is sent to
 *        the browser twice.
 *
 *        OPERATOR_OWNS_THESE_CLAIMS: the creator and view counts in
 *        `AUTH_SHOWCASE_COPY` are the operator's figures, supplied with the
 *        design and unverifiable from this codebase. They deliberately MIRROR
 *        `HERO_COPY.socialProof` on the landing page — a visitor who clicks
 *        "Get started" sees the same claim twice, and two different numbers
 *        across one click is the failure. Correct both together.
 *
 * WHERE: Read by ./auth-hero.tsx, ./auth-showcase.tsx and the top bar built in
 *        src/app/(auth)/sign-in/page.tsx and sign-up/page.tsx. The landing
 *        page's own copy stays in
 *        src/app/(marketing)/_components/landing-content.ts.
 */

import type {
  AuthFormMode,
  AuthScreenCopy,
  AuthShowcaseCard,
} from "@/lib/types";

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_SCREEN_COPY, AuthScreenCopy, AuthFormMode
 *
 * WHAT:  The words for each auth mode, keyed by mode.
 * WHY:   `navPrompt`/`navCta` always name the OPPOSITE mode, because the top
 *        bar's job is to offer the screen the visitor did not land on.
 * WHERE: ./auth-hero.tsx and the (auth) pages' top bars.
 */
export const AUTH_SCREEN_COPY: Record<AuthFormMode, AuthScreenCopy> = {
  "sign-in": {
    badge: "Welcome back, creator",
    headlineBefore: "Your feed missed",
    headlineHighlight: "you",
    headlineAfter: "",
    lead: "Sign in to pick up your drafts and keep shipping shorts.",
    navPrompt: "New here?",
    navCta: "Create account",
    submitLabel: "Sign in",
    footerPrompt: "New here?",
    footerCta: "Create account",
  },
  "sign-up": {
    badge: "Your first short is on us",
    headlineBefore: "Make shorts people",
    headlineHighlight: "actually",
    headlineAfter: "watch",
    lead: "Create an account and turn any idea into a finished short.",
    navPrompt: "Already creating?",
    navCta: "Sign in",
    submitLabel: "Create account",
    footerPrompt: "Already creating?",
    footerCta: "Sign in",
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_SHOWCASE_CARDS, AuthShowcaseCard,
 *   AUTH_SHOWCASE_PANEL
 *
 * WHAT:  The three fanned 9:16 cards in the desktop showcase panel, left to
 *        right. Index 1 is the centre card — the one a visitor reads.
 * WHY:   Three deliberately different subjects and three different surfaces,
 *        so the panel shows RANGE rather than one template three times. They
 *        are flat colour blocks and not posters on purpose: the landing page
 *        already carries real rendered frames (PRODUCT_AS_PROOF), and an auth
 *        screen that waits on three images before it paints is an auth screen
 *        that feels slow at the exact moment somebody is typing a password.
 * WHERE: ./auth-showcase.tsx.
 */
export const AUTH_SHOWCASE_CARDS: readonly AuthShowcaseCard[] = [
  {
    id: "auth-card-history",
    tag: "History",
    title: "The city that vanished overnight",
    tone: "surface",
  },
  {
    id: "auth-card-science",
    tag: "Science",
    title: "3 hearts. 1 octopus.",
    tone: "accent",
    playing: true,
  },
  {
    id: "auth-card-what-if",
    tag: "What if",
    title: "What if the Moon disappeared?",
    tone: "brand",
  },
];

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_SHOWCASE_COPY, OPERATOR_OWNS_THESE_CLAIMS,
 *   HERO_COPY
 *
 * WHAT:  The panel's two tilted pills, its decorative prompt line, and the
 *        social-proof sentence beneath it.
 * WHY:   Gathered in four adjacent lines, like `HERO_COPY`, so the operator's
 *        unverifiable numbers can be checked and corrected in one place. See
 *        the file header: these MUST stay in step with `HERO_COPY`.
 * WHERE: ./auth-showcase.tsx, and `renderedBadge` again as the mobile top-bar
 *        tag passed to <AuthShell headerTag>.
 */
export const AUTH_SHOWCASE_COPY = {
  /** The pale pill, top-left of the panel. Mobile shows the short form. */
  renderedBadge: "Ready to post in 41s",
  renderedBadgeShort: "41s to post",
  /** The yellow pill, top-right of the panel. */
  footnote: "They can't stop scrolling",
  /** Decoration only — a picture of the hero's field, not a working one. */
  promptPlaceholder: "Why octopuses have three hearts…",
  promptAction: "Generate",
  socialProof: "12,400+ creators · 38M views generated",
} as const;
