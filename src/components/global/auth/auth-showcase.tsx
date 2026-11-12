/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AuthShowcase, AuthShowcaseProps, AuthShowcaseReel,
 *   AUTH_SHOWCASE_REELS, AUTH_SHOWCASE_SOURCE, AUTH_PANEL_COPY, REEL_TONES,
 *   AUTH_MESSAGE_PANEL, PANEL_IS_THE_PITCH, SHOWCASE_IS_A_LOOP,
 *   STAGE_IS_DECOR, PAUSE_WHEN_UNWATCHED, HIGHLIGHT_IS_A_BLOCK,
 *   TOKENS_NOT_HEX, auth-showcase-canvas, auth-anim-doc, auth-anim-reel-0
 *
 * WHAT:  The panel beside the desktop auth form — a looping demonstration of
 *        the product (a document drops into the prompt bar, the "Make reels"
 *        pill is pressed, five finished reels rise out from under the bar and
 *        fan into a strip) over the headline, paragraph and social-proof line
 *        that caption it.
 *
 * WHY:   PANEL_IS_THE_PITCH. An auth screen is the narrowest point of the
 *        funnel, and a bare form on an empty page gives somebody who arrived
 *        from an ad nothing to confirm they are in the right place. This half
 *        of the screen is what says what they are signing into.
 *
 *        SHOWCASE_IS_A_LOOP, and this is the change from the previous
 *        version, which was one headline and one paragraph. The claim this
 *        product makes — one document in, five finished reels out — is a
 *        TRANSFORMATION, and a sentence describing a transformation is the
 *        one thing a five-second animation says better. The earlier note here
 *        argued against motion on the grounds that a fan of fake cards drew
 *        the eye away from the form and had to be re-tuned whenever the
 *        panel's height moved. Both objections are answered rather than
 *        ignored: the composition is a FIXED 560x708 design scaled to fit
 *        (`auth-showcase-canvas`), so no height can re-tune it, and it is
 *        confined to the right half with the form's own loud orange CTA the
 *        only saturated thing on the left.
 *
 *        STAGE_IS_DECOR: `aria-hidden` on the STAGE, not on the panel.
 *        Everything inside the stage is a picture of a product — a fake file
 *        name, a fake button, five fake thumbnails — and reading it aloud
 *        describes nothing a visitor can act on. The copy block underneath is
 *        the opposite: it is the only place on this screen that says what the
 *        product does, so it stays in the accessibility tree and the stage
 *        contains NO focusable elements (the "Make reels" pill is a <span>,
 *        deliberately — a real <button> would put a dead tab stop between the
 *        form and the footer).
 *
 *        PAUSE_WHEN_UNWATCHED. Eight infinite animations repainting behind a
 *        hidden tab or below the fold are a battery cost with nobody
 *        watching, so an IntersectionObserver and `visibilitychange` toggle
 *        one class that pauses them all. `animation-play-state`, not
 *        unmounting: the loop resumes on the frame it stopped on.
 *
 *        COVER_IS_AN_IMAGE. The five cards show the renderer's REAL first
 *        frames (public/auth-reels/), not five text cards drawn in the
 *        palette. auth-design.md §4.4 specifies the drawn version — a tone,
 *        a kicker, a title, a caption — and it is deliberately superseded:
 *        at 100px wide no headline reads, so the drawn card had to invent
 *        short ones, and a drawing of the output is a weaker claim than the
 *        output. What survives from §4.4 is the GEOMETRY, which the
 *        animation depends on: 100x178, gap 0, rounded only at the strip's
 *        two outer ends, chip on the top edge, score badge at the bottom.
 *
 *        The only colours left on a card are the placeholder underneath the
 *        image (`bg-surface-raised`, so a bright cover cannot flash white
 *        while it loads) and the badge, which stays a dark chip over a scrim
 *        because these covers are near-white at the bottom as often as not.
 *
 *        HIDDEN BELOW `lg`, not shrunk: the mobile artboards have no panel at
 *        all, and below that width the form column carries the headline
 *        itself (AuthHero). Hiding it in CSS rather than branching in the
 *        page keeps ONE responsive component, which is what auth-design.md §8
 *        asks for. `lg` and not the spec's 900px because `lg` is where every
 *        other half of this screen already switches, and two breakpoints 124
 *        pixels apart is how a layout ends up with a form that has moved and
 *        a panel that has not.
 *
 * WHERE: Passed as the `aside` of <AuthShell> by src/app/(auth)/sign-in and
 *        /sign-up. Content comes from ./auth-content.ts; the keyframes, the
 *        fit-to-viewport scale and the pause class come from the
 *        `auth-doc-drop` block in src/app/globals.css.
 */

