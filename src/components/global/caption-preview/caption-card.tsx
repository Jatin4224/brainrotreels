/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: CaptionCard, CaptionCardProps, ONE_CAPTION_RENDERER,
 *   ACTIVE_WORD, OVERFLOW_IS_A_BUG, RENDER_COLOURS_ARE_LITERAL,
 *   ANIMATION_IS_BOUNDED, PREVIEW_IS_THE_RENDER
 *
 * WHAT:  One caption card drawn at one instant: the words, in a style, with
 *        the word being spoken highlighted.
 *
 * WHY:   ONE_CAPTION_RENDERER, and this is the reason the component is global
 *        rather than living under src/remotion/. The phase's last check is
 *        "the same document produces identical captions in the Remotion
 *        Player and in a cloud render" — and the style gallery has to show
 *        the same thing again, before either exists. Three implementations
 *        would agree on the day they were written and drift by the next
 *        style. So there is ONE component, taking TIME as a prop: the
 *        Remotion layer passes a frame-derived second, the gallery passes an
 *        animated one, and nothing else differs. PREVIEW_IS_THE_RENDER.
 *
 *        It takes `seconds` rather than reading a clock or a frame, which is
 *        what keeps it usable inside a Remotion tree at all: a component
 *        there must be a pure function of its props and the frame
 *        (RENDER_DETERMINISM), and a component that called `useCurrentFrame`
 *        itself could not be mounted outside one.
 *
 *        ONE_COMPONENT_FOR_EVERY_STYLE. Thirty-eight styles, one renderer —
 *        the style is DATA (src/lib/captions/styles/), so the thirty-ninth
 *        touches no code. A component per style would be thirty-eight copies
 *        of the active-word logic, and the first to drift would be a style
 *        whose highlight lands a word late with nothing in the diff to show
 *        it.
 *
 *        RENDER_COLOURS_ARE_LITERAL — the documented exception to this
 *        codebase's theme-token rule, and only here. These pixels are
 *        composited into an MP4 by a headless browser with no stylesheet, no
 *        CSS variables and no dark mode; a `text-foreground` caption would
 *        render as the browser default over somebody's gameplay footage.
 *        Every colour comes from the style and every style has passed the
 *        contrast test (CONTRAST_IS_A_TEST_NOT_AN_EYE). The CHROME around
 *        this component — the gallery card, its border, its label — uses
 *        tokens like everything else.
 *
 *        OVERFLOW_IS_A_BUG: the text lays out inside the safe box from
 *        src/lib/captions/safe-zone.ts, with wrapping on and a hard width, so
 *        a hostile line breaks inside the frame rather than bleeding off it.
 * WHERE: src/remotion/components/captions.tsx (the render and the Player) and
 *        src/components/global/caption-preview/ (the gallery).
 */

import type { CSSProperties } from "react";

import {
  applyCaptionCase,
  captionBox,
  captionFontFamily,
  captionFontPx,
  captionTextShadow,
} from "@/lib/captions";
import type { CanvasSpec, WordToken } from "@/lib/timeline";
import type {
  CaptionAnimation,
  CaptionStyle,
  SafeZone,
} from "@/lib/types/caption";

export interface CaptionCardProps {
  style: CaptionStyle;
  /** The words on THIS card, already sliced to its range. */
  words: readonly WordToken[];
  /** Absolute position in the narration, in seconds. */
  seconds: number;
  canvas: CanvasSpec;
  safeZone: SafeZone;
  /** The caption item's own band, if it carries one. */
  y?: number | undefined;
  /**
   * SOURCE OF TRUTH KEYWORDS: speaker, COLOUR_IS_NEVER_THE_ONLY_SIGNAL
   *
   * Phase 12. Who is talking on this card, when per-speaker colouring is on.
   * ONE optional prop carrying BOTH the tint and the name tag, because the
   * phase requires the pairing and two props would make 'colour only' a
   * one-line shortcut — see COLOUR_IS_NEVER_THE_ONLY_SIGNAL in
   * src/lib/captions/speakers.ts for why that matters to about one man in
   * twelve.
   *
   * Absent for every single-voice video, which is every format but one, so the
   * card looks exactly as it did before this existed.
   */
  speaker?: { color: string; label: string } | undefined;
}

/** ANIMATION_IS_BOUNDED — see animationStyle. */
const ANIMATION_SECONDS = 0.18;

