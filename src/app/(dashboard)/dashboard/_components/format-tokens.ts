/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: CATEGORY_CLASSES, CategoryClasses,
 *   FormatCategoryKey, TOKENS_NOT_HEX, TAILWIND_SEES_EVERY_CLASS
 *
 * WHAT:  How each format category paints — its dot, its eyebrow text, the
 *        tinted media column on a card, and the solid fill for a chip.
 *
 * WHY:   TAILWIND_SEES_EVERY_CLASS, which is the whole reason this is a
 *        lookup table and not `` `bg-${category.token}` ``. Tailwind scans
 *        source text for complete class names; an interpolated one is never
 *        generated, so the dots and eyebrows would come out unstyled in a
 *        production build while working perfectly in dev. Writing all four
 *        variants out literally is what makes them survive the build.
 *
 *        TOKENS_NOT_HEX: every class resolves to a `--cat-*` theme token
 *        defined by `.app-canvas` in globals.css, so the categories can be
 *        re-skinned in one place and a card can never smuggle in a colour.
 *        The tint is a `/15` alpha of the same token rather than a fifth
 *        hand-mixed value, so it tracks its accent by definition.
 *
 *        It is a `Record<FormatCategoryKey, …>`, so adding a category to the
 *        registry fails the typecheck here until it has been given a look.
 *
 * WHERE: The format cards, chips and section headings under
 *        src/app/(dashboard)/dashboard/_components/. The categories
 *        themselves are declared in src/lib/config/formats.ts.
 */

import type { FormatCategoryKey } from "@/lib/config";

export interface CategoryClasses {
  /** The small rounded square beside a chip label or a section heading. */
  dot: string;
  /** The uppercase label above a card title. */
  text: string;
  /** The card's left media column: tinted background plus accent glyph. */
  media: string;
}

export const CATEGORY_CLASSES: Record<FormatCategoryKey, CategoryClasses> = {
  explain: {
    dot: "bg-cat-explain",
    text: "text-cat-explain",
    media: "bg-cat-explain/15 text-cat-explain",
  },
  market: {
    dot: "bg-cat-market",
    text: "text-cat-market",
    media: "bg-cat-market/15 text-cat-market",
  },
  entertain: {
    dot: "bg-cat-entertain",
    text: "text-cat-entertain",
    media: "bg-cat-entertain/15 text-cat-entertain",
  },
  music: {
    dot: "bg-cat-music",
    text: "text-cat-music",
    media: "bg-cat-music/15 text-cat-music",
  },
};
