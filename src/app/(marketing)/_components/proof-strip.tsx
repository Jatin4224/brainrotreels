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

export function ProofStrip({ clips, className }: ProofStripProps) {
  return (
    <ul
      className={cn(
        "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-6",
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
              /* eslint-disable-next-line @next/next/no-img-element -- Poster
                 URLs are OPERATOR-supplied and may be off-domain, which
                 next/image refuses without a `remotePatterns` entry per
                 deployment; a fork would have to edit next.config.ts before
                 its own landing page would render. Lazy + async-decoding keeps
                 the LCP cost the rule is protecting. */
              <img
                src={clip.poster}
                alt={`${FORMAT_TAG_LABELS[clip.kind]} — ${clip.title}`}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            )}

            <span className="brutal-border-thin absolute left-2 top-2 rounded-full bg-background/80 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-brand-accent backdrop-blur-sm">
              {FORMAT_TAG_LABELS[clip.kind]}
            </span>

            {/* Decoration, not a control — there is nothing to play until the
                visitor has an account, and a dead button is worse than none. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none"
            >
              <span className="brutal-border flex size-11 items-center justify-center rounded-full bg-brand-accent text-brand-accent-foreground">
                <PlayIcon className="size-4" />
              </span>
            </span>

            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-background via-background/80 to-transparent px-3 pb-3 pt-14">
              <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground">
                {clip.title}
              </p>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {clip.duration}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
