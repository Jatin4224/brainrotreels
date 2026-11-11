/**
 * SOURCE OF TRUTH KEYWORDS: AuthShowcase, AUTH_SHOWCASE_REELS,
 *   AUTH_SHOWCASE_SOURCE, STAGE_IS_DECOR, SHOWCASE_IS_A_LOOP,
 *   auth-anim-reel-0, auth-showcase tests
 *
 * WHAT:  Render test for the animated auth panel — it is rendered to static
 *        markup and asserted on the three things that are not visible in a
 *        code review: that the decorative stage is hidden from assistive
 *        technology and holds nothing focusable, that every reel in the
 *        content array actually reaches the strip with its own keyframe
 *        class, and that the readable caption survives.
 *
 * WHY:   The panel is `aria-hidden` decoration wrapped around the one piece
 *        of copy on this half of the screen that is NOT decoration, and the
 *        two are one edit apart. A `<button>` for the fake "Make reels" pill,
 *        or an `aria-hidden` that creeps back onto the whole panel, both look
 *        harmless in a diff and both are defects — one puts a dead tab stop
 *        between the form and the page footer, the other deletes the pitch
 *        from the accessibility tree.
 *
 *        The reel/keyframe pairing is asserted because the animation's x
 *        offsets are the strip's geometry: a sixth reel added to
 *        AUTH_SHOWCASE_REELS has no keyframes of its own and would silently
 *        render on top of the first one, which this catches at `npm test`
 *        rather than in a screenshot.
 *
 *        `renderToStaticMarkup` and not a DOM testing library: the suite runs
 *        in the `node` environment with no jsdom and no @testing-library
 *        (vitest.config.mts), and this component's effects — the
 *        IntersectionObserver pause — are a browser concern that a render
 *        test could not observe anyway.
 * WHERE: Run by `npm test`. Covers ./auth-showcase.tsx and ./auth-content.ts.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AUTH_PANEL_COPY, AUTH_SHOWCASE_REELS } from "./auth-content";
import { AuthShowcase } from "./auth-showcase";

const markup = renderToStaticMarkup(createElement(AuthShowcase));

/* React escapes text nodes on the way out, so copy carrying an apostrophe
 * ("What's next") is `What&#x27;s next` in the markup. Compare like for like
 * rather than weakening the assertions to substrings that avoid it. */
function escaped(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

describe("AuthShowcase", () => {
  it("renders every reel from the content array", () => {
    for (const reel of AUTH_SHOWCASE_REELS) {
      expect(markup).toContain(escaped(reel.title));
      expect(markup).toContain(escaped(reel.kicker));
      expect(markup).toContain(String(reel.score));
    }
  });

  /* The strip's geometry lives in the keyframes, one set per position. */
  it("gives each reel its own keyframe class", () => {
    AUTH_SHOWCASE_REELS.forEach((_, index) => {
      expect(markup).toContain(`auth-anim-reel-${index}`);
    });
    expect(AUTH_SHOWCASE_REELS).toHaveLength(5);
    expect(markup).not.toContain("auth-anim-reel-5");
  });

  it("drives every layer from the shared loop", () => {
    expect(markup).toContain("auth-anim-doc");
    expect(markup).toContain("auth-anim-make");
    expect(markup).toContain("auth-anim-cursor");
  });

  /* STAGE_IS_DECOR — and no further than the stage. */
  it("hides the stage from assistive technology but keeps the caption", () => {
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain(escaped(AUTH_PANEL_COPY.lead));
    expect(markup).toContain(AUTH_PANEL_COPY.headlineHighlight);
    /* The panel itself must NOT be hidden: the caption is the only thing on
       this half of the screen that says what the product does. */
    expect(markup).not.toMatch(/^<aside[^>]*aria-hidden/);
  });

  it("puts nothing focusable on the stage", () => {
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("tabindex");
  });
});
