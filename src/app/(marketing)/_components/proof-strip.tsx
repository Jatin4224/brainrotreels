/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProofStrip, ProofStripProps, MarketingProofClip,
 *   PRODUCT_AS_PROOF, FORMAT_TAG_LABELS, NO_STOCK_IMAGERY
 *
 * WHAT:  The row of 9:16 tiles under the hero — one per sample, each tagged
 *        with the format that made it and the runtime it plays for.
 *
 * WHY:   PRODUCT_AS_PROOF / NO_STOCK_IMAGERY. The only imagery on this page is
 *        the product's own output, because a short-form video tool that
 *        illustrates itself with stock photography is telling a visitor it has
 *        nothing to show. The tiles are the right aspect ratio for the thing
 *        being sold, so the shape itself carries the message.
 *
 *        It renders WITHOUT posters and does not look broken: a fresh
 *        deployment has rendered nothing yet, so a tile with no `poster` paints
 *        the format tag and the title over an empty frame instead of an image
 *        request that 404s. That is the difference between a landing page an
 *        operator can deploy on day one and one that must be populated first.
 *
 *        Takes its clips as a prop rather than importing the content module:
 *        the same strip serves a future per-format page with a different set,
 *        and a component that reaches for its own data cannot be reused.
 *        `next/image` is deliberately NOT used — the URLs are operator-supplied
 *        and may be off-domain, which would need a remotePatterns entry per
 *        operator; a plain lazy <img> is the honest primitive here.
 * WHERE: Rendered by src/app/(marketing)/page.tsx from LANDING_PROOF_CLIPS.
 */

import { PlayIcon } from "lucide-react";

import type { MarketingProofClip, ProjectKind } from "@/lib/types";

import { ProofPoster } from "./proof-poster";
import { cn } from "@/lib/utils";

export interface ProofStripProps {
  clips: readonly MarketingProofClip[];
  className?: string | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: FORMAT_TAG_LABELS, ProjectKind
 *
 * WHAT:  The short tag printed on a tile for each project kind.
 * WHY:   A `Record<ProjectKind, string>` rather than a lookup with a fallback:
 *        adding a format to `PROJECT_KINDS` fails the typecheck here until the
 *        strip knows what to call it, which is the only way a new kind cannot
 *        appear on the page as a blank tag.
 * WHERE: The tile tag below.
 */
const FORMAT_TAG_LABELS: Record<ProjectKind, string> = {
  "reddit-story": "Reddit story",
  voiceover: "Voiceover",
  quiz: "Quiz",
  motion: "Motion",
};

const CLIP_GRID_CLASS: Record<number, string> = {
  1: "max-w-[14rem] grid-cols-1",
  2: "max-w-[28rem]",
  3: "max-w-[42rem] sm:grid-cols-3",
  4: "max-w-[56rem] sm:grid-cols-3 lg:grid-cols-4",
  5: "sm:grid-cols-3 lg:grid-cols-5",
};

export function ProofStrip({ clips, className }: ProofStripProps) {
  /* An empty strip is an empty <ul> with a top margin — a gap under the hero
     that reads as a layout fault rather than as "no clips". Render nothing. */
  if (clips.length === 0) return null;

  return (
    /* Columns capped at the clip count, so a deployment with three real
       exports gets three columns rather than three cards and two holes.
       Below sm it is two up whatever the count, because one 9:16 card
       across a phone is a poster, not a strip. */
    <ul
      className={cn(
        "mx-auto grid grid-cols-2 gap-4 lg:gap-6",
        CLIP_GRID_CLASS[Math.min(clips.length, 5)],
        className,
      )}
    >
      {clips.map((clip) => (
        <li
          key={clip.id}
          className="brutal-border brutal-shadow brutal-hover group relative overflow-hidden rounded-2xl bg-card"
        >
          <div className="relative aspect-[9/16] bg-secondary">
            {clip.poster === undefined ? null : (
              /* A_POSTER_URL_CAN_404 — the fallback lives in ProofPoster, and
                 is this same box with no image in it. */
              <ProofPoster
                src={clip.poster}
                alt={`${FORMAT_TAG_LABELS[clip.kind]} — ${clip.title}`}
              />
            )}

            {/* Decoration, not a control — there is nothing to play until the
                visitor has an account, and a dead button is worse than none. */}
            <span
              aria-hidden="true"
              /* pointer-fine supplies the HALF OF THE QUERY group-hover is
                 missing. Tailwind compiles group-hover: inside
                 `@media (hover: hover)` already, but not
                 `(pointer: fine)` — and both halves are the rule, exactly as
                 HOVER_IS_A_CAPABILITY in globals.css argues for
                 .brutal-hover: a coarse pointer that CLAIMS hover (some
                 Android browsers, a TV remote) fakes it on tap and holds it.
                 On those, tapping a card left this badge showing until
                 something else was tapped — worse than never showing it,
                 since the badge is decoration and there is nothing to play.
                 Stacked, the two variants compile to the same nested
                 `(pointer: fine)` + `(hover: hover)` query. */
              className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 ease-[var(--ease-settle)] pointer-fine:group-hover:opacity-100 motion-reduce:transition-none"
            >
              {/* THE DISC ARRIVES. The overlay's opacity alone read as a
                  layer switching on rather than as an affordance appearing
                  under the pointer, so the disc grows the last 10% on the
                  SAME 150ms and the same curve — one motion, not two.
                  `scale`, not `transform`: the card around this is a
                  `brutal-hover`, whose 1px lift IS the transform. The
                  pointer-fine gate is the parent's, inherited through
                  group-hover; motion-reduce lands it at full size so the
                  fade still reads. */}
              <span className="brutal-border flex size-11 scale-90 items-center justify-center rounded-full bg-brand-accent text-brand-accent-foreground transition-transform duration-150 ease-[var(--ease-settle)] pointer-fine:group-hover:scale-100 motion-reduce:scale-100 motion-reduce:transition-none">
                <PlayIcon className="size-4" />
              </span>
            </span>
          </div>

          {/* NOTHING IS OVERLAID ON THE FRAME ANY MORE. The tag used to float
              at top-left and the title over a scrim at the bottom, and both
              collided with the covers' OWN design: every one of these five
              frames carries its own burned-in label ("PART 1/5",
              "Q3 IN 60 SECONDS") at the top and a caption line at the
              bottom, because they are real exports, not placeholders. Two
              label systems fighting for the same two corners read as a
              rendering bug on the one strip that is doing the selling.

              There is no corner that is safe across five different covers,
              so the metadata moved OUT of the frame and became the card's
              footer — the same anatomy as the format and plan cards, where
              text sits on the card surface rather than on an image. The
              poster is now shown whole, which is the point of showing it. */}
          <div className="flex flex-col gap-1 px-3 pb-3 pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.12em] text-brand-accent">
                {FORMAT_TAG_LABELS[clip.kind]}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {clip.duration}
              </span>
            </div>
            {/* overflow-wrap: anywhere, because a title is not always a
                sentence. A thread permalink or a slug
                ("r/AmItheAsshole/comments/1d9x2kq/aita_for_...") has no space
                to break at, so line-clamp had nothing to clamp and the text
                ran 198px past its own box at 1440 — clipped mid-token with no
                ellipsis to say so. `anywhere` breaks only when it must, and
                only then does the clamp get to do its job. */}
            <p className="line-clamp-2 text-xs font-semibold leading-snug [overflow-wrap:anywhere] text-foreground">
              {clip.title}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