import * as React from "react";
import Image from "next/image";
import { LinkIcon, PointerIcon } from "lucide-react";

import type { AuthShowcaseReel } from "@/lib/types";
import { cn } from "@/lib/utils";

import { HighlightHeading } from "@/components/global/highlight-heading";
import {
  AUTH_PANEL_COPY,
  AUTH_SHOWCASE_REELS,
  AUTH_SHOWCASE_SOURCE,
} from "./auth-content";

export interface AuthShowcaseProps {
  className?: string | undefined;
}

/* One class per index rather than `auth-anim-reel-${i}`, so Tailwind sees
 * every class literally and cannot tree-shake one of them out of the
 * production build — the same reason `LOGO_TONES` in platform-logo.tsx is
 * written as a closed map. */
const REEL_ANIMATIONS = [
  "auth-anim-reel-0",
  "auth-anim-reel-1",
  "auth-anim-reel-2",
  "auth-anim-reel-3",
  "auth-anim-reel-4",
] as const;

/* The strip is five cards TOUCHING, so only its two outer ends are rounded —
 * the middle three are square on both sides. Driven by the index rather than
 * written into the data: a reel that is moved in AUTH_SHOWCASE_REELS must
 * take the strip's shape at its new position, not carry its old corners. */
function reelCorners(index: number, total: number): string {
  if (index === 0) return "rounded-l-xl";
  if (index === total - 1) return "rounded-r-xl";
  return "";
}

export function AuthShowcase({ className }: AuthShowcaseProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [isPaused, setIsPaused] = React.useState(false);

  /* PAUSE_WHEN_UNWATCHED. Two reasons to stop, one switch: the panel being
   * scrolled out of view, and the tab being backgrounded. Both are tracked in
   * refs and combined, because either one alone would un-pause what the other
   * had paused. */
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    let isVisible = true;
    let isOnScreen = true;

    const sync = () => setIsPaused(!(isVisible && isOnScreen));

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        isOnScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0 },
    );
    observer.observe(panel);

    const onVisibility = () => {
      isVisible = document.visibilityState === "visible";
      sync();
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <aside
      ref={panelRef}
      className={cn(
        "auth-showcase brutal-border relative hidden h-full overflow-hidden rounded-[2rem] bg-card lg:block",
        isPaused && "auth-showcase-paused",
        className,
      )}
    >
      {/* The same halo the landing hero sits in, so the two surfaces catch
          light the same way. */}
      <span
        aria-hidden="true"
        className="halo-brand pointer-events-none absolute left-1/2 top-1/4 -z-0 h-[36rem] w-[44rem] -translate-x-1/2 opacity-25 blur-[60px]"
      />

      {/* The fixed design, scaled to whatever this panel was given. Absolute,
          so it contributes NO height and cannot put the page into a
          scrollbar — see auth-showcase-canvas in globals.css. */}
      <div className="auth-showcase-canvas flex flex-col">
        <ShowcaseStage />
        <ShowcaseCopy />
      </div>
    </aside>
  );
}

/* ---------- The stage ---------- */

/* 510px tall, every layer absolute, measured from auth-design.md §4.1. The
 * two masks are what sell the illusion: the document is CLIPPED as it enters
 * from above and again as it sinks past the bar, and the reels are clipped
 * until they clear the bar, so both appear to pass behind it. */
