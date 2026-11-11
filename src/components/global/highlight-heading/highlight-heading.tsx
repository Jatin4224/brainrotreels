/**
 * SOURCE OF TRUTH KEYWORDS: HighlightHeading, HighlightHeadingProps,
 *   brand-highlight, HIGHLIGHT_IS_A_BLOCK, TRAILING_CLEARS_THE_SHADOW,
 *   DECORATION_IS_HIDDEN, HIGHLIGHT_RADIUS
 *
 * WHAT:  A heading with one word set into the tilted brand-yellow block.
 *
 * WHY:   This construct — a positioned wrapper, a decorative `.brand-highlight`
 *        layer and the word above it — was copy-pasted into FIVE headings
 *        (both auth screens, the landing hero, the dashboard home and the
 *        composer), and the copies had already drifted:
 *
 *          - one was missing `aria-hidden` on the decorative layer, so an
 *            empty presentational span was exposed to assistive tech;
 *          - the radius had split two ways, `rounded-md` and `rounded-xl`,
 *            with nothing recording which was intended where;
 *          - the two dashboard copies carried a hand-added spacer span for the
 *            trailing "?", duplicated comment and all.
 *
 *        TRAILING_CLEARS_THE_SHADOW is the reason that spacer existed and the
 *        reason this component owns it. `.brand-highlight` casts a hard 6px
 *        offset shadow. Where a WORD follows the block, the word-space clears
 *        it; where PUNCTUATION follows, it is set flush and lands on top of
 *        the shadow. That shipped, and was reported as a visual bug. Passing
 *        `trailing` is now the only way to put punctuation after the block,
 *        and the clearance comes with it — so the bug cannot be reintroduced
 *        by someone who has never heard of it.
 *
 *        DECORATION_IS_HIDDEN: the block is `aria-hidden` here, once, rather
 *        than at five call sites where it can be forgotten — as it was. The
 *        sentence still reads as one sentence to a screen reader.
 *
 * WHERE: auth-hero, auth-showcase, the marketing hero, the dashboard home
 *        screen and the new-video composer.
 */

import { cn } from "@/lib/utils"

export interface HighlightHeadingProps {
  /** Text before the highlighted word. A space is inserted after it. */
  before: string
  /** The word set into the block. */
  highlight: string
  /** A word AFTER the block. A space is inserted before it. */
  after?: string | undefined
  /**
   * Punctuation that belongs to the sentence and hugs the block — "?", "!".
   * Rendered with the clearance the block's offset shadow needs; see
   * TRAILING_CLEARS_THE_SHADOW.
   */
  trailing?: string | undefined
  /**
   * HIGHLIGHT_RADIUS. `md` on the marketing and auth screens, whose headings
   * are set tighter; `xl` on the dashboard, whose headings are larger and
   * whose surfaces are rounder.
   */
  radius?: "md" | "xl"
  /** The element to render. Headings are h1 by default; the auth panel is a p. */
  as?: "h1" | "h2" | "p"
  className?: string
}

export function HighlightHeading({
  before,
  highlight,
  after,
  trailing,
  radius = "md",
  as: Tag = "h1",
  className,
}: HighlightHeadingProps) {
  return (
    <Tag className={className}>
      {before}{" "}
      <span className="relative inline-block px-3 py-0.5">
        <span
          aria-hidden="true"
          className={cn(
            "brand-highlight absolute inset-0",
            radius === "xl" ? "rounded-xl" : "rounded-md"
          )}
        />
        <span className="relative text-brand-accent-foreground">
          {highlight}
        </span>
      </span>
      {/* The gap is the shadow's own 6px offset plus air, and it is a margin on
          the PUNCTUATION rather than padding inside the block — padding would
          move the yellow away from the word it is highlighting, which is the
          one thing the block has to stay tight to. */}
      {trailing !== undefined ? (
        <span className="ml-3">{trailing}</span>
      ) : null}
      {after !== undefined ? <> {after}</> : null}
    </Tag>
  )
}
