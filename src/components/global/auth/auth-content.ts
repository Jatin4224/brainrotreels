/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_SCREEN_COPY, AUTH_PANEL_COPY,
 *   AUTH_MOBILE_TAG, AUTH_SHOWCASE_REELS, AUTH_SHOWCASE_SOURCE,
 *   AuthScreenCopy, AuthPanelCopy, AuthShowcaseReel, AuthShowcaseSource,
 *   AuthFormMode,
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
  AuthShowcaseReel,
  AuthShowcaseSource,
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
 *
 *        ⚠ THE MIRROR IS DELIBERATELY BROKEN as of the animated panel. The
 *        headline and lead now CAPTION the animation above them — a document
 *        going in and five reels coming out — rather than restating the
 *        landing hero word for word, because a caption that describes
 *        something other than what is moving beside it is worse than no
 *        caption. `socialProof` is still the hero's line verbatim and MUST
 *        stay that way: it is the one claim a visitor sees twice inside a
 *        single click, and two different numbers across that click is the
 *        failure the pairing guards against.
 * WHERE: ./auth-showcase.tsx.
 */
export const AUTH_PANEL_COPY: AuthPanelCopy = {
  headlineBefore: "One PDF in.",
  headlineHighlight: "Five reels",
  headlineAfter: "out.",
  lead: "Drop a report, script or doc. Get motion-graphics reels with voice, captions and editing handled.",
  socialProof: "12,400+ creators · 38M views generated",
};

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_SHOWCASE_SOURCE, AuthShowcaseSource,
 *   AUTH_SHOWCASE_REELS, SHOWCASE_IS_DATA, PDF card, Make reels
 *
 * WHAT:  The document that slides into the bar at the top of the animated
 *        panel, and the words on the bar it lands in.
 * WHY:   One sample, named once. The file name is also the subject of every
 *        reel in `AUTH_SHOWCASE_REELS` below ("Q3", "+38% revenue"), so the
 *        two have to be edited together to keep the panel telling one story —
 *        which is an argument for them being neighbours in one file, not for
 *        inlining either into the markup.
 *
 *        `placeholder` repeats the landing hero's own prompt field, trimmed
 *        to what fits a 380px bar; it is the product's real first screen,
 *        which is the whole point of showing it here.
 * WHERE: ./auth-showcase.tsx.
 */
export const AUTH_SHOWCASE_SOURCE: AuthShowcaseSource = {
  kind: "PDF",
  fileName: "q3-growth-report.pdf",
  meta: "12 pages · 2.4 MB",
  placeholder: "Drop a PDF or script and …",
  action: "Make reels",
};

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_SHOWCASE_REELS, AuthShowcaseReel,
 *   AuthShowcaseReelTone, SHOWCASE_IS_DATA, AUTH_SHOWCASE_SOURCE
 *
 * WHAT:  The five reels that fan out from under the bar, in strip order.
 *
 * WHY:   FIVE, in this order, is load-bearing rather than a list that happens
 *        to have five entries: the strip is five 100px cards touching, the
 *        middle card is the one the stack grows out of, and the per-card
 *        keyframes (`auth-reel-0` … `auth-reel-4` in globals.css) are written
 *        against those five positions. Adding a sixth means a sixth keyframe
 *        set and a re-measured strip, so ./auth-showcase.test.ts asserts the
 *        length rather than letting a content edit quietly break the
 *        animation.
 *
 *        They read as ONE document cut into parts — PART 1…5, one subject per
 *        card, the kicker carrying the sequence — because that is the claim
 *        the panel is making: a report goes in, a series comes out. Five
 *        unrelated sample reels would show the same cards and say nothing.
 *
 *        The scores are the operator's sample figures (OPERATOR_OWNS_THESE_
 *        CLAIMS). They sit in the 90s deliberately: this is a mockup of a
 *        good result, and a mockup showing a 41 would be advertising the
 *        failure case.
 * WHERE: ./auth-showcase.tsx, which maps `tone` onto the strip's token
 *        classes.
 */
export const AUTH_SHOWCASE_REELS: readonly AuthShowcaseReel[] = [
  {
    id: "part-1",
    platform: "YT",
    kicker: "PART 1",
    title: "Q3 in 60 seconds",
    caption: "the short version",
    score: 98,
    tone: "paper",
  },
  {
    id: "part-2",
    platform: "IG",
    kicker: "PART 2",
    title: "+38% revenue",
    caption: "where it came from",
    score: 96,
    tone: "teal",
  },
  {
    id: "part-3",
    platform: "in",
    kicker: "PART 3",
    title: "3 big wins",
    caption: "and why they worked",
    score: 99,
    tone: "amber",
  },
  {
    id: "part-4",
    platform: "TT",
    kicker: "PART 4",
    title: "What broke",
    caption: "the honest bit",
    score: 94,
    tone: "plum",
  },
  {
    id: "part-5",
    platform: "X",
    kicker: "PART 5",
    title: "What's next",
    caption: "our Q4 bets",
    score: 97,
    tone: "ember",
  },
];

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
