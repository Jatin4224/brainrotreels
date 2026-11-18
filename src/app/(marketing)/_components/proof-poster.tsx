/**
 * SOURCE OF TRUTH KEYWORDS: ProofPoster, A_POSTER_URL_CAN_404,
 *   MarketingProofClip, ProofStrip
 *
 * WHAT:  The <img> inside a proof card, with the fallback for a poster URL
 *        that does not resolve.
 *
 * WHY:   A_POSTER_URL_CAN_404. `poster` is OPERATOR-supplied and may be
 *        off-domain — proof-strip.tsx says so, which is also why it is a
 *        plain <img> and not next/image. An off-domain URL is one bucket
 *        rename away from 404ing, and until now that produced the browser's
 *        broken-image glyph with the alt text spilling out beside it, on the
 *        one strip that is doing the selling.
 *
 *        The fallback is not a placeholder graphic: the card ALREADY has a
 *        correct empty state, because `poster` is optional and a deployment
 *        with no frames renders a clean `bg-secondary` box. So a broken URL
 *        simply becomes that same box — one empty state, not two.
 *
 *        This file exists only to own that one boolean. ProofStrip stays a
 *        Server Component; the few bytes of client JS buy a failure mode
 *        that otherwise ships to every visitor of a misconfigured
 *        deployment.
 * WHERE: Rendered by ./proof-strip.tsx.
 */

"use client";

import * as React from "react";

export function ProofPoster({ src, alt }: { src: string; alt: string }) {
  /* The src is held BESIDE the flag so a new poster resets it during render,
     rather than in an effect that would paint the previous failure for a
     frame first. This is React's documented way to adjust state when a prop
     changes, and it is why the fixture toggle can swap posters without a
     card staying blank from the last variant. */
  const [state, setState] = React.useState({ src, failed: false });

  if (state.src !== src) {
    setState({ src, failed: false });
    return null;
  }

  if (state.failed) return null;

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- Poster URLs are
       OPERATOR-supplied and may be off-domain, which next/image refuses
       without a `remotePatterns` entry per deployment; a fork would have to
       edit next.config.ts before its own landing page would render. Lazy +
       async-decoding keeps the LCP cost the rule is protecting. */
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setState({ src, failed: true })}
      className="size-full object-cover"
    />
  );
}
