/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ReelPhone, ReelPhoneProps, ReelShowcaseItem,
 *   THE_FEED_SCROLLS_ITSELF, CHROME_IS_SHARED, OVERLAY_IS_DECORATION,
 *   NO_LAYOUT_SHIFT, FEED_LABEL_IS_CONFIGURABLE, reel-feed
 *
 * WHAT:  The hero's phone — a fixed-size handset frame whose screen scrolls
 *        itself through the example shorts, with a short-video feed overlay
 *        drawn on top: status bar, header, per-short action rail and caption
 *        block, bottom nav and home indicator.
 *
 * WHY:   THE_FEED_SCROLLS_ITSELF, in CSS (see `reel-feed` in globals.css). One
 *        phone showing a FEED beats three phones showing stills, because the
 *        scroll is the product: a visitor watches the thing they are being
 *        sold somebody else doing. No JavaScript timer, so nothing to leak and
 *        nothing to re-render per frame.
 *
 *        CHROME_IS_SHARED. The status bar, header, nav and home indicator
 *        belong to the PHONE and are drawn once outside the scrolling track;
 *        only the scrim, the rail and the caption belong to the SHORT and
 *        repeat per slide. Drawing the chrome per slide would scroll the
 *        status bar off the top of the screen, which no phone does.
 *
 *        The track repeats the first short at the end so the loop's last step
 *        lands on a copy of slide one and the restart cannot be seen.
 *
 *        NO_LAYOUT_SHIFT: the frame is a fixed pixel size and every slide is a
 *        poster that fills it, so the hero reserves its space before any media
 *        arrives. `contain` letterboxes a source that is not 9:16 rather than
 *        cropping it, because the crop would cut off the burned-in caption —
 *        the part of the short worth showing.
 *
 *        OVERLAY_IS_DECORATION. The whole chrome — counts, buttons, nav — is
 *        `aria-hidden` and `pointer-events-none`. None of it does anything,
 *        because there is nothing to like on a landing page, and a screen
 *        reader announcing "92K remixes, button" about a picture is worse than
 *        silence. The frame carries one honest label instead.
 *
 *        FEED_LABEL_IS_CONFIGURABLE: the header word is a prop with a default,
 *        not a literal, so the mockup can be relabelled in one place. No
 *        platform logo or wordmark is drawn anywhere — every icon here is our
 *        own inline outline SVG.
 *
 *        Theme tokens only. The overlay reads as white because `--foreground`
 *        in the marketing palette IS near-white; the scrims are utilities (a
 *        scrim is a function of the footage, not the palette) and the filled
 *        heart is the fixed `--reel-like` signal colour.
 * WHERE: Rendered by ./reel-stage.tsx from `LANDING_REELS`.
 */

