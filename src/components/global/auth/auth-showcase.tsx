/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthShowcase, AuthShowcaseProps,
 *   AUTH_SHOWCASE_PANEL, AUTH_SHOWCASE_CARDS, AUTH_SHOWCASE_COPY,
 *   SHOWCASE_IS_DECOR, AuthShowcaseTone, TOKENS_NOT_HEX
 *
 * WHAT:  The panel beside the desktop auth form — two tilted claim pills, a
 *        fan of three 9:16 example cards, a picture of the hero's prompt
 *        field, and the social-proof line.
 *
 * WHY:   An auth screen is the narrowest point of the funnel, and a bare form
 *        on an empty page gives somebody who arrived from an ad nothing to
 *        confirm they are in the right place. This panel is the landing page's
 *        evidence, restated beside the fields.
 *
 *        SHOWCASE_IS_DECOR, and the whole panel is `aria-hidden`. Every claim
 *        on it — the pills, the card titles, the counts — is either repeated
 *        in the form column's headline and lead or is a picture of a control
 *        that does nothing here. A screen reader working through a sign-in
 *        form should reach the email field next, not a fake prompt box; the
 *        decorative prompt is the reason this is a hard rule rather than a
 *        preference. THE PROMPT IS NOT A FORM: the landing page's
 *        <HeroPromptCard> is a real validated field whose submit NAVIGATES to
 *        sign-up, which is either a no-op or a loop on these two routes, so
 *        this draws the same shape with no control in it. Nothing here is
 *        focusable.
 *
 *        TOKENS_NOT_HEX. The three card surfaces come from a closed
 *        `AuthShowcaseTone` union mapped to theme tokens below, never from a
 *        colour passed in by a caller — which is what keeps the panel
 *        re-skinnable from globals.css alone, exactly like the landing page.
 *
 *        HIDDEN BELOW `lg`, not shrunk: the mobile artboards have no panel at
 *        all, and the composition's whole effect is three overlapping cards at
 *        a readable size. Scaled into a 390px column it becomes three stripes.
 *        Hiding it in CSS (rather than branching in the page) keeps ONE
 *        responsive component, which is what implementation note 8 of
 *        auth-design.md asks for.
 *
 * WHERE: Passed as the `aside` of <AuthShell> by src/app/(auth)/sign-in and
 *        /sign-up. Content comes from ./auth-content.ts.
 */

import { ArrowRightIcon, HeartIcon } from "lucide-react";

import type { AuthShowcaseTone } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AUTH_SHOWCASE_CARDS, AUTH_SHOWCASE_COPY } from "./auth-content";

/**
 * SOURCE OF TRUTH KEYWORDS: SHOWCASE_TONE_SURFACES, AuthShowcaseTone,
 *   TOKENS_NOT_HEX
 *
 * WHAT:  How each card tone paints — its fill, its text colour, and the tint
 *        of the small tag pill sitting on it.
 * WHY:   A `Record<AuthShowcaseTone, …>` so adding a tone fails the typecheck
 *        here until it has been given a surface, and so the only colours this
 *        file knows are token names. The tag on a coloured card is a
 *        translucent wash of the card's own foreground rather than a fourth
 *        token: it has to read on yellow and on orange, and `color-mix`
 *        against the foreground already in scope is the one treatment that
 *        does both.
 * WHERE: The card list below.
 */
const SHOWCASE_TONE_SURFACES: Record<
  AuthShowcaseTone,
  { card: string; tag: string; bar: string }
> = {
  surface: {
    card: "bg-surface-raised text-foreground",
    tag: "bg-foreground/10 text-foreground",
    bar: "bg-foreground/80",
  },
  accent: {
    card: "bg-brand-accent text-brand-accent-foreground",
    tag: "bg-brand-accent-foreground/10 text-brand-accent-foreground",
    bar: "bg-brand-accent-foreground/80",
  },
  brand: {
    card: "bg-brand text-brand-foreground",
    tag: "bg-brand-foreground/15 text-brand-foreground",
    bar: "bg-brand-foreground/80",
  },
};

/* The fan. Index-matched to AUTH_SHOWCASE_CARDS: the outer two are tilted away
 * from the centre and pushed down, so the middle card reads as the front one.
 * Written as a list rather than computed from the index because the centre
 * card is also the TALLEST and carries the LARGEST title — the shape is a
 * composition, not a formula.
 *
 * SIZED TO THE PANEL, NOT TO TASTE: the heights plus the largest `translate-y`
 * have to fit between the pill row and the prompt box inside the panel's
 * min-height, or the lowest card slides under the prompt. 348 + 48 = 396,
 * against the ~400px the fan row gets at min-height. Raising either number
 * means raising the panel's `min-h` with it. The outer titles step down a size
 * for the same reason — at `text-xl` a three-line hook ran off the short
 * cards' bottom edge. */
