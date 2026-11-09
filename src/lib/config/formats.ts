/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: FORMATS, FORMAT_CATEGORIES, FormatCategoryKey,
 *   FormatDefinition, FEATURED_FORMAT_KIND, formatsByCategory,
 *   A_FORMAT_IS_A_PROJECT_KIND, FORMAT_REGISTRY, CREATABLE_PROJECT_KINDS
 *
 * WHAT:  What each video format is CALLED and SOLD AS on the dashboard home
 *        screen — its category, eyebrow, one-line pitch, the call to action,
 *        what it starts from, and the two-character mark on its card.
 *
 * WHY:   A_FORMAT_IS_A_PROJECT_KIND. The home screen is a format picker, and
 *        the formats it may offer are exactly the `ProjectKind`s this app can
 *        create — nothing else. Typing the record as
 *        `Record<ProjectKind, FormatDefinition>` means retiring or adding a
 *        kind fails the typecheck HERE until it has copy, instead of shipping
 *        a card that starts a project the pipeline cannot build, or quietly
 *        dropping a format the product still sells.
 *
 *        IT LIVES IN `lib/config`, not beside the home route, because three
 *        surfaces need the same answer: the home picker, the create-project
 *        sheet (which today has its own private label map), and any future
 *        "new video" screen. A second copy under `_components` is how the
 *        home screen starts calling something a "Reddit story" while the
 *        sheet calls it something else.
 *
 *        `comingSoon` rather than omission, for the one kind outside
 *        `CREATABLE_PROJECT_KINDS`. The motion studio is real and shipped —
 *        it just cannot be the STARTING point of a project yet — so the card
 *        is shown and marked rather than hidden, which is what the design
 *        does with its own unreleased studios. The flag is what the UI reads
 *        to disable the CTA; it is not a second definition of creatability,
 *        and `CREATABLE_PROJECT_KINDS` stays the authority (see the assertion
 *        at the bottom of this file).
 *
 *        CATEGORIES ARE A CLOSED UNION mapped to the `--cat-*` theme tokens,
 *        never to a colour written here, so re-skinning is one edit in
 *        globals.css and a card cannot smuggle in a fifth accent.
 *
 * WHERE: `src/app/(dashboard)/dashboard/_components/*` renders these; the
 *        create-project sheet resolves its format labels from them. Colour
 *        tokens are defined by `.app-canvas` in src/app/globals.css.
 */

import type { CreatableProjectKind, ProjectKind } from "@/lib/types";
import { CREATABLE_PROJECT_KINDS, PROJECT_KINDS } from "@/lib/types";

/**
 * SOURCE OF TRUTH KEYWORDS: FormatCategoryKey, FORMAT_CATEGORIES
 *
 * WHAT:  The groups the home screen sorts formats into, and how each one is
 *        labelled and coloured.
 * WHY:   A closed union so a format cannot invent a category, and a record so
 *        a new category must declare its copy and token together. `token` is
 *        a Tailwind COLOUR NAME rather than a class string: callers compose
 *        `bg-${…}` / `text-${…}` through a lookup of their own, which keeps
 *        this file free of presentation and keeps Tailwind able to see every
 *        class literally at build time.
 * WHERE: `FORMATS` below; the chips and section headings on the home screen.
 */
export const FORMAT_CATEGORIES = {
  explain: { label: "Explain", token: "cat-explain" },
  market: { label: "Market", token: "cat-market" },
  entertain: { label: "Entertain", token: "cat-entertain" },
  music: { label: "Music", token: "cat-music" },
} as const;

export type FormatCategoryKey = keyof typeof FORMAT_CATEGORIES;

/**
 * SOURCE OF TRUTH KEYWORDS: FormatDefinition
 *
 * WHAT:  Everything the picker needs to render one format card.
 * WHERE: The `FORMATS` record below.
 */
export interface FormatDefinition {
  /** On-screen name, e.g. "Reddit story". */
  label: string;
  category: FormatCategoryKey;
  /** Small uppercase label above the title. */
  eyebrow: string;
  /** Two-line pitch. Clamped by the card, so the first clause must carry it. */
  description: string;
  /** The card's action, phrased as what the user is about to do. */
  cta: string;
  /** Sub-label under the title: "from a topic", "from a URL". */
  from: string;
  /** Two characters for the card's media column. */
  mono: string;
  /** True for a kind outside CREATABLE_PROJECT_KINDS — shown, not startable. */
  comingSoon?: boolean;
}

