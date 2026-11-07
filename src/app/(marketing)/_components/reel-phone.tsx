/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ReelPhone, ReelPhoneProps, ReelShowcaseItem,
 *   POSTER_IS_THE_FLOOR, PAUSE_WHEN_OFFSCREEN, REDUCED_MOTION_MEANS_STILL,
 *   OVERLAY_IS_DECORATION, NO_LAYOUT_SHIFT, FEED_LABEL_IS_CONFIGURABLE
 *
 * WHAT:  One phone mockup — a fixed-size frame holding a looping short with a
 *        short-video feed overlay drawn on top of it: status bar, header,
 *        action rail, caption block and bottom nav.
 *
 * WHY:   POSTER_IS_THE_FLOOR. The poster is required and the video is not, so
 *        the phone is finished at first paint and stays finished in every case
 *        that would otherwise leave a hole: no clip encoded yet, a visitor who
 *        asked for reduced motion, a slow network, a codec the browser
 *        refuses. The video layers OVER the poster rather than replacing it,
 *        which is also NO_LAYOUT_SHIFT — the frame is a fixed px size and the
 *        poster fills it immediately, so nothing in the hero moves as media
 *        arrives.
 *
 *        PAUSE_WHEN_OFFSCREEN. Three autoplaying videos that keep decoding
 *        after the visitor has scrolled to the pricing table cost battery for
 *        nothing, so an IntersectionObserver plays and pauses them. The side
 *        phones also load lazily: they are the two a visitor looks at least.
 *
 *        REDUCED_MOTION_MEANS_STILL — not "slower". A looping video is motion
 *        the visitor did not ask for, so under the preference the `<video>` is
 *        never mounted at all rather than mounted and paused; there is nothing
 *        to decode and nothing to start.
 *
 *        OVERLAY_IS_DECORATION. The whole chrome — counts, buttons, nav — is
 *        `aria-hidden` and `pointer-events-none`. None of it does anything,
 *        because there is nothing to like on a landing page, and a screen
 *        reader announcing "92K remixes, button" about a picture is worse than
 *        silence. The frame itself carries one honest label naming whose short
 *        it is.
 *
 *        FEED_LABEL_IS_CONFIGURABLE: the header word is a prop with a default,
 *        not a literal, so the mockup can be relabelled in one place without
 *        touching this file. No platform logo or wordmark is drawn anywhere —
 *        every icon here is our own inline outline SVG.
 *
 *        Theme tokens only. The overlay reads as white because `--foreground`
 *        in the marketing palette IS near-white; the scrims are utilities (a
 *        scrim is a function of the footage, not the palette) and the filled
 *        heart is the fixed `--reel-like` signal colour.
 * WHERE: Rendered three times by ./reel-stage.tsx from `LANDING_REELS`.
 */

"use client";

import { useEffect, useRef, useState } from "react";

