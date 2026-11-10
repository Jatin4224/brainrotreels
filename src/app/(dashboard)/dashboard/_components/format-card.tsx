/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: FormatCard, FormatCardProps, FORMATS,
 *   CATEGORY_CLASSES, isStartableFormat, COMING_SOON_IS_NOT_A_BUTTON,
 *   CARD_IS_ONE_TARGET
 *
 * WHAT:  One horizontal format card — a tinted media column with the format's
 *        two-character mark, then its eyebrow, title, two-line pitch and the
 *        call to action.
 *
 * WHY:   CARD_IS_ONE_TARGET. The whole card is the button, not just the CTA
 *        line at the bottom: the design draws the arrow as the affordance but
 *        people aim at the card, and two nested targets (a card that
 *        navigates containing a link that also navigates) is the classic way
 *        to ship a nested-interactive accessibility error. So the card is a
 *        single <button>, the CTA row is decoration inside it, and the
 *        accessible name is the title plus the action.
 *
 *        COMING_SOON_IS_NOT_A_BUTTON. A format outside
 *        `CREATABLE_PROJECT_KINDS` renders as a non-interactive panel with a
 *        badge, not a disabled button — `isStartableFormat` is asked, not
 *        the `comingSoon` copy flag, so the registry's authority decides.
 *        A disabled control that never becomes enabled only teaches people
 *        to keep pressing it.
 *
 *        The card takes `onStart` rather than an href because starting a
 *        video is a MUTATION behind a form (the create sheet), not a page —
 *        the same reason the invitation screen's accept is a button.
 *
 * WHERE: The category sections of the dashboard home screen. Content comes
 *        from `FORMATS` (src/lib/config/formats.ts); colours from
 *        ./format-tokens.
 */

import { ArrowRightIcon } from "lucide-react";

import { FORMATS, isStartableFormat } from "@/lib/config";
import type { ProjectKind } from "@/lib/types";
import { cn } from "@/lib/utils";

import { CATEGORY_CLASSES } from "./format-tokens";

export interface FormatCardProps {
  kind: ProjectKind;
  /** Opens the create sheet with this format preselected. */
  onStart: (kind: ProjectKind) => void;
  className?: string | undefined;
}

export function FormatCard({ kind, onStart, className }: FormatCardProps) {
  const format = FORMATS[kind];
  const category = CATEGORY_CLASSES[format.category];
  const startable = isStartableFormat(kind);

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex w-[104px] shrink-0 items-center justify-center font-display text-[2.125rem] font-extrabold tracking-tight",
          category.media,
        )}
      >
        {format.mono}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-[18px] text-left">
        <span
          className={cn(
            "text-[11px] font-bold tracking-[0.1em]",
            category.text,
          )}
        >
          {format.eyebrow}
        </span>
        <span className="text-[17px] font-bold text-foreground">
          {format.label}
        </span>
        {/* Two lines, clamped: the pitch has to survive a format whose copy
            someone later doubles in length without shifting the grid. */}
        <span className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {format.description}
        </span>
        <span className="mt-auto flex items-center gap-1.5 pt-2 text-sm font-bold text-foreground">
          {startable ? (
            <>
              {format.cta}
              <ArrowRightIcon className="size-3.5" aria-hidden="true" />
            </>
          ) : (
            <span className="rounded-full border border-border-strong px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              Coming soon
            </span>
          )}
        </span>
      </span>
    </>
  );

  const shell =
    "tactile-raised flex min-h-[180px] overflow-hidden rounded-[20px] border border-border bg-card";

  if (!startable) {
    return <div className={cn(shell, className)}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onStart(kind)}
      aria-label={`${format.label} — ${format.cta}`}
      /* Hover per the spec: the border steps up to `--line-strong` and the
         card lifts a hair. `brutal-hover` already owns that pair, including
         its prefers-reduced-motion opt-out, so it is reused rather than
         restated. */
      className={cn(
        shell,
        "brutal-hover cursor-pointer text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {body}
    </button>
  );
}
