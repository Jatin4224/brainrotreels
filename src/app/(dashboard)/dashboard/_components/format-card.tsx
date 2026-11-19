/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: FormatCard, FormatCardProps, FORMATS,
 * CATEGORY_CLASSES, isStartableFormat, COMING_SOON_IS_NOT_A_BUTTON,
 * CARD_IS_ONE_TARGET, COMING_SOON_LOOKS_UNAVAILABLE, THE_ARROW_ANSWERS
 *
 * WHAT: One horizontal format card — a tinted media column with the format's
 * two-character mark, then its eyebrow, title, two-line pitch and the
 * call to action.
 *
 * WHY: CARD_IS_ONE_TARGET. The whole card is the button, not just the CTA
 * line at the bottom: the design draws the arrow as the affordance but
 * people aim at the card, and two nested targets (a card that
 * navigates containing a link that also navigates) is the classic way
 * to ship a nested-interactive accessibility error. So the card is a
 * single <button>, the CTA row is decoration inside it, and the
 * accessible name is the title plus the action.
 *
 * COMING_SOON_IS_NOT_A_BUTTON. A format outside
 * `CREATABLE_PROJECT_KINDS` renders as a non-interactive panel with a
 * badge, not a disabled button — `isStartableFormat` is asked, not
 * the `comingSoon` copy flag, so the registry's authority decides.
 * A disabled control that never becomes enabled only teaches people
 * to keep pressing it.
 *
 * The card takes `onStart` rather than an href because starting a
 * video is a MUTATION behind a form (the create sheet), not a page —
 * the same reason the invitation screen's accept is a button.
 *
 * WHERE: The category sections of the dashboard home screen. Content comes
 * from `FORMATS` (src/lib/config/formats.ts); colours from
 * ./format-tokens.
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
      {/* COMING_SOON_LOOKS_UNAVAILABLE — `opacity-50` rather than a fifth
          entry in CATEGORY_CLASSES. The tint and the glyph are one token pair
          (a `/15` alpha tint under the accent glyph), so dimming the whole
          column keeps them in
          proportion and cannot drift from the accent; a hand-mixed "muted
          explain" would be a fifth value to maintain per category and the one
          most likely to be forgotten when a category is re-skinned. */}
      <span
        aria-hidden="true"
        className={cn(
          "flex w-[104px] shrink-0 items-center justify-center font-display text-[2.125rem] font-extrabold tracking-tight",
          category.media,
          !startable && "opacity-50",
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
              {/* THE_ARROW_ANSWERS. The card lifted a pixel on hover and the
                  one glyph that means "go" sat still — the cheapest premium
                  signal on the screen, unused. 2px of travel, on the same
                  160ms/--ease-settle the app's controls use.

                  `group-hover` and not a hand-written rule: verified to
                  compile inside `@media (hover: hover)` on this Tailwind
                  (4.3), so a tap on a phone cannot leave the arrow parked
                  forward the way an ungated hover would. The `group` class
                  lives only on the startable <button>, so this is inert in
                  the coming-soon branch that shares this markup. */}
              <ArrowRightIcon
                className="size-3.5 transition-transform duration-[160ms] ease-[var(--ease-settle)] group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                aria-hidden="true"
              />
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
    "flex min-h-[180px] overflow-hidden rounded-[20px] border border-border";

  /* COMING_SOON_LOOKS_UNAVAILABLE. `COMING_SOON_IS_NOT_A_BUTTON` above was
     right about the MARKUP and the visuals never followed: an unstartable
     format wore the identical `tactile-raised … bg-card` as its neighbours,
     so it had the same lit top edge, the same contact shadow and the same
     full-contrast glyph as a card that navigates. People aim at it and get
     nothing — the exact failure a disabled button causes, just quieter,
     because here there is not even a cursor change to warn them.
     `tactile-raised` is what makes a surface look picked up off the page, so
     it is the thing to drop; `bg-secondary/40` recedes behind `bg-card`
     rather than standing level with it, and the badge keeps saying why. */
  if (!startable) {
    return (
      <div className={cn(shell, "bg-secondary/40", className)}>{body}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onStart(kind)}
      aria-label={`${format.label} — ${format.cta}`}
      /* Hover per the spec: the border steps up to `--line-strong` and the
         card lifts a hair. `brutal-hover` already owns that pair, including
         its prefers-reduced-motion opt-out, so it is reused rather than
         restated.
         `group` is for the CTA arrow inside `body` — see THE_ARROW_ANSWERS.
         It is on this branch only, which is what keeps the nudge from firing
         on a card that cannot be started. */
      className={cn(
        shell,
        "tactile-raised brutal-hover group cursor-pointer bg-card text-left outline-none focus-ring",
        className,
      )}
    >
      {body}
    </button>
  );
}
