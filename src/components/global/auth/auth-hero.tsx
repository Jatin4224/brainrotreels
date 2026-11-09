/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthHero, AuthHeroProps, AUTH_SCREEN_COPY,
 *   TWO_HEADINGS_ONE_SCREEN, HIGHLIGHT_IS_A_BLOCK, brand-highlight,
 *   AUTH_SURFACE
 *
 * WHAT:  The words above the auth form. Two of them, and exactly one shows at
 *        a time: below `lg` a display headline with one phrase set into a
 *        tilted yellow block; at `lg` and up a compact "Welcome back" plus one
 *        line of lead.
 *
 * WHY:   TWO_HEADINGS_ONE_SCREEN. At `lg` the pitch is on the panel beside
 *        the form (<AuthShowcase>), which carries the big display headline —
 *        a second one in the form column would be two things shouting across
 *        the same screen, and the form column's job there is to get somebody
 *        into their account. Below `lg` the panel is gone, so the form column
 *        has to carry the pitch itself and wears the display headline
 *        instead. Both live here, swapped by one `lg:` pair, because they are
 *        the same slot at two widths — ONE_RESPONSIVE_COMPONENT, per
 *        auth-design.md §8. Rendering both and hiding one costs a few bytes
 *        of markup and buys an exact server-rendered first paint; measuring
 *        the width in JS to choose would flicker on the one screen that must
 *        not.
 *
 *        HIGHLIGHT_IS_A_BLOCK, reusing `.brand-highlight` from globals.css
 *        rather than restating the tilt and the hard offset shadow: the
 *        landing hero already owns that treatment, and a second copy is how
 *        the two drift apart by a degree. It is sized from the phrase it
 *        wraps, so rewording cannot leave the block the wrong width, and it
 *        is `aria-hidden` — the sentence still reads as one sentence.
 *
 *        PROVIDER_NEUTRAL: pure presentation, no auth client, no session. It
 *        sits in `components/global/auth` beside AuthShell and AuthError, so
 *        swapping the auth provider cannot change what the screen SAYS.
 *
 * WHERE: Rendered at the top of the form column by the (auth) sign-in and
 *        sign-up pages, above <AuthForm>. Copy comes from ./auth-content.ts.
 */

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
      {/* Below lg: the pitch, because nothing else on screen is carrying it. */}
      <h1 className="font-display text-[2.75rem] font-extrabold leading-[0.98] tracking-tight text-foreground lg:hidden">
        {copy.mobileHeadlineBefore}{" "}
        <span className="relative inline-block px-3 py-0.5">
          <span
            aria-hidden="true"
            className="brand-highlight absolute inset-0 rounded-md"
          />
          <span className="relative text-brand-accent-foreground">
            {copy.mobileHeadlineHighlight}
          </span>
        </span>
        {copy.mobileHeadlineAfter ? ` ${copy.mobileHeadlineAfter}` : null}
      </h1>

      {/* lg and up: plain and quiet, because the panel is doing the talking. */}
      <div className="hidden lg:block">
        <h1 className="font-display text-[2.5rem] font-extrabold leading-tight tracking-tight text-foreground">
          {copy.title}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">{copy.lead}</p>
      </div>
    </div>
  );
}