import type { ReelShowcaseItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ReelPhoneProps {
  item: ReelShowcaseItem;
  /** Bigger, upright, on top. The centre of the fan. */
  featured?: boolean | undefined;
  /** The word in the feed header. Defaults to "Reels". */
  feedLabel?: string | undefined;
  className?: string | undefined;
}

/* Shared geometry. The nav bar sits BELOW the video rather than over it, so
 * the video area is the frame minus this. */
const NAV_HEIGHT_PX = 38;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function ReelPhone({
  item,
  featured = false,
  feedLabel = "Reels",
  className,
}: ReelPhoneProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  /* The meta block fades in once the media is up, so a half-loaded phone
   * never shows a caption floating over an empty frame. */
  const [metaVisible, setMetaVisible] = useState(false);

  const hasVideo = item.videoSrc !== undefined;

  /* PLAYBACK IS DRIVEN ENTIRELY FROM HERE, and the `<video>` carries no
   * `autoPlay` attribute. Two bugs that buys:
   *
   * 1. No hydration mismatch. Reading the motion preference during render
   *    would have the server say "reduced" and the client say otherwise, so
   *    the two renders would disagree about whether a `<video>` exists. The
   *    markup is now identical on both and only BEHAVIOUR differs.
   * 2. No flash of motion. An `autoPlay` attribute is honoured by the browser
   *    the instant the element parses — before any of our JavaScript can
   *    decide the visitor asked for less of it. Starting playback ourselves
   *    means a reduced-motion visitor sees the poster and nothing else, ever.
   *
   * The same effect handles PAUSE_WHEN_OFFSCREEN: 25% visible is enough to be
   * worth decoding; below that the visitor has moved on and three decoding
   * videos are just battery. */
  useEffect(() => {
    if (!hasVideo) {
      const timer = window.setTimeout(() => setMetaVisible(true), 150);
      return () => window.clearTimeout(timer);
    }

    const frame = frameRef.current;
    if (frame === null) return undefined;

    const motionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    let onScreen = false;

    const sync = () => {
      const video = videoRef.current;
      if (video === null) return;

      if (motionQuery.matches || !onScreen) {
        video.pause();
        return;
      }

      void video.play().catch(() => {
        /* Autoplay refused (a policy, a codec, a battery saver). The poster
         * is still painted, so there is nothing to recover. */
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0.25 },
    );

    observer.observe(frame);
    /* Honour the preference being flipped mid-session rather than only at
     * load — the visitor who turns it on is the one who most wants it. */
    motionQuery.addEventListener("change", sync);

    return () => {
      observer.disconnect();
      motionQuery.removeEventListener("change", sync);
    };
  }, [hasVideo]);

  const strokeIcon = "size-[19px] stroke-[2px]" as const;

  return (
    <div
      ref={frameRef}
      aria-label={`Example short by @${item.username}`}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-[30px] border-[5px] border-surface-raised bg-background shadow-[0_30px_60px_-20px_oklch(0_0_0/0.75)]",
        featured ? "h-[484px] w-60" : "h-[460px] w-[228px]",
        className,
      )}
    >
      {/* ── Media ─────────────────────────────────────────────────────── */}
      <div
        className="absolute inset-x-0 top-0 overflow-hidden bg-background"
        style={{ bottom: `${NAV_HEIGHT_PX}px` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Poster frames
            are operator-supplied and may be off-domain; next/image would need
            a remotePatterns entry per deployment. Fixed frame + eager featured
            poster is what NO_LAYOUT_SHIFT needs, which is the cost the rule is
            really about. */}
        <img
          src={item.posterSrc}
          alt={item.posterAlt}
          loading={featured ? "eager" : "lazy"}
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />

        {hasVideo ? (
          /* No `autoPlay` — see the effect above. `muted` and `playsInline`
             are still required: without them a browser refuses to start a
             video programmatically at all, and iOS takes it fullscreen. */
          <video
            ref={videoRef}
            src={item.videoSrc}
            poster={item.posterSrc}
            muted
            loop
            playsInline
            preload={featured ? "metadata" : "none"}
            onPlaying={() => setMetaVisible(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
      </div>

      {/* ── Feed overlay (decoration only) ────────────────────────────── */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 font-sans text-foreground"
      >
        <div className="reel-scrim-top absolute inset-x-0 top-0 h-[70px]" />

        {/* Status bar */}
        <div className="absolute inset-x-0 top-[7px] flex items-center justify-between px-4 text-[10px] font-semibold">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            {/* Signal bars */}
            <svg viewBox="0 0 16 10" className="h-2.5 w-4 fill-current">
              <rect x="0" y="6" width="2.5" height="4" rx="0.8" />
              <rect x="4" y="4" width="2.5" height="6" rx="0.8" />
              <rect x="8" y="2" width="2.5" height="8" rx="0.8" />
              <rect x="12" y="0" width="2.5" height="10" rx="0.8" />
            </svg>
            {/* Battery */}
            <svg viewBox="0 0 26 12" className="h-3 w-6">
              <rect
                x="0.75"
                y="0.75"
                width="21"
                height="10.5"
                rx="3"
                className="fill-none stroke-current"
                strokeWidth="1.5"
              />
              <rect
                x="2.75"
                y="2.75"
                width="14"
                height="6.5"
                rx="1.5"
                className="fill-current"
              />
              <path
                d="M23.5 4.5v3a2 2 0 0 0 0-3Z"
                className="fill-current"
              />
            </svg>
          </span>
        </div>

        {/* Header */}
        <div className="absolute inset-x-0 top-[26px] flex items-center justify-between px-4">
          <span className="flex items-center gap-1 text-[15px] font-bold">
            {feedLabel}
            <svg
              viewBox="0 0 24 24"
              className="size-3 fill-none stroke-current stroke-[2.5px]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
          {/* Camera */}
          <svg
            viewBox="0 0 24 24"
            className="size-5 fill-none stroke-current stroke-[2px]"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14.5 4h-5L8 6.5H4.5A1.5 1.5 0 0 0 3 8v10a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V8a1.5 1.5 0 0 0-1.5-1.5H16Z" />
            <circle cx="12" cy="12.5" r="3.5" />
          </svg>
        </div>

        <div
          className="reel-scrim-bottom absolute inset-x-0 h-[120px]"
          style={{ bottom: `${NAV_HEIGHT_PX}px` }}
        />

        {/* Action rail */}
        <div
          className={cn(
            "absolute right-2 flex flex-col items-center gap-[11px] text-[9.5px] font-semibold transition-opacity duration-300 motion-reduce:transition-none",
            metaVisible ? "opacity-100" : "opacity-0",
          )}
          style={{ bottom: `${NAV_HEIGHT_PX + 24}px` }}
        >
          <span className="flex flex-col items-center gap-0.5">
            <svg
              viewBox="0 0 24 24"
              className={cn(
                "size-[21px] stroke-[2px]",
                item.liked === true
                  ? "fill-reel-like stroke-reel-like"
                  : "fill-none stroke-current",
              )}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20.5 3.9 12.6a4.9 4.9 0 0 1 0-6.9 4.9 4.9 0 0 1 6.9 0l1.2 1.2 1.2-1.2a4.9 4.9 0 0 1 6.9 0 4.9 4.9 0 0 1 0 6.9Z" />
            </svg>
            {item.likes}
          </span>

          <span className="flex flex-col items-center gap-0.5">
            <svg
              viewBox="0 0 24 24"
              className={cn(strokeIcon, "fill-none stroke-current")}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.6-.7L3 21l1.9-5A8.1 8.1 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z" />
            </svg>
            {item.comments}
          </span>

          <span className="flex flex-col items-center gap-0.5">
            <svg
              viewBox="0 0 24 24"
              className={cn(strokeIcon, "fill-none stroke-current")}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m17 2 4 4-4 4" />
              <path d="M3 11V9a3 3 0 0 1 3-3h15" />
              <path d="m7 22-4-4 4-4" />
              <path d="M21 13v2a3 3 0 0 1-3 3H3" />
            </svg>
            {item.remixes}
          </span>

          <span className="flex flex-col items-center gap-0.5">
            <svg
              viewBox="0 0 24 24"
              className={cn(strokeIcon, "fill-none stroke-current")}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2.5 11 13" />
              <path d="M21.5 2.5 15 21.5l-4-8.5-8.5-4Z" />
            </svg>
            {item.shares}
          </span>

          <svg
            viewBox="0 0 24 24"
            className={cn(strokeIcon, "fill-current")}
          >
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>

          <span className="size-5 rounded-md border-2 border-foreground bg-brand-accent" />
        </div>

        {/* Meta block */}
        <div
          className={cn(
            "absolute left-2.5 flex flex-col gap-1 text-[10.5px] transition-opacity duration-300 motion-reduce:transition-none",
            metaVisible ? "opacity-100" : "opacity-0",
          )}
          style={{ right: "42px", bottom: `${NAV_HEIGHT_PX + 10}px` }}
        >
          <span className="flex items-center gap-1.5">
            <span className="size-[22px] rounded-full border-[1.5px] border-foreground bg-brand-accent" />
            <span className="font-semibold">{item.username}</span>
            <span className="rounded-md border border-foreground/80 px-1.5 py-px text-[9.5px]">
              Follow
            </span>
          </span>

          <span className="truncate">
            {item.caption}{" "}
            <span className="opacity-70">{item.hashtags}</span>
          </span>

          <span className="flex items-center gap-1 text-[9.5px]">
            <svg
              viewBox="0 0 24 24"
              className="size-2.5 fill-none stroke-current stroke-[2px]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            {item.username} · Original audio
          </span>
        </div>

        {/* Bottom nav */}
        <div
          className="absolute inset-x-0 bottom-0 flex items-center justify-around bg-background px-3"
          style={{ height: `${NAV_HEIGHT_PX}px` }}
        >
          <svg
            viewBox="0 0 24 24"
            className={cn(strokeIcon, "fill-none stroke-current")}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />
          </svg>
          <svg
            viewBox="0 0 24 24"
            className={cn(strokeIcon, "fill-none stroke-current")}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <svg
            viewBox="0 0 24 24"
            className={cn(strokeIcon, "fill-none stroke-current")}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          <svg
            viewBox="0 0 24 24"
            className={cn(strokeIcon, "fill-none stroke-current")}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <path d="m10 9 5 3-5 3Z" />
          </svg>
          <span className="size-[17px] rounded-full border border-foreground bg-brand" />
        </div>

        {/* Home indicator */}
        <span className="absolute bottom-[3px] left-1/2 h-[3px] w-[70px] -translate-x-1/2 rounded-full bg-foreground" />
      </div>
    </div>
  );
}
