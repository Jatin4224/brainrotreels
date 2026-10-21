/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: CaptionPreview, SAMPLE_CAPTION_WORDS,
 *   PREVIEW_IS_THE_RENDER, PREVIEW_BACKGROUNDS, SCALED_NOT_REIMPLEMENTED,
 *   CaptionCard
 *
 * WHAT:  A live caption preview — the same renderer the video uses, scaled
 *        into a card, looping over a sample line or a project's real words.
 *
 * WHY:   PREVIEW_IS_THE_RENDER. It mounts `CaptionCard`, which is the
 *        component the Remotion layer mounts, so a style looks the same in
 *        the gallery, in the Player and in the finished file. A gallery that
 *        drew its own approximation would be wrong exactly where it matters —
 *        at the edges of the safe zone, on a long word, on the one style
 *        somebody changed last week.
 *
 *        SCALED_NOT_REIMPLEMENTED: the card is rendered at FULL canvas size
 *        inside a CSS `scale`, rather than at preview size. Rendering small
 *        would make every derived pixel — the font, the stroke ring, the safe
 *        inset — round differently from the render, which is how a caption
 *        that fits in the preview overflows in the video.
 *
 *        PREVIEW_BACKGROUNDS are the two the contrast rule is measured
 *        against, plus the customer's own footage when there is any. Offering
 *        light and dark is not decoration: it is the gallery showing the same
 *        worst cases the test checks, so a legibility problem is visible
 *        before a render rather than after one.
 *
 *        The animation runs on `requestAnimationFrame` rather than a CSS
 *        animation, because the card is driven by a TIME prop — the same prop
 *        Remotion drives from the frame number. A CSS keyframe here would be
 *        a second animation implementation that the render does not have.
 * WHERE: The caption style gallery; Phase 15's editor.
 */

import * as React from "react";

import { CaptionCard } from "./caption-card";
import { buildCaptionTrack, captionBox, getCaptionStyle } from "@/lib/captions";
import type { CanvasSpec, WordToken } from "@/lib/timeline";
import type { CaptionPosition, SafeZone } from "@/lib/types/caption";

export { CaptionCard } from "./caption-card";
export type { CaptionCardProps } from "./caption-card";

/**
 * SOURCE OF TRUTH KEYWORDS: SAMPLE_CAPTION_WORDS
 *
 * The line a style is previewed with when a project has no words yet.
 * Chosen to exercise what a style can get wrong: a long word, a short one, a
 * comma to break on, and enough of them to fill two cards at any grouping.
 */
export const SAMPLE_CAPTION_WORDS: readonly WordToken[] = [
  "So",
  "there",
  "I",
  "was,",
  "absolutely",
  "convinced",
  "this",
  "would",
  "work.",
].map((w, i) => ({ i, w, s: i * 0.36, e: (i + 1) * 0.36 }));

export const PREVIEW_BACKGROUNDS = [
  { id: "dark", label: "Dark", color: "#101010" },
  { id: "light", label: "Light", color: "#FFFFFF" },
] as const;

export type PreviewBackgroundId = (typeof PREVIEW_BACKGROUNDS)[number]["id"];

export interface CaptionPreviewProps {
  styleId: string;
  /** The project's real words, when it has been aligned. */
  words?: readonly WordToken[] | undefined;
  wordsPerChunk?: number | undefined;
  position?: CaptionPosition | undefined;
  safeZone?: SafeZone | undefined;
  background?: PreviewBackgroundId | undefined;
  /** The rendered width in CSS pixels; the height follows the canvas. */
  width?: number;
  /** Off for a grid of forty cards, on for the one being inspected. */
  animated?: boolean;
  /** Draws the platform's safe area, so the margins are visible. */
  showSafeZone?: boolean;
  canvas?: CanvasSpec;
}

/** 9:16, the format this product is for. */
const DEFAULT_CANVAS: CanvasSpec = { width: 1080, height: 1920, fps: 30 };

