/**
 * SOURCE OF TRUTH KEYWORDS: scrollTimeline, THE_FEED_FOLLOWS_THE_FINGER,
 *   SEGMENT_MS, DRAG
 *
 * WHAT:  The scroll loop — one function from "time within a 4-second segment"
 *        to the three things that have to agree about a swipe: how far along
 *        the finger is, how far the feed has moved, and how full the progress
 *        bar is.
 *
 * WHY:   THE_FEED_FOLLOWS_THE_FINGER. The illusion the whole scene is built
 *        on is that the hand is DRIVING the phone, and that survives exactly
 *        as long as the feed and the fingertip are the same number. The moment
 *        they are two animations with similar timings, a viewer sees a hand
 *        waving near a screen that scrolls on its own. So there is one phase
 *        variable and one function: during the drag the feed offset is the
 *        finger's own eased position times the travel, not a curve that
 *        happens to look like it.
 *
 *        The release is the one place they separate, on purpose: the finger
 *        decelerates while the feed carries on past it to the next reel, which
 *        is what a flick IS.
 * WHERE: Called once a frame by LampScene, which writes `feedOffset` to the
 *        feed element, `progress` to the progress bar, and hands `{k, lift}`
 *        to the hand renderer as its base pose.
 */

import { DRAG, SEGMENT_MS, REEL_COUNT, easeInOutCubic } from "./geometry";

export interface TimelineFrame {
  /** Which reel is at the top of the viewport, 0‥2. */
  index: number;
  /** The finger's progress up the glass, 0 (resting) → 1 (end of the drag). */
  k: number;
  /** How far the fingertip is off the glass, in scene pixels. */
  lift: number;
  /** Extra scroll past `index`, in on-screen pixels. */
  feedOffset: number;
  /** The reel progress bar, 0‥1. */
  progress: number;
}

/** What the scene looks like when reduced motion has switched scrolling off. */
export const STILL_FRAME: TimelineFrame = {
  index: 0,
  k: 0,
  lift: 0,
  feedOffset: 0,
  progress: 0.4,
};

/**
 * `elapsed` is milliseconds since the loop's origin, `reelH` the on-screen
 * height of one reel. The phases, in fractions of a segment:
 *
 *   0  –.55  rest    a tiny idle float, nothing scrolls
 *  .55 –.60  press   the finger settles onto the glass
 *  .60 –.78  drag    the feed moves 1:1 with the finger
 *  .78 –.88  release the finger lifts, the feed flicks on to the next reel
 *  .88 –1    return  the finger comes back down to its resting spot
 */
export function scrollTimeline(elapsed: number, reelH: number): TimelineFrame {
  const cycle =
    ((elapsed % (SEGMENT_MS * REEL_COUNT)) + SEGMENT_MS * REEL_COUNT) %
    (SEGMENT_MS * REEL_COUNT);
  const index = Math.floor(cycle / SEGMENT_MS);
  const s = (cycle % SEGMENT_MS) / SEGMENT_MS;

  let k = 0;
  let lift = 0;
  let feedOffset = 0;

  if (s < 0.55) {
    /* Idle. A finger resting on glass is never perfectly still, and 1.2px of
       drift is the difference between a hand and a decal. */
    lift = 1.2 * Math.sin(s * 12);
  } else if (s < 0.6) {
    /* Press: the pad sinks the last pixel and a half into the glass. */
    lift = -1.5 * ((s - 0.55) / 0.05);
  } else if (s < 0.78) {
    const e = easeInOutCubic((s - 0.6) / 0.18);
    k = e;
    lift = -1.5;
    feedOffset = DRAG * e; // the 1:1 that the whole scene rests on
  } else if (s < 0.88) {
    const e = (s - 0.78) / 0.1;
    /* The flick. The feed keeps the momentum the finger gave it and runs on
       to the next reel while the finger itself decelerates and lifts away. */
    feedOffset = DRAG + (reelH - DRAG) * (1 - Math.pow(1 - e, 3));
    k = 1 - 0.45 * easeInOutCubic(e);
    lift = 34 * Math.sin((e * Math.PI) / 2);
  } else {
    const e = easeInOutCubic((s - 0.88) / 0.12);
    feedOffset = reelH;
    k = 0.55 * (1 - e);
    lift = 34 * (1 - e);
  }

  /* The bar fills across rest and drag, tops out for the flick, then is blank
     until the next reel starts — the same beat Instagram's own bar keeps. */
  const progress = s < 0.78 ? s / 0.78 : s < 0.88 ? 1 : 0;

  return { index, k, lift, feedOffset, progress };
}
