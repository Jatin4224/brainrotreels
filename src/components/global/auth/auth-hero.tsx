/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthHero, AuthHeroProps, AUTH_SCREEN_COPY,
 *   HIGHLIGHT_IS_A_BLOCK, brand-highlight, THE_HEADLINE_IS_SPLIT, AUTH_SURFACE
 *
 * WHAT:  The words above the auth form — the yellow badge, the display
 *        headline with one phrase set into a tilted block, and the lead
 *        sentence. The lead is desktop-only.
 *
 * WHY:   AUTH_SURFACE. The sign-in and sign-up screens are the first room of
 *        the product and they inherit the landing page's design language
 *        (MARKETING_DESIGN_LANGUAGE in globals.css) rather than inventing a
 *        second one — the same `font-display` face, the same `brand-highlight`
 *        block, the same tokens. A visitor who presses "Get started" should
 *        not feel they have arrived somewhere else.
 *
 *        HIGHLIGHT_IS_A_BLOCK, reusing `.brand-highlight` from globals.css
 *        rather than restating the tilt and the hard offset shadow: the hero
 *        already owns that treatment, and a second copy is how the two drift
 *        apart by a degree. It is sized from the phrase it wraps, so rewording
 *        the headline cannot leave the block the wrong width, and it is
 *        `aria-hidden` — the sentence still reads as one sentence.
 *
 *        PROVIDER_NEUTRAL: pure presentation, no auth client, no session. It
 *        sits in `components/global/auth` beside AuthShell and AuthError, so
 *        swapping the auth provider cannot change what the screen SAYS.
 *
 *        The lead is hidden below `lg` because the mobile artboards drop it:
 *        at 390px the headline, the social buttons and two fields already fill
 *        the screen above the fold, and a sentence between the headline and
 *        the first control is the thing that pushes the CTA out of reach.
 *
 * WHERE: Rendered at the top of the form column by the (auth) sign-in and
 *        sign-up pages, above <AuthForm>. Copy comes from ./auth-content.ts.
 */

import { PlayIcon } from "lucide-react";

import type { AuthFormMode } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AUTH_SCREEN_COPY } from "./auth-content";

export interface AuthHeroProps {
  mode: AuthFormMode;
  className?: string | undefined;
}

export function AuthHero({ mode, className }: AuthHeroProps) {
  const copy = AUTH_SCREEN_COPY[mode];

  return (
    <div className={cn("flex flex-col items-start text-left", className)}>
      {/* Desktop only: the mobile artboards replace the badge with the small
          tilted tag beside the wordmark, which AuthShell renders. Two pills
          saying different things in the same 390px column reads as clutter. */}
      <span className="brutal-border brutal-shadow-sm mb-6 hidden items-center gap-2 rounded-full bg-brand-accent px-4 py-1.5 text-sm font-bold tracking-tight text-brand-accent-foreground lg:inline-flex">
        <PlayIcon className="size-3.5 fill-current" aria-hidden="true" />
        {copy.badge}
      </span>

      <h1 className="font-display text-[2.75rem] font-extrabold leading-[0.98] tracking-tight text-foreground lg:text-6xl">
        {copy.headlineBefore}{" "}
        <span className="relative inline-block px-3 py-0.5">
          <span
            aria-hidden="true"
            className="brand-highlight absolute inset-0 rounded-md"
          />
          <span className="relative text-brand-accent-foreground">
            {copy.headlineHighlight}
          </span>
        </span>
        {copy.headlineAfter ? ` ${copy.headlineAfter}` : null}
      </h1>

      <p className="mt-6 hidden max-w-md text-lg leading-relaxed text-muted-foreground lg:block">
        {copy.lead}
      </p>
    </div>
  );
}