import type { ReelShowcaseItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ReelPhoneProps {
  items: readonly ReelShowcaseItem[];
  /** The word in the feed header. Defaults to "Reels". */
  feedLabel?: string | undefined;
  className?: string | undefined;
}

const NAV_HEIGHT_PX = 48;
const RAIL_ICON = "size-[27px] fill-none stroke-current stroke-2";

export function ReelPhone({
  items,
  feedLabel = "Reels",
  className,
}: ReelPhoneProps) {
  /* The repeat of slide one that hides the loop's restart. Read through a
   * named first element rather than indexing inline: under
   * `noUncheckedIndexedAccess` a bare `items[0]` widens the whole track to
   * include `undefined`, and every field read below would then need a guard. */
  const first = items[0];
  const slides: readonly ReelShowcaseItem[] =
    first === undefined ? [] : [...items, first];

  return (
    <div
      aria-label="A phone scrolling through example shorts made with the app"
      className={cn(
        "relative h-[620px] w-[300px] overflow-hidden rounded-[44px] border-[7px] border-surface-raised bg-background shadow-[0_0_0_1px_var(--border),0_40px_80px_oklch(0_0_0/0.5)]",
        className,
      )}
    >
      {/* ── The scrolling screen ──────────────────────────────────────── */}
      <div
        className="absolute inset-x-0 top-0 overflow-hidden"
        style={{ bottom: `${NAV_HEIGHT_PX}px` }}
      >
        <div className="reel-feed absolute inset-0">
          {slides.map((item, index) => (
            <div
              /* The repeat shares its item's id, so the index disambiguates. */
              key={`${item.id}-${index}`}
              className="relative h-full w-full overflow-hidden bg-background"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Frames
                  are operator-supplied and may be off-domain; next/image would
                  need a remotePatterns entry per deployment. The fixed frame
                  and an eager first slide are what NO_LAYOUT_SHIFT needs,
                  which is the cost this rule is really about. */}
              <img
                src={item.posterSrc}
                alt={item.posterAlt}
                loading={index === 0 ? "eager" : "lazy"}
                decoding="async"
                className={cn(
                  "absolute inset-0 size-full",
                  item.contain === true ? "object-contain" : "object-cover",
                )}
              />

              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 font-sans text-foreground"
              >
                <div className="reel-scrim-bottom absolute inset-x-0 bottom-0 h-[150px]" />

                {/* Action rail */}
                <div className="absolute bottom-[18px] right-2.5 flex flex-col items-center gap-[15px] text-[11.5px] font-semibold">
                  <span className="flex flex-col items-center gap-[3px]">
                    <svg
                      viewBox="0 0 24 24"
                      className={cn(
                        "size-7 stroke-2",
                        item.liked === true
                          ? "fill-reel-like stroke-reel-like"
                          : "fill-none stroke-current",
                      )}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 20.5s-7.5-4.4-9.3-9.2C1.4 7.8 3.6 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.4 0 5.6 3.3 4.3 6.8-1.8 4.8-9.3 9.2-9.3 9.2z" />
                    </svg>
                    {item.likes}
                  </span>

                  <span className="flex flex-col items-center gap-[3px]">
                    <svg
                      viewBox="0 0 24 24"
                      className={RAIL_ICON}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20.5 12a8.5 8.5 0 1 1-3.4-6.8A8.4 8.4 0 0 1 20.5 12zM20.5 21l-1.6-4.3" />
                    </svg>
                    {item.comments}
                  </span>

                  <span className="flex flex-col items-center gap-[3px]">
                    <svg
                      viewBox="0 0 24 24"
                      className={RAIL_ICON}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 11V9a3 3 0 0 1 3-3h13m-3-3 3 3-3 3M20 13v2a3 3 0 0 1-3 3H4m3 3-3-3 3-3" />
                    </svg>
                    {item.remixes}
                  </span>

                  <span className="flex flex-col items-center gap-[3px]">
                    <svg
                      viewBox="0 0 24 24"
                      className={RAIL_ICON}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 3 9.2 10.1M22 3l-7 18-4.5-8.6L2 8z" />
                    </svg>
                    {item.shares}
                  </span>

                  <svg viewBox="0 0 24 24" className="size-[22px] fill-current">
                    <circle cx="5" cy="12" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="19" cy="12" r="2" />
                  </svg>

                  <span className="size-[26px] rounded-[7px] border-2 border-foreground bg-brand-accent" />
                </div>

                {/* Caption block */}
                <div className="absolute bottom-4 left-3.5 right-14 text-[13px] leading-[1.38]">
                  <span className="mb-1.5 flex items-center gap-2 font-semibold">
                    <span className="size-7 shrink-0 rounded-full border-2 border-foreground bg-brand-accent" />
                    {item.username}
                    <span className="rounded-[7px] border border-foreground/80 px-2.5 py-[3px] text-xs">
                      Follow
                    </span>
                  </span>

                  <span className="block truncate">
                    {item.caption}{" "}
                    <span className="opacity-70">{item.hashtags}</span>
                  </span>

                  <span className="mt-[5px] flex items-center gap-[5px] text-xs">
                    <svg viewBox="0 0 24 24" className="size-3 fill-current">
                      <path d="M9 18a3 3 0 1 1-2-2.8V4l12-2v13a3 3 0 1 1-2-2.8V6.3L9 7.7z" />
                    </svg>
                    {item.username} · Original audio
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── The phone's own chrome, drawn once over the feed ───────────── */}
      <div aria-hidden="true" className="pointer-events-none">
        <span className="absolute left-1/2 top-[9px] z-[6] h-6 w-[86px] -translate-x-1/2 rounded-[14px] bg-background" />

        <div className="reel-scrim-top absolute inset-x-0 top-0 z-[4] h-24" />

        {/* Status bar */}
        <div className="absolute left-[26px] right-[22px] top-[13px] z-[5] flex justify-between text-xs font-semibold text-foreground">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <svg viewBox="0 0 18 12" className="h-[11px] w-[17px] fill-current">
              <rect x="0" y="8" width="3" height="4" rx="1" />
              <rect x="5" y="5" width="3" height="7" rx="1" />
              <rect x="10" y="2.5" width="3" height="9.5" rx="1" />
              <rect x="15" y="0" width="3" height="12" rx="1" />
            </svg>
            <svg viewBox="0 0 26 12" className="h-3 w-[25px]">
              <rect
                x=".5"
                y=".5"
                width="22"
                height="11"
                rx="3"
                className="fill-none stroke-current opacity-60"
              />
              <rect
                x="2"
                y="2"
                width="16"
                height="8"
                rx="1.5"
                className="fill-current"
              />
              <rect
                x="23.5"
                y="4"
                width="2"
                height="4"
                rx="1"
                className="fill-current opacity-60"
              />
            </svg>
          </span>
        </div>

        {/* Header */}
        <div className="absolute inset-x-4 top-[44px] z-[5] flex items-center justify-between text-[19px] font-bold text-foreground">
          <span className="flex items-center gap-1">
            {feedLabel}
            <svg
              viewBox="0 0 24 24"
              className="size-3.5 fill-none stroke-current stroke-[2.5px]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
          <svg
            viewBox="0 0 24 24"
            className="size-[25px] fill-none stroke-current stroke-2 text-foreground"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8a2 2 0 0 1 2-2h2.5l1.5-2h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </div>

        {/* Bottom nav */}
        <div
          className="absolute inset-x-0 bottom-0 z-[5] flex items-center justify-around bg-background pb-2 text-foreground"
          style={{ height: `${NAV_HEIGHT_PX}px` }}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-6 fill-none stroke-current stroke-2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />
          </svg>
          <svg
            viewBox="0 0 24 24"
            className="size-6 fill-none stroke-current stroke-2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="10.5" cy="10.5" r="7" />
            <path d="m21 21-5.5-5.5" />
          </svg>
          <svg
            viewBox="0 0 24 24"
            className="size-6 fill-none stroke-current stroke-2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          <svg
            viewBox="0 0 24 24"
            className="size-6 fill-none stroke-current stroke-2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <path d="M3 8.5h18M8.5 3l3 5.5M14.5 3l3 5.5" />
            <path d="M10 12v6l5-3z" className="fill-current" />
          </svg>
          <span className="size-[22px] rounded-full border-2 border-foreground bg-brand" />
        </div>

        <span className="absolute bottom-[5px] left-1/2 z-[6] h-1 w-[100px] -translate-x-1/2 rounded-sm bg-foreground" />
      </div>
    </div>
  );
}
