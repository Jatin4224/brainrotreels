/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthShowcase, AuthShowcaseProps,
 *   AUTH_MESSAGE_PANEL, AUTH_PANEL_COPY, PANEL_IS_THE_PITCH,
 *   HIGHLIGHT_IS_A_BLOCK, brand-highlight, TOKENS_NOT_HEX
 *
 * WHAT:  The panel beside the desktop auth form — the product's headline, the
 *        paragraph under it, and the social-proof line, on a raised card.
 *
 * WHY:   PANEL_IS_THE_PITCH. An auth screen is the narrowest point of the
 *        funnel, and a bare form on an empty page gives somebody who arrived
 *        from an ad nothing to confirm they are in the right place. The panel
 *        repeats the landing hero's claim beside the fields, which is also
 *        what lets the form column open with a plain "Welcome back" instead
 *        of a second display headline (TWO_HEADINGS_ONE_SCREEN in AuthHero).
 *
 *        WORDS, NOT PROPS. An earlier version of this panel was a fan of
 *        three fake 9:16 cards over a picture of the hero's prompt field.
 *        It drew the eye away from the form it was supposed to support, every
 *        element on it was decoration a screen reader had to be told to skip,
 *        and the fan's geometry had to be re-tuned whenever the panel's
 *        height moved. One headline and one paragraph say the same thing,
 *        survive any height, and need no maintenance.
 *
 *        STILL DECOR, so the panel stays `aria-hidden`: every word on it is
 *        the landing page's pitch, which a visitor reached this screen FROM,
 *        and a screen reader working through a sign-in form should arrive at
 *        the email field next rather than at a repeat of the advert.
 *
 *        HIGHLIGHT_IS_A_BLOCK and TOKENS_NOT_HEX, both reused rather than
 *        restated: `.brand-highlight` and `bg-card` / `text-muted-foreground`
 *        resolve against `.marketing-canvas`, which AuthShell applies, so
 *        re-skinning this panel is one edit in globals.css.
 *
 *        HIDDEN BELOW `lg`, not shrunk: the mobile artboards have no panel at
 *        all, and below that width the form column carries the headline
 *        itself. Hiding it in CSS rather than branching in the page keeps ONE
 *        responsive component, which is what auth-design.md §8 asks for.
 *
 * WHERE: Passed as the `aside` of <AuthShell> by src/app/(auth)/sign-in and
 *        /sign-up. Content comes from ./auth-content.ts.
 */

import { cn } from "@/lib/utils";

import { AUTH_PANEL_COPY } from "./auth-content";

export interface AuthShowcaseProps {
  className?: string | undefined;
}

export function AuthShowcase({ className }: AuthShowcaseProps) {
  return (
    /* aria-hidden on the ROOT, so nothing inside has to remember it. */
    <aside
      aria-hidden="true"
      className={cn(
        "brutal-border relative hidden h-full flex-col justify-center overflow-hidden rounded-[2rem] bg-card p-12 xl:p-16 lg:flex",
        className,
      )}
    >
      {/* The same halo the landing hero sits in, so the two surfaces catch
          light the same way. */}
      <span className="halo-brand pointer-events-none absolute left-1/2 top-1/4 -z-0 h-[36rem] w-[44rem] -translate-x-1/2 opacity-25 blur-[60px]" />

      <div className="relative max-w-[34rem]">
        <p className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground xl:text-6xl">
          {AUTH_PANEL_COPY.headlineBefore}{" "}
          <span className="relative inline-block px-3 py-0.5">
            <span className="brand-highlight absolute inset-0 rounded-md" />
            <span className="relative text-brand-accent-foreground">
              {AUTH_PANEL_COPY.headlineHighlight}
            </span>
          </span>{" "}
          {AUTH_PANEL_COPY.headlineAfter}
        </p>

        <p className="mt-8 text-lg leading-relaxed text-muted-foreground">
          {AUTH_PANEL_COPY.lead}
        </p>

        {/* The one bold word is the number, not the sentence — it is the part
            a visitor actually reads. */}
        <p className="mt-10 text-base text-muted-foreground">
          <span className="font-bold text-foreground">
            {AUTH_PANEL_COPY.socialProof.split("·")[0]?.trim()}
          </span>
          {` · ${AUTH_PANEL_COPY.socialProof.split("·")[1]?.trim() ?? ""}`}
        </p>
      </div>
    </aside>
  );
}