const SHOWCASE_CARD_POSITIONS: readonly { box: string; title: string }[] = [
  {
    box: "-rotate-6 translate-y-8 h-[300px] w-[168px]",
    title: "text-base",
  },
  { box: "rotate-0 h-[348px] w-[188px] z-10", title: "text-xl" },
  {
    box: "rotate-6 translate-y-12 h-[300px] w-[168px]",
    title: "text-base",
  },
];

export interface AuthShowcaseProps {
  className?: string | undefined;
}

export function AuthShowcase({ className }: AuthShowcaseProps) {
  return (
    /* aria-hidden on the ROOT, so nothing inside has to remember it. See
       SHOWCASE_IS_DECOR. */
    <aside
      aria-hidden="true"
      className={cn(
        "brutal-border brutal-shadow-lg relative hidden min-h-[640px] flex-col justify-between overflow-hidden rounded-[2rem] bg-card p-8 lg:flex",
        className,
      )}
    >
      {/* The same halo the landing hero sits in, so the two surfaces catch
          light the same way. */}
      <span className="halo-brand pointer-events-none absolute left-1/2 top-0 -z-0 h-[36rem] w-[44rem] -translate-x-1/2 opacity-30 blur-[60px]" />

      {/* ── The two tilted pills ─────────────────────────────────────────── */}
      <div className="relative flex items-start justify-between gap-4">
        <span className="brutal-shadow inline-flex -rotate-[4deg] items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">
          <span className="size-1.5 rounded-full bg-brand" />
          {AUTH_SHOWCASE_COPY.renderedBadge}
        </span>
        <span className="brutal-shadow inline-block rotate-[4deg] rounded-full bg-brand-accent px-4 py-2 text-sm font-medium text-brand-accent-foreground">
          {AUTH_SHOWCASE_COPY.footnote}
        </span>
      </div>

      {/* ── The fan of three ─────────────────────────────────────────────── */}
      <div className="relative flex flex-1 items-center justify-center">
        <ul className="flex items-center justify-center -space-x-4">
          {AUTH_SHOWCASE_CARDS.map((card, index) => {
            const tone = SHOWCASE_TONE_SURFACES[card.tone];
            const position = SHOWCASE_CARD_POSITIONS[index];

            return (
              <li
                key={card.id}
                className={cn(
                  "brutal-shadow-lg flex flex-col justify-between rounded-3xl p-4",
                  tone.card,
                  position?.box,
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-semibold",
                      tone.tag,
                    )}
                  >
                    {card.tag}
                  </span>
                  {/* Only on the card a visitor is "watching" — three hearts
                      would read as a row of icons rather than a feed. */}
                  {card.playing ? (
                    <HeartIcon className="size-4 opacity-70" />
                  ) : null}
                </div>

                <div className="flex flex-col gap-3">
                  <p
                    className={cn(
                      "font-display font-extrabold leading-[1.05] tracking-tight",
                      position?.title,
                    )}
                  >
                    {card.title}
                  </p>
                  {/* A scrub bar at roughly two thirds: the centre card is
                      mid-play, which is what makes the fan read as a feed
                      rather than three posters. */}
                  {card.playing ? (
                    <span className="h-1 w-full overflow-hidden rounded-full bg-current/20">
                      <span
                        className={cn("block h-full w-2/3 rounded-full", tone.bar)}
                      />
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── The prompt field (a picture of one) and the proof line ───────── */}
      <div className="relative flex flex-col gap-5">
        <div className="brutal-border brutal-shadow flex items-center gap-3 rounded-2xl bg-surface-raised p-2.5">
          <span className="flex-1 truncate px-3 text-base text-muted-foreground">
            {AUTH_SHOWCASE_COPY.promptPlaceholder}
          </span>
          <span className="brutal-shadow-brand inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-brand-foreground">
            {AUTH_SHOWCASE_COPY.promptAction}
            <ArrowRightIcon className="size-4" />
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Three stacked discs in the brand colours — drawn, not
              photographed, for the reason the landing page gives: stock
              headshots of people who are not customers are the oldest lie on
              a landing page. */}
          <span className="flex items-center">
            <span className="size-7 rounded-full border-2 border-card bg-brand-accent" />
            <span className="-ml-2.5 size-7 rounded-full border-2 border-card bg-brand" />
            <span className="-ml-2.5 size-7 rounded-full border-2 border-card bg-foreground" />
          </span>
          <p className="text-sm font-semibold text-muted-foreground">
            {AUTH_SHOWCASE_COPY.socialProof}
          </p>
        </div>
      </div>
    </aside>
  );
}