/**
 * SOURCE OF TRUTH KEYWORDS: FORMATS, FORMAT_REGISTRY
 *
 * WHAT:  Every format, keyed by the `ProjectKind` it creates.
 * WHY:   Exhaustive over `ProjectKind` by type, so the compiler is the thing
 *        that notices a missing format rather than a customer.
 * WHERE: The home screen's featured card, grid and sections.
 */
export const FORMATS: Record<ProjectKind, FormatDefinition> = {
  "reddit-story": {
    label: "Reddit story",
    category: "entertain",
    eyebrow: "ENTERTAIN · MOST STARTED",
    description:
      "Paste a thread. The script is written from it, cast to a voice, captioned word by word and cut over background footage.",
    cta: "Start from a URL",
    from: "from a Reddit thread",
    mono: "r/",
  },
  voiceover: {
    label: "Voiceover",
    category: "explain",
    eyebrow: "EXPLAIN",
    description:
      "Start from a topic or your own script. Narration, visuals and captions are assembled into one vertical cut.",
    cta: "Start from a topic",
    from: "from a topic or script",
    mono: "VO",
  },
  quiz: {
    label: "Quiz",
    category: "entertain",
    eyebrow: "ENTERTAIN",
    description:
      "Trivia with countdowns and reveals, timed so the answer lands exactly when the beat does.",
    cta: "Start from a topic",
    from: "from a topic",
    mono: "Q?",
  },
  motion: {
    label: "Motion graphics",
    category: "explain",
    eyebrow: "EXPLAIN · THE STUDIO",
    description:
      "The explainer studio — titles, numbers and diagrams that move with every word, built from motion primitives and a beat strip.",
    cta: "Open the studio",
    from: "from a finished script",
    mono: "MG",
    /* A_FORMAT_NEEDS_A_WRITER: the studio ships, but no writer produces a
     * motion project from scratch yet, so it cannot be a starting point. */
    comingSoon: true,
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: FEATURED_FORMAT_KIND
 *
 * WHAT:  The one format the home screen gives the large hero treatment to.
 * WHY:   A constant rather than "the first one": which format to push is a
 *        product decision that changes with the season, and it should be one
 *        obvious line to edit rather than a reordering of the registry that
 *        also silently reorders every grid.
 * WHERE: The featured panel on the dashboard home screen.
 */
export const FEATURED_FORMAT_KIND: ProjectKind = "reddit-story";

/**
 * SOURCE OF TRUTH KEYWORDS: formatsByCategory
 *
 * WHAT:  The kinds in one category, in registry order.
 * WHY:   The home screen groups by category in two places (the sections and
 *        the chip counts); doing the filter inline in both is how they start
 *        disagreeing about which formats exist.
 * WHERE: The home screen's category sections.
 */
export function formatsByCategory(
  category: FormatCategoryKey,
): readonly ProjectKind[] {
  return PROJECT_KINDS.filter((kind) => FORMATS[kind].category === category);
}

/**
 * SOURCE OF TRUTH KEYWORDS: isStartableFormat, CREATABLE_PROJECT_KINDS
 *
 * WHAT:  Whether a format can begin a new project.
 * WHY:   A TYPE PREDICATE, so a caller that checks it can then hand the kind
 *        to the create form without an assertion — the check and the type
 *        narrowing are the same act.
 *        ONE AUTHORITY. `comingSoon` is copy — it decides how the card READS —
 *        while `CREATABLE_PROJECT_KINDS` decides what the create mutation will
 *        accept. This function asks the authority, so a card marked startable
 *        by a careless edit to `comingSoon` still cannot open a form the
 *        server would refuse.
 * WHERE: Every CTA on the home screen.
 */
export function isStartableFormat(
  kind: ProjectKind,
): kind is CreatableProjectKind {
  return (CREATABLE_PROJECT_KINDS as readonly ProjectKind[]).includes(kind);
}
