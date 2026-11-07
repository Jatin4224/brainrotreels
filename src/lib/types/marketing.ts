/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: FaqItem, MarketingFormat, MarketingLink,
 *   MarketingNavColumn, MarketingPipelineRow, MarketingProofClip,
 *   MARKETING_CONTENT_IS_TYPED, FaqAccordion, landing page content
 *
 * WHAT:  The shapes the public marketing pages render their hand-written
 *        content from — question/answer pairs and the sample clips shown as
 *        proof on the landing page.
 *
 * WHY:   MARKETING_CONTENT_IS_TYPED. Everything a marketing page can derive
 *        from a registry already is derived — the steps come from
 *        `PROJECT_FLOW_STEPS`, the feature names and blurbs from `RESOURCES`,
 *        the plans from `PLANS` (COPY_IS_REGISTRY_DERIVED). What is left is
 *        genuinely page-owned prose: an FAQ answer and a sample clip's caption.
 *        Giving that prose a TYPE rather than inlining object literals is what
 *        lets the FAQ accordion be a global component taking data instead of a
 *        component with copy baked into it, and it is the rule for this
 *        codebase besides — custom types live in `lib/types` only.
 *
 *        `id` rather than an array index as the React key, and rather than the
 *        question string: reordering the list must not re-mount the open panel,
 *        and an answer whose question gets reworded must keep its identity so a
 *        deep link to it survives the edit.
 * WHERE: `FaqItem` is the input of `@/components/global/faq-accordion`;
 *        `MarketingProofClip` backs the sample strip in
 *        src/app/(marketing)/_components. Content lives in
 *        src/app/(marketing)/_components/landing-content.ts.
 */

import type { Route } from "next";

import type { ProjectKind } from "./project";

/**
 * SOURCE OF TRUTH KEYWORDS: MarketingLink, MarketingNavColumn,
 *   TYPES_LIVE_IN_LIB_TYPES, LEGAL_IS_NOT_OPTIONAL
 *
 * WHAT:  A labelled destination on a public page, and a titled column of them.
 *
 * WHY:   `href` is `Route`, not `string`, which keeps TYPED_ROUTE_GUARANTEE
 *        intact for a public nav — rename a page directory and the link that
 *        pointed at it fails the build instead of shipping a dead header item,
 *        which is the single most embarrassing bug a marketing page can have.
 *        It costs nothing for the in-page jumps either: `Route` admits a
 *        fragment appended to a known route, so `/#how-it-works` type-checks
 *        against `/` without an assertion. No `as Route` anywhere in this
 *        group, and that is the point — the moment one appears, the guarantee
 *        is gone.
 *
 *        Shared by the footer columns and any future public nav so the shape of
 *        "a list of links under a heading" is defined once, in lib/types, where
 *        this codebase keeps every custom type.
 * WHERE: src/app/(marketing)/_components/marketing-footer.tsx and
 *        marketing-header.tsx.
 */
export interface MarketingLink {
  label: string;
  href: Route;
}

export interface MarketingNavColumn {
  heading: string;
  links: readonly MarketingLink[];
}

/**
 * SOURCE OF TRUTH KEYWORDS: MarketingPipelineRow, HANDLED_FOR_YOU,
 *   PIPELINE_STAGES, WHAT_YOU_DONT_HAVE_TO_DO
 *
 * WHAT:  One line of the "handled for you" list — the job a customer would
 *        otherwise do by hand, and the one-liner saying who does it instead.
 * WHY:   WHAT_YOU_DONT_HAVE_TO_DO is the landing page's strongest claim, so
 *        each row is a separate reviewable fact rather than a paragraph: a
 *        stage that stops being automatic has to be deleted from a list, which
 *        somebody notices, instead of quietly surviving inside prose.
 * WHERE: src/app/(marketing)/_components/landing-content.ts, rendered beside
 *        the step list on the landing page.
 */
export interface MarketingPipelineRow {
  label: string;
  detail: string;
}

export interface FaqItem {
  /** Stable identity — also the DOM id, so an answer can be deep-linked. */
  id: string;
  question: string;
  answer: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: MarketingFormat, A_FORMAT_IS_A_PROJECT_KIND,
 *   PROJECT_KINDS, CREATABLE_PROJECT_KINDS, ProjectKind
 *
 * WHAT:  One product format as the marketing pages sell it — the project kind
 *        behind it, the phrase a visitor recognises it by, and what it turns
 *        into.
 *
 * WHY:   A_FORMAT_IS_A_PROJECT_KIND. `kind` is the SAME union the create form
 *        offers and the pipeline switches on, so a format can only be
 *        advertised if the product actually has a generator for it — retiring
 *        a kind fails the typecheck on the landing page instead of leaving an
 *        advert for something nobody can start. `comingSoon` is how a kind the
 *        system understands but a customer cannot yet START is shown honestly
 *        rather than quietly left out: that is exactly `motion`'s position
 *        today (see CREATABLE_PROJECT_KINDS — it has a studio and a generator
 *        but no script writer).
 *
 *        The WORDS are page-owned on purpose, unlike the feature grid's. A
 *        visitor searches for "Reddit story video", not for the enum member
 *        `reddit-story`, and `RESOURCES[x].description` is written for a usage
 *        meter inside the product. The registry still owns every FEATURE blurb
 *        on the page (COPY_IS_REGISTRY_DERIVED); this type covers the four
 *        format cards only.
 * WHERE: src/app/(marketing)/_components/landing-content.ts, rendered by the
 *        format section of src/app/(marketing)/page.tsx.
 */
export interface MarketingFormat {
  kind: ProjectKind;
  label: string;
  description: string;
  /** Not startable yet — see CREATABLE_PROJECT_KINDS. */
  comingSoon?: boolean | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: MarketingProofClip, PRODUCT_AS_PROOF
 *
 * WHAT:  One 9:16 sample in the landing page's proof strip — what the product
 *        made, which format made it, and how long it runs.
 * WHY:   PRODUCT_AS_PROOF. The landing page's only imagery is real output, so
 *        the strip needs the facts a viewer judges output by: the format it
 *        came from (`kind`, the SAME union the pipeline writes to a project, so
 *        a retired format cannot be advertised) and the runtime. `poster` is
 *        optional because a fresh deployment has no renders to show yet, and a
 *        landing page that 404s its own images is worse than one that paints
 *        the format tag over an empty frame.
 * WHERE: src/app/(marketing)/_components/proof-strip.tsx.
 */
export interface MarketingProofClip {
  id: string;
  title: string;
  /** The product format that produced it — see PROJECT_KINDS. */
  kind: ProjectKind;
  /** Runtime as a timecode, e.g. `0:38`. */
  duration: string;
  /** Poster image URL, when the deployment has one to show. */
  poster?: string | undefined;
}
