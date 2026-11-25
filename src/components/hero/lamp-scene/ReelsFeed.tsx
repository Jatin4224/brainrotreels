/**
 * SOURCE OF TRUTH KEYWORDS: ReelsFeed, REEL_DATA, THE_LOOP_IS_SEAMLESS
 *
 * WHAT:  The scrolling column inside the phone — four stacked reels (A, B, C
 *        and a second copy of A), each with the overlay furniture a Reel
 *        carries: the gradients, the right-hand action rail, and the creator
 *        block with its caption and audio line.
 *
 * WHY:   THE_LOOP_IS_SEAMLESS. Three reels are shown but four are rendered:
 *        the swipe off the third lands on a copy of the first, and the column
 *        is reset to the top on the next segment while the identical frame is
 *        on screen. A three-reel column would have to rewind, and the rewind
 *        is the one frame that tells a viewer the feed is a loop rather than a
 *        feed.
 *
 *        The column's transform is written by LampScene's RAF loop, never by
 *        React: this component renders once and then holds still while a ref
 *        moves it.
 * WHERE: Inside Phone's screen. The ref it forwards is the element the scroll
 *        timeline drives.
 */

import * as React from "react";

import { AgentReel } from "./reels/AgentReel";
import { CatReel } from "./reels/CatReel";
import { OctopusReel } from "./reels/OctopusReel";

interface ReelMeta {
  handle: string;
  caption: string;
  tags: string;
  likes: string;
  comments: string;
  shares: string;
  audio: string;
  /** The audio thumbnail and the avatar's fill, keyed to the video's palette. */
  thumb: string;
  avatar: string;
}

/* Placeholder content: handles and counts that look like a feed without
   claiming to be anyone's. */
const OCTOPUS: ReelMeta = {
  handle: "deepsea.facts",
  caption: "why octopuses have three hearts 🐙",
  tags: "#science",
  likes: "48.2K",
  comments: "1,203",
  shares: "9.8K",
  audio: "deepsea.facts · Original audio",
  thumb: "linear-gradient(135deg, #6fd3e6, #1f6f9a)",
  avatar: "#6fd3e6",
};

const AGENT: ReelMeta = {
  handle: "mindrot",
  caption: "he finally built it 🤯",
  tags: "#ai #agents",
  likes: "12.1K",
  comments: "1,874",
  shares: "92K",
  audio: "mindrot · Original audio",
  thumb: "linear-gradient(135deg, #ffd15c, #f06a35)",
  avatar: "#ffd15c",
};

const CAT: ReelMeta = {
  handle: "meme.kitten",
  caption: "just a happy cat 🎧",
  tags: "#lofi",
  likes: "284K",
  comments: "4.2K",
  shares: "52K",
  audio: "lofi vibes · Original audio",
  thumb: "linear-gradient(135deg, #f2a65a, #7a5a48)",
  avatar: "#f2a65a",
};

function HeartIcon() {
  return (
    <svg
      width="27"
      height="27"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="1.8"
      strokeLinejoin="round"
    >
      <path d="M12 20.5s-7.6-4.5-9.4-9.1C1.3 7.9 3.5 4.5 7 4.5c2 0 3.5 1.1 5 2.9 1.5-1.8 3-2.9 5-2.9 3.5 0 5.7 3.4 4.4 6.9-1.8 4.6-9.4 9.1-9.4 9.1z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="1.8"
      strokeLinejoin="round"
    >
      <path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.4-4.2a8.5 8.5 0 1 1 15.6-4.7z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="25"
      height="25"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="1.8"
      strokeLinejoin="round"
    >
      <path d="M21.5 3 3 10.3l7.1 2.6M21.5 3l-6.6 18-4.8-8.1M21.5 3 10.1 12.9" />
    </svg>
  );
}

/** The overlay furniture every reel wears, over whatever video is behind it. */
function ReelChrome({ meta }: { meta: ReelMeta }) {
  return (
    <>
      <div
        className="absolute inset-x-0 top-0 h-[120px]"
        style={{
          background: "linear-gradient(180deg, rgba(0,0,0,0.45), rgba(0,0,0,0))",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-[230px]"
        style={{
          background: "linear-gradient(0deg, rgba(0,0,0,0.66), rgba(0,0,0,0))",
        }}
      />

      {/* The action rail. */}
      <div className="absolute bottom-[74px] right-[9px] flex flex-col items-center gap-4 text-[11.5px] font-semibold">
        <div className="grid justify-items-center gap-1">
          <HeartIcon />
          {meta.likes}
        </div>
        <div className="grid justify-items-center gap-1">
          <CommentIcon />
          {meta.comments}
        </div>
        <div className="grid justify-items-center gap-1">
          <SendIcon />
          {meta.shares}
        </div>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff">
          <circle cx="12" cy="5" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="12" cy="19" r="1.7" />
        </svg>
        <span
          className="size-[26px] rounded-[7px]"
          style={{ background: meta.thumb, boxShadow: "0 0 0 2px #fff" }}
        />
      </div>

      {/* The creator block. */}
      <div className="absolute bottom-16 left-[13px] right-14">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <span
            className="box-border size-[30px] rounded-full p-[2px]"
            style={{
              background:
                "linear-gradient(45deg, #feda75, #fa7e1e, #d62976, #962fbf)",
            }}
          >
            <span
              className="block h-full w-full rounded-full"
              style={{
                background: meta.avatar,
                boxShadow: "0 0 0 1.5px #000",
              }}
            />
          </span>
          {meta.handle}
          <span
            className="rounded-lg px-[9px] py-[3px] text-[11.5px] font-semibold"
            style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.75)" }}
          >
            Follow
          </span>
        </div>
        <p className="mt-2 text-[12.5px] leading-[1.35]">
          {meta.caption} <span className="opacity-80">{meta.tags}</span>{" "}
          <span className="opacity-65">… more</span>
        </p>
        <p className="mt-[7px] flex items-center gap-1.5 text-[11.5px]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff">
            <path d="M9 18.5a3 3 0 1 1-2-2.8V5l12-2v11.5a3 3 0 1 1-2-2.8V6.4L9 7.8z" />
          </svg>
          <span className="opacity-95">{meta.audio}</span>
        </p>
      </div>
    </>
  );
}

function Reel({
  meta,
  children,
}: {
  meta: ReelMeta;
  children: React.ReactNode;
}) {
  return (
    <div className="relative h-1/4 overflow-hidden">
      {children}
      <ReelChrome meta={meta} />
    </div>
  );
}

export const ReelsFeed = React.forwardRef<HTMLDivElement>(
  function ReelsFeed(_props, ref) {
    /* Stable ids rather than literals: two copies of reel A are on the page at
       once, and duplicate SVG gradient ids make the second one render against
       the first's definition. */
    const uid = React.useId().replace(/:/g, "");

    return (
      <div
        ref={ref}
        className="absolute left-0 top-0 w-full"
        style={{ height: "400%", willChange: "transform" }}
      >
        <Reel meta={OCTOPUS}>
          <OctopusReel gradientId={`${uid}-sea`} />
        </Reel>
        <Reel meta={AGENT}>
          <AgentReel gradientId={`${uid}-sky`} />
        </Reel>
        <Reel meta={CAT}>
          <CatReel gradientId={`${uid}-room`} glowId={`${uid}-glow`} />
        </Reel>
        {/* The copy of A that makes the wrap invisible. */}
        <Reel meta={OCTOPUS}>
          <OctopusReel gradientId={`${uid}-sea2`} />
        </Reel>
      </div>
    );
  },
);