export function CaptionPreview({
  styleId,
  words,
  wordsPerChunk,
  position,
  safeZone = "none",
  background = "dark",
  width = 200,
  animated = false,
  showSafeZone = false,
  canvas = DEFAULT_CANVAS,
}: CaptionPreviewProps) {
  const style = getCaptionStyle(styleId);
  const source = words !== undefined && words.length > 0 ? words : SAMPLE_CAPTION_WORDS;

  /* The SAME grouping the render uses, so the preview shows the real cards
   * rather than a guess at them. */
  const track = React.useMemo(
    () =>
      buildCaptionTrack(source, style.id, {
        ...(wordsPerChunk !== undefined ? { maxWords: wordsPerChunk } : {}),
        ...(position !== undefined ? { position } : {}),
      }),
    [source, style.id, wordsPerChunk, position],
  );

  const lastWord = source[source.length - 1];
  const loopSeconds = Math.max(lastWord?.e ?? 1, 0.5);
  const seconds = useLoopingSeconds(animated, loopSeconds);

  const item =
    track.items.find((candidate) => {
      const first = source[candidate.startWord];
      const last = source[candidate.endWord];
      return first !== undefined && last !== undefined && seconds < last.e;
    }) ?? track.items[0];

  const slice =
    item === undefined
      ? []
      : source.slice(item.startWord, item.endWord + 1);

  const scale = width / canvas.width;
  const background_ =
    PREVIEW_BACKGROUNDS.find((entry) => entry.id === background) ??
    PREVIEW_BACKGROUNDS[0];

  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        width,
        height: canvas.height * scale,
        overflow: "hidden",
        borderRadius: 8,
        backgroundColor: background_.color,
      }}
    >
      {/* SCALED_NOT_REIMPLEMENTED — full canvas, scaled down as a whole. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: canvas.width,
          height: canvas.height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {showSafeZone ? <SafeZoneGuide canvas={canvas} safeZone={safeZone} /> : null}
        <CaptionCard
          style={style}
          words={slice}
          seconds={seconds}
          canvas={canvas}
          safeZone={safeZone}
          y={item?.position?.y}
        />
      </div>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: useLoopingSeconds, PREVIEW_IS_THE_RENDER
 *
 * WHAT:  A looping clock, in seconds, or a fixed instant when not animating.
 * WHY:   A grid of forty animated cards is forty rAF loops and a visibly hot
 *        laptop, so a card only animates when it is the one being inspected.
 *        The still frame is taken a little into the line rather than at zero,
 *        so a static card still shows the style's highlight — a gallery of
 *        cards all showing their resting state hides the one thing that
 *        distinguishes a karaoke style from a plain one.
 * WHERE: CaptionPreview.
 */
function useLoopingSeconds(animated: boolean, loopSeconds: number): number {
  /* The still frame, as a derived value rather than initial state — state
   * that mirrors a prop has to be re-synced from an effect, and a setState in
   * an effect body is a cascading render on every card in the grid. */
  const still = loopSeconds * 0.4;
  const [elapsed, setElapsed] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!animated) return;

    let raf = 0;
    const started = performance.now();

    const tick = (now: number) => {
      /* In the rAF callback, not in the effect body — see above. */
      setElapsed(((now - started) / 1000) % loopSeconds);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [animated, loopSeconds]);

  return animated && elapsed !== null ? elapsed : still;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SafeZoneGuide, SAFE_ZONE_IS_PER_PLATFORM
 *
 * WHAT:  The platform's safe area, drawn as a dashed outline.
 * WHY:   The margins are the part of a caption decision nobody can see until
 *        it is wrong on a phone. Drawing them makes "this sits under TikTok's
 *        button rail" a visible fact at the moment the position is chosen.
 *        It is a GUIDE, not chrome, so it is a literal colour like the
 *        caption itself and not a theme token — it is painted over video.
 * WHERE: The big preview on the captions screen.
 */
function SafeZoneGuide({
  canvas,
  safeZone,
}: {
  canvas: CanvasSpec;
  safeZone: SafeZone;
}) {
  const box = captionSafeRect(canvas, safeZone);

  return (
    <div
      style={{
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        border: "4px dashed rgba(255, 255, 255, 0.35)",
        borderRadius: 16,
        pointerEvents: "none",
      }}
    />
  );
}

/** Through the same helper the renderer uses, so the guide cannot disagree
 * with the box captions are actually laid out in. A zero block height asks
 * for the rectangle itself rather than a position inside it. */
function captionSafeRect(canvas: CanvasSpec, safeZone: SafeZone) {
  return captionBox({ canvas, safeZone, band: "middle", blockHeight: 0 });
}
