/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ScrollRevealObserver, data-reveal,
 *   data-reveal-armed, reveal-rise, SECTIONS_ASSEMBLE_TOO,
 *   NOTHING_HIDES_WITHOUT_JS, REVEAL_FIRES_ONCE, IntersectionObserver
 *
 * WHAT:  The one client component behind the lower page's scroll entrance. It
 *        renders NOTHING: it arms the document and flips
 *        `data-reveal="pending"` to `"shown"` on each marked container the
 *        first time that container reaches the viewport.
 *
 * WHY:   ONE OBSERVER, NOT A WRAPPER PER SECTION. The alternative was a
 *        polymorphic <ScrollReveal> element around every list, which adds a
 *        DOM node and a client boundary per section and makes the landing
 *        page — a Server Component with no tRPC, no headers() and no cookie
 *        read (PUBLIC_PAGE_NO_AUTH) — hand three of its sections to the
 *        client. Mounted once in the group layout instead, a section opts in
 *        with two attributes and the page stays a server component. Any
 *        future public section, on any page in the group, is one `data-reveal`
 *        away from the same entrance.
 *
 *        REVEAL_FIRES_ONCE. `unobserve` on the first intersection, so a
 *        visitor scrolling back up the page does not watch the cards fade
 *        out and in again. This is the whole reason the entrance is not
 *        `animation-timeline: view()`, which is bidirectional by
 *        construction — see `reveal-rise` in globals.css.
 *
 *        NOTHING_HIDES_WITHOUT_JS, and the order in the effect is the rule.
 *        The hidden state is scoped to `html[data-reveal-armed]`, which only
 *        this component sets, so a failed, blocked or disabled bundle leaves
 *        every section rendering exactly as it does today. Arming and marking
 *        what is ALREADY on screen happen in the SAME task, before the
 *        browser can recompute style, so an element that has been painted
 *        visible can never blink back out at hydration — the thing that makes
 *        most scroll reveals flash.
 *
 *        `useEffect`, not `useLayoutEffect`: this renders on the server too,
 *        where a layout effect only earns a warning. Nothing here needs to
 *        run before the hydration paint, because that paint is the
 *        UNARMED one.
 *
 *        No `prefers-reduced-motion` branch in here on purpose. The setting
 *        changes the MOTION, not whether the reveal happens, and CSS already
 *        answers it (fade kept, travel dropped) — reading the media query in
 *        JS as well would be the same decision in two places, and the one in
 *        JS would not follow a visitor who changes the setting mid-visit.
 * WHERE: Mounted once by src/app/(marketing)/layout.tsx. Drives
 *        `.reveal-rise` in src/app/globals.css, used by the format, feature
 *        and plan lists in src/app/(marketing)/page.tsx.
 */

"use client";

import * as React from "react";

/** The attribute a section opts in with, and the two states it holds. */
const REVEAL_ATTR = "data-reveal";
const PENDING = "pending";
const SHOWN = "shown";

/** Set on <html> while the hidden state is safe to apply. */
const ARMED_ATTR = "data-reveal-armed";

/**
 * Fires when the container's top has crossed a tenth of the way up from the
 * bottom of the viewport, so a section starts as its first row clears the fold
 * rather than waiting for the whole thing.
 *
 * A ROOT MARGIN and not a `threshold`, because the ratio an observer reports
 * is of the TARGET's area: a list taller than the viewport can never reach a
 * given fraction of itself, so a threshold silently stops firing on exactly
 * the sections most worth revealing — the eight-row feature list on a phone.
 */
const REVEAL_MARGIN = "0px 0px -10% 0px";

export function ScrollRevealObserver() {
  React.useEffect(() => {
    const pending = Array.from(
      document.querySelectorAll(`[${REVEAL_ATTR}="${PENDING}"]`),
    );

    if (pending.length === 0) return;

    const root = document.documentElement;
    root.setAttribute(ARMED_ATTR, "");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute(REVEAL_ATTR, SHOWN);
          /* REVEAL_FIRES_ONCE. */
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: REVEAL_MARGIN },
    );

    for (const element of pending) {
      /* Already on screen in the paint the visitor is looking at — shown now,
         in this same task, so it is never styled hidden at all. */
      if (element.getBoundingClientRect().top < window.innerHeight) {
        element.setAttribute(REVEAL_ATTR, SHOWN);
        continue;
      }

      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      root.removeAttribute(ARMED_ATTR);
    };
  }, []);

  return null;
}
