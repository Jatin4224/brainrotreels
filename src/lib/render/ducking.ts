/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: duckingVolumeAt, DUCK_LEVEL, DUCK_RAMP_SECONDS,
 *   DUCKING_CURVE, DUCK_IS_A_REQUEST, narrationWindows
 *
 * WHAT:  How loud a duckable audio item should be at a given frame, given when
 *        narration is playing.
 * WHY:   DUCK_IS_A_REQUEST. The document stores `duck: true`, never a volume
 *        curve, and the timeline schema says why: encoding the curve would
 *        freeze it against narration that has not been recorded yet. So the
 *        curve is computed from where the narration actually is, which means
 *        re-recording a line re-ducks the music with no document change.
 *
 *        It lives HERE rather than in the audio component for the same reason
 *        the frame plan does (PLAN_IS_PURE): it is arithmetic with boundary
 *        cases that each have a plausible wrong answer — a frame inside the
 *        ramp, two overlapping narration lines, a line starting at frame 0 so
 *        the ramp has nowhere to run — and all of them are testable without
 *        mounting a composition or decoding audio.
 *
 *        DUCKING_CURVE is a ramp, not a switch. A bed that cuts from full to
 *        25% on one frame is audible as a click; 150ms is inaudible as a
 *        transition and is what a broadcast mixer does. It is a pure function
 *        of the frame number, so it stays deterministic (RENDER_DETERMINISM).
 * WHERE: AudioClip in src/remotion/components/audio-clip.tsx; the windows are
 *        collected by TimelineRenderer.
 */

/**
 * How far a ducked item drops. -12dB (≈0.25 linear) is the usual broadcast
 * figure for music under speech: enough for every word to sit clearly on top,
 * not so much that the bed disappears and the cut back up becomes the loudest
 * thing in the video.
 */
export const DUCK_LEVEL = 0.25;

/** The ramp in and out, in seconds. See DUCKING_CURVE. */
export const DUCK_RAMP_SECONDS = 0.15;

export interface FrameWindow {
  from: number;
  durationInFrames: number;
}

export function duckingVolumeAt(args: {
  frame: number;
  fps: number;
  windows: readonly FrameWindow[];
}): number {
  const { frame, fps, windows } = args;
  if (windows.length === 0) return 1;

  /* At least one frame, so a very low fps cannot round the ramp to zero and
   * reintroduce the click the ramp exists to remove. */
  const ramp = Math.max(1, Math.round(DUCK_RAMP_SECONDS * fps));

  /* The DEEPEST duck any window asks for wins. With two overlapping narration
   * lines, taking the last or the average would let the bed rise between them
   * — audible as a swell in the middle of a sentence. */
  let deepest = 1;

  for (const window of windows) {
    const start = window.from;
    const end = window.from + window.durationInFrames;

    /* Fully ducked for the body of the window. */
    if (frame >= start && frame < end) {
      deepest = Math.min(deepest, DUCK_LEVEL);
      continue;
    }

    /* Ramping DOWN in the frames just before it starts, so the bed is already
     * low when the first syllable lands rather than dipping under it. */
    if (frame < start && frame > start - ramp) {
      const progress = (frame - (start - ramp)) / ramp;
      deepest = Math.min(deepest, 1 - (1 - DUCK_LEVEL) * progress);
      continue;
    }

    /* Ramping back UP after it ends. */
    if (frame >= end && frame < end + ramp) {
      const progress = (frame - end) / ramp;
      deepest = Math.min(deepest, DUCK_LEVEL + (1 - DUCK_LEVEL) * progress);
    }
  }

  return deepest;
}