function ShowcaseStage() {
  const total = AUTH_SHOWCASE_REELS.length;

  return (
    <div aria-hidden="true" className="relative h-[510px] w-full shrink-0">
      {/* Upper mask — holds the document. */}
      <div className="absolute inset-x-0 top-0 h-[182px] overflow-hidden">
        <div className="auth-anim-doc absolute left-1/2 top-[10px] -ml-[145px] w-[290px]">
          <SourceCard />
        </div>
      </div>

      {/* Lower mask — holds the strip. It overhangs the panel by 36px on both
          sides so a reel sliding out to the right is clipped by the PANEL's
          edge rather than cut short in open space. */}
      <div className="absolute inset-x-[-36px] bottom-0 top-[252px] overflow-hidden">
        <div className="absolute inset-x-0 top-[40px] flex justify-center">
          {AUTH_SHOWCASE_REELS.map((reel, index) => (
            <ReelCard
              key={reel.id}
              reel={reel}
              index={index}
              total={total}
              corners={reelCorners(index, total)}
            />
          ))}
        </div>
      </div>

      {/* The bar, above both masks — the one thing everything else passes
          behind. */}
      <PromptBar />
    </div>
  );
}

/* The document that falls in. "Paper" on a dark panel, so it is the brightest
 * thing on the stage at the moment it enters. */
function SourceCard() {
  return (
    <div className="flex h-[128px] gap-4 rounded-[14px] border-2 border-brand-accent bg-foreground p-4 shadow-[0_24px_50px_rgba(0,0,0,.45)]">
      <div className="flex h-[66px] w-[52px] shrink-0 items-end justify-center rounded-md bg-brand p-1.5">
        <span className="text-xs font-bold text-brand-foreground">
          {AUTH_SHOWCASE_SOURCE.kind}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-background">
          {AUTH_SHOWCASE_SOURCE.fileName}
        </p>
        <p className="mt-0.5 text-xs text-background/60">
          {AUTH_SHOWCASE_SOURCE.meta}
        </p>
        {/* Three skeleton lines, not lorem ipsum: a document card that is
            unreadable at this size should LOOK unreadable rather than invite
            somebody to squint at fake prose. */}
        <div className="mt-3 space-y-1.5">
          <span className="block h-1.5 w-full rounded-full bg-background/12" />
          <span className="block h-1.5 w-4/5 rounded-full bg-background/12" />
          <span className="block h-1.5 w-[56%] rounded-full bg-background/12" />
        </div>
      </div>
    </div>
  );
}

/* The product's own prompt field, restated. The pill is a <span> and the
 * cursor is drawn rather than simulated: nothing here is operable, and
 * nothing here is in the tab order. */
function PromptBar() {
  return (
    <div className="absolute left-1/2 top-[180px] z-10 -ml-[190px] w-[380px]">
      <div className="flex h-[52px] items-center gap-2.5 rounded-full border border-border bg-surface-raised py-1.5 pl-[18px] pr-1.5 shadow-[0_10px_30px_rgba(0,0,0,.5)]">
        <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">
          {AUTH_SHOWCASE_SOURCE.placeholder}
        </span>
        <span className="auth-anim-make flex h-10 shrink-0 items-center rounded-full bg-brand px-4 text-sm font-bold text-brand-foreground">
          {AUTH_SHOWCASE_SOURCE.action}
        </span>
      </div>

      {/* The hand, over the pill's lower-left corner — where a real cursor
          would be when the press lands. */}
      <PointerIcon className="auth-anim-cursor absolute right-[18px] top-[30px] size-[22px] fill-foreground text-background" />
    </div>
  );
}

/* One reel. The wrapper is what MOVES (`auth-anim-reel-*`); the card inside
 * it never does, so the chip and the badge travel with it for free. */
