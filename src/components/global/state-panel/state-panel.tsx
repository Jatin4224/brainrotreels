/**
 * SOURCE OF TRUTH KEYWORDS: StatePanel, StatePanelProps, StatePanelTone,
 *   EMPTY_AND_ERROR_ARE_ONE_SHAPE, PANEL_OWNS_THE_CARD, DataTable, RouteError,
 *   EmptyState, ErrorState, py-10 text-center
 *
 * WHAT:  The app's one "there is nothing to show you" surface — a centred
 *        title, an optional sentence under it, an optional icon, and an
 *        optional action. Used for empty lists, failed queries, work in
 *        progress and route-level errors alike.
 *
 * WHY:   EMPTY_AND_ERROR_ARE_ONE_SHAPE. Seven places had written this by hand
 *        and all seven had written the SAME three lines —
 *        `<Card><CardContent className="py-10 text-center text-sm
 *        text-muted-foreground">`, a `font-medium text-foreground` title and a
 *        `mt-1` sentence — in the data table's shell, the script editor
 *        (twice), voice casting, the project preview and the moderation queue.
 *        Identical by eye and unrelated by code, which is the state in which
 *        one of them silently drifts.
 *
 *        It is a `title` + `description` contract rather than a free
 *        `children` node because the drift that mattered was not the chrome,
 *        it was the TYPOGRAPHY: a hand-rolled panel that forgets
 *        `text-foreground` on its first line renders a title the same weight
 *        as its own explanation, and the reader loses the one word that tells
 *        them whether this is normal or broken. `children` still exists for
 *        the rare panel that needs a control inside the body.
 *
 *        PANEL_OWNS_THE_CARD, with `card={false}` as the explicit opt-out for
 *        a caller that is already inside a surface — the padding and the
 *        centring are the part worth sharing even when the chrome is not.
 *
 *        No `"use client"`: it holds no state and no handler, so it renders in
 *        a server component (`not-found.tsx`) and a client one (the error
 *        boundaries) without two versions existing.
 *
 * WHERE: src/components/global/data-table (empty, filtered-empty and error
 *        states), src/components/global/route-error, the app's error.tsx /
 *        not-found.tsx boundaries, and the project editor steps.
 */

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * SOURCE OF TRUTH KEYWORDS: StatePanelTone, TONE_IS_NOT_A_COLOUR_PROP
 *
 * WHAT:  Whether the panel reads as information or as a failure.
 * WHY:   TONE_IS_NOT_A_COLOUR_PROP — a closed union rather than a className,
 *        so "this is an error" is stated once and the token it maps to
 *        (`--destructive`) is chosen here. A caller passing its own red is how
 *        the no-hardcoded-colour rule gets broken one panel at a time.
 * WHERE: StatePanelProps['tone'].
 */
export type StatePanelTone = "default" | "destructive";

export interface StatePanelProps {
  /** The one line that says what this is. Rendered at `text-foreground`. */
  title?: string;
  /**
   * TITLE_IS_A_HEADING_ONLY_WHEN_IT_IS_THE_PAGE. Defaults to `"p"`, which is
   * correct for a panel sitting inside a page that already has its own `h1`
   * — an empty table, a step that has no data yet. Pass `"h1"` when the panel
   * IS the whole page (404, a standalone error boundary): a full page whose
   * only text is a `<p>` gives a screen reader nothing to navigate to, and
   * two `h1`s on one page is the opposite mistake. Mirrors HighlightHeading's
   * `as`.
   */
  titleAs?: "p" | "h1" | "h2";
  /** The sentence under it — what the reader can do, or what went wrong. */
  description?: React.ReactNode;
  /** Decorative, and marked `aria-hidden` here so no caller has to. */
  icon?: LucideIcon;
  /** Buttons or links. Wrapped and centred; wraps to a second row if needed. */
  action?: React.ReactNode;
  /** Small print under the action — a reference code, a support hint. */
  footnote?: React.ReactNode;
  tone?: StatePanelTone;
  /** PANEL_OWNS_THE_CARD — `false` when the caller is already a surface. */
  card?: boolean;
  className?: string;
  /** For a panel that needs a control in the body rather than below it. */
  children?: React.ReactNode;
}

export function StatePanel({
  title,
  titleAs: TitleTag = "p",
  description,
  icon: Icon,
  action,
  footnote,
  tone = "default",
  card = true,
  className,
  children,
}: StatePanelProps) {
  /* `py-10` here rather than on CardContent so the spacing survives
     `card={false}`; CardContent keeps supplying the horizontal gutter from
     the card's own `--card-spacing`. */
  const body = (
    <div
      className={cn(
        "flex flex-col items-center gap-1 py-10 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      {Icon !== undefined ? (
        <Icon
          aria-hidden="true"
          className={cn(
            "mb-1 size-5",
            tone === "destructive" ? "text-destructive" : "text-muted-foreground",
          )}
        />
      ) : null}

      {title !== undefined ? (
        <TitleTag
          className={cn(
            "font-medium",
            tone === "destructive" ? "text-destructive" : "text-foreground",
          )}
        >
          {title}
        </TitleTag>
      ) : null}

      {/* `max-w-prose` because a one-sentence explanation centred across a
          full-width table reads as a banner, not as a sentence. */}
      {description !== undefined ? (
        <p className="max-w-prose text-pretty">{description}</p>
      ) : null}

      {children}

      {action !== undefined ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {action}
        </div>
      ) : null}

      {footnote !== undefined ? (
        <p className="mt-3 text-xs text-muted-foreground">{footnote}</p>
      ) : null}
    </div>
  );

  if (!card) return body;

  return (
    <Card>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