export function CaptionCard({
  style,
  words,
  seconds,
  canvas,
  safeZone,
  y,
  speaker,
}: CaptionCardProps) {
  if (words.length === 0) return null;

  const fontPx = captionFontPx(style, canvas);
  /* Two lines of room. The BOX is what prevents overflow; this is only how
   * much of it the block is assumed to need when the band is clamped. */
  const blockHeight = fontPx * style.lineHeight * 2;

  const box = captionBox({
    canvas,
    safeZone,
    band: y ?? style.position,
    blockHeight,
  });

  const shadow = captionTextShadow(style, fontPx);

  return (
    <div
      style={{
        position: "absolute",
        left: box.left,
        top: box.centerY - blockHeight / 2,
        width: box.width,
        height: blockHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          /* The gap IS the space between words. They are separate elements so
           * each can be highlighted, and a literal space character between
           * inline-blocks does not wrap predictably. */
          columnGap: fontPx * 0.26,
          rowGap: fontPx * Math.max(style.lineHeight - 1, 0.1),
          fontFamily: captionFontFamily(style.font),
          fontWeight: style.weight,
          fontSize: fontPx,
          lineHeight: style.lineHeight,
          letterSpacing: `${style.tracking}em`,
          textAlign: "center",
          /* OVERFLOW_IS_A_BUG — a word wider than the box breaks inside it
           * rather than bleeding off the frame. */
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {/* COLOUR_IS_NEVER_THE_ONLY_SIGNAL — the name tag is drawn whenever
            the tint is, in the same element, so one cannot ship without the
            other. It is part of the wrapping flow rather than absolutely
            positioned, so a long caption pushes it rather than overlapping
            it. */}
        {speaker === undefined ? null : (
          <span
            style={{
              fontSize: fontPx * 0.46,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: speaker.color,
              textShadow: shadow,
              /* A full-width row of its own, so the tag sits ABOVE the words
                 rather than inline with the first one. */
              flexBasis: "100%",
              textAlign: "center",
              opacity: 0.9,
            }}
          >
            {speaker.label}
          </span>
        )}

        {words.map((word) => (
          <CaptionWord
            key={word.i}
            word={word}
            seconds={seconds}
            fontPx={fontPx}
            shadow={shadow}
            style={style}
            tint={speaker?.color}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: CaptionWord, ACTIVE_WORD
 *
 * WHAT:  One word, cased, coloured and animated.
 * WHY:   A word that has ALREADY been spoken keeps the highlight colour
 *        rather than reverting to the resting fill. Reverting makes the card
 *        flicker between two colours as the highlight passes along it; keeping
 *        it reads as a line filling in, which is what every caption style
 *        this product imitates actually does.
 * WHERE: CaptionCard.
 */
function CaptionWord({
  word,
  seconds,
  fontPx,
  shadow,
  style,
  tint,
}: {
  word: WordToken;
  seconds: number;
  fontPx: number;
  shadow: string;
  style: CaptionStyle;
  /**
   * The speaker's colour, when per-speaker colouring is on. It replaces the
   * style's RESTING fill only — the highlight stays the style's own, so the
   * active word still reads as the active word. Tinting both would mean a card
   * where nothing stands out, which loses the thing captions are for in order
   * to show the thing the name tag already says.
   */
  tint?: string | undefined;
}) {
  const active = seconds >= word.s && seconds < word.e;
  const spoken = seconds >= word.e;

  /* 0 at the instant the word starts, 1 once the animation is done. Clamped
   * both ways, so a word not yet reached sits at its resting state rather
   * than at a negative transform. */
  const progress = clamp((seconds - word.s) / ANIMATION_SECONDS, 0, 1);
  const boxed = style.highlightBox !== null && (active || spoken);

  return (
    <span
      style={{
        display: "inline-block",
        color:
          active || spoken ? style.highlight : (tint ?? style.fill),
        textShadow: shadow,
        ...(boxed
          ? {
              padding: `0 ${fontPx * 0.12}px`,
              borderRadius: fontPx * 0.14,
              backgroundColor: style.highlightBox ?? undefined,
            }
          : {}),
        ...animationStyle(style.animation, active, progress, fontPx),
      }}
    >
      {applyCaptionCase(word.w, style.case)}
    </span>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: animationStyle, CAPTION_ANIMATIONS,
 *   ANIMATION_IS_BOUNDED
 *
 * WHAT:  The transform and opacity for one word at one instant.
 *
 * WHY:   ANIMATION_IS_BOUNDED. Every animation finishes within
 *        ANIMATION_SECONDS of the word starting, whatever the word's own
 *        length — an animation scaled to the word's span would make a long
 *        word's pop take half a second and a short one's a tenth, so the
 *        captions would appear to speed up and slow down with the speech.
 *
 *        Exhaustive over the union, so adding an animation to
 *        CAPTION_ANIMATIONS without implementing it is a compile error rather
 *        than a style that quietly does nothing.
 *
 *        The REST state is identical for every animation: no transform, full
 *        opacity. A resting state that varied per style would make the words
 *        either side of the active one jitter as the highlight moved.
 * WHERE: CaptionWord.
 */
function animationStyle(
  animation: CaptionAnimation,
  active: boolean,
  progress: number,
  fontPx: number,
): CSSProperties {
  if (!active) return {};

  switch (animation) {
    case "pop":
      return { transform: `scale(${1 + 0.16 * (1 - progress)})` };
    case "bounce":
      /* One half-cycle, not a loop: a looping bounce is still moving when the
       * next word starts, and two words bouncing at once reads as a glitch. */
      return {
        transform: `translateY(${-fontPx * 0.14 * Math.sin(Math.PI * progress)}px)`,
      };
    case "fade":
      return { opacity: 0.55 + 0.45 * progress };
    case "slide":
      return {
        transform: `translateX(${fontPx * 0.22 * (1 - progress)}px)`,
        opacity: 0.4 + 0.6 * progress,
      };
    default: {
      const exhaustive: never = animation;
      throw new Error(
        `[caption-preview] Unknown animation ${String(exhaustive)}`,
      );
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