function ReelCard({
  reel,
  index,
  total,
  corners,
}: {
  reel: AuthShowcaseReel;
  index: number;
  total: number;
  corners: string;
}) {
  /* Highest in the MIDDLE and falling away to both ends, so the strip reads
     as a hand of cards fanned from its centre rather than as five cards
     stacked left-to-right. The middle of a five-card strip is index 2. */
  const depth = total - Math.abs(index - (total - 1) / 2);

  return (
    <div
      className={cn(
        "relative w-[100px] shrink-0 pt-3",
        REEL_ANIMATIONS[index] ?? REEL_ANIMATIONS[0],
      )}
      style={{ zIndex: Math.round(depth) }}
    >
      {/* The platform chip, straddling the card's top edge. */}
      <span className="absolute left-1/2 top-0 z-10 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border-2 border-card bg-foreground text-[8px] font-bold text-background">
        {reel.platform}
      </span>

      {/* `relative` + `overflow-hidden` are what clip the cover to the
          strip's corner radius; `bg-surface-raised` is what the card is
          while the image is still arriving, so a bright frame can never
          flash white against the panel. */}
      <div
        className={cn(
          "relative h-[178px] overflow-hidden bg-surface-raised",
          corners,
        )}
      >
        {/* 100x178 is 9:16 to within a fifth of a pixel, so a 720x1280 cover
            lands almost exactly whole — `cover` scales rather than crops
            here. `center top` is the insurance: if either number is ever
            nudged, the frames put their headline in the upper half and the
            rotreels mark at the very bottom, so what gets cut should be the
            bottom. `fill` + `sizes="100px"` is what stops Next serving a
            720px source for a 100px box.

            `priority` on all five: they are above the fold on the widest
            screens and they are the SUBJECT of a loop that starts
            immediately, so a lazy one would pop in halfway through its
            first pass. Five covers at ~120KB each is the cost. */}
        <Image
          src={reel.src}
          alt=""
          fill
          sizes="100px"
          priority
          style={{ objectFit: "cover", objectPosition: "center top" }}
        />

        {/* SCRIM_IS_NOT_A_THEME_COLOR, the same rule `.reel-scrim-bottom`
            states in globals.css: this gradient is a function of the IMAGE
            under it, not of the palette. It has to be black whatever the
            theme does, because its only job is keeping the badge off a
            bright frame — two of these five covers are near-white at the
            bottom.

            The utility is the landing page's own scrim at `opacity-70`, not
            a second gradient written out here: that lands on the ~0.45 black
            this card wants while keeping ONE definition of what a scrim is.
            A copy of the gradient at a different strength is how two scrims
            drift apart. */}
        <span
          aria-hidden="true"
          className="reel-scrim-bottom pointer-events-none absolute inset-x-0 bottom-0 h-10 opacity-70"
        />

        {/* Above both, so the score reads on every cover. */}
        <span className="absolute bottom-2 left-1/2 z-10 flex w-[42px] -translate-x-1/2 flex-col items-center rounded-md bg-background/90 py-0.5">
          <span className="text-[8px] leading-tight text-muted-foreground">
            Score
          </span>
          <span className="text-sm font-bold leading-tight text-brand">
            {reel.score}
          </span>
        </span>
      </div>
    </div>
  );
}

/* ---------- The caption under it ---------- */

/* The only part of this panel a screen reader reads, and the only part that
 * survives `prefers-reduced-motion` unchanged — which is why the claim lives
 * in WORDS here and the stage above only illustrates it. */
function ShowcaseCopy() {
  const [proofLead, proofRest] = AUTH_PANEL_COPY.socialProof.split("·");

  return (
    <div className="mt-7 shrink-0">
      <HighlightHeading
        as="h2"
        before={AUTH_PANEL_COPY.headlineBefore}
        highlight={AUTH_PANEL_COPY.headlineHighlight}
        after={AUTH_PANEL_COPY.headlineAfter}
        className="font-display text-[42px] font-extrabold leading-none tracking-[-1.2px] text-foreground"
      />

      <p className="mt-3 max-w-[34rem] text-[15px] leading-relaxed text-muted-foreground">
        {AUTH_PANEL_COPY.lead}
      </p>

      {/* The one bold phrase is the number, not the sentence — it is the part
          a visitor actually reads. */}
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-bold text-foreground">{proofLead?.trim()}</span>
        {proofRest ? ` · ${proofRest.trim()}` : ""}
      </p>
    </div>
  );
}
