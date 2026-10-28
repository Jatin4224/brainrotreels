/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: RedditCard, redditCardPropsSchema,
 *   CARD_ELEMENT_IS_MATCHED_BY_KIND, PARSE_AT_THE_COMPONENT, DETERMINISM,
 *   NO_REDDIT_BRANDING, PALETTE_IS_BAKED_ONTO_THE_ITEM, CARD_FITS_ITS_TITLE
 *
 * WHAT:  The title scene of a Reddit story: the post's title on a stylised
 *        card, with its subreddit and the poster's name.
 *
 * WHY:   NO_REDDIT_BRANDING, which is the first decision and the one worth
 *        stating loudest. This card does NOT reproduce Reddit's logo, its
 *        wordmark, its orange, its snoo or its exact UI chrome. Those are
 *        trademarks, and a video that looks like it came FROM Reddit is a
 *        different legal problem from a video that quotes a thread — which is
 *        the problem Phase 12 is already careful about everywhere else (the
 *        official API, the retention window, the usernames that never reach a
 *        model). So the card is OUR card: the app's own palette, a neutral
 *        rounded surface, and the subreddit written as plain text the way any
 *        attribution would be.
 *
 *        PALETTE_IS_BAKED_ONTO_THE_ITEM. A component receives `item`, `assets`,
 *        `frames` and `canvas` and NOT the document
 *        (RENDER_COMPONENT_CONTRACT), so it cannot read `doc.style.paletteId` —
 *        the generator resolves the palette once and writes the id onto the
 *        element, exactly as it does for the backdrop.
 *
 *        CARD_ELEMENT_IS_MATCHED_BY_KIND, again as the backdrop does: the
 *        element is found by its `kind` rather than by its position, so an
 *        editor that prepends an element to the scene cannot silently change
 *        which one supplies the title.
 *
 *        CARD_FITS_ITS_TITLE. Reddit titles run from four words to three
 *        hundred characters, and a fixed font size either wastes the frame on
 *        the short ones or overflows on the long ones. The size is therefore
 *        stepped by title LENGTH — a small number of bands rather than a
 *        continuous fit, because a continuous one makes every card a slightly
 *        different size and the set stops looking designed.
 *
 *        PARSE_AT_THE_COMPONENT, like every other component here: the walker
 *        hands over a loose `item` that crossed a JSON serialisation (Remotion
 *        ships props to each worker, and Phase 04 ships them to Lambda), so
 *        this narrows what it needs with a real schema.
 *
 *        DETERMINISM: no clock, no randomness, nothing read from outside the
 *        props. The entrance animation is driven by `useCurrentFrame()`, which
 *        is the frame's own number — so a frame here is a pure function of its
 *        number, which is what Phase 04's render reuse rests on.
 * WHERE: Registered as `redditCard` in src/remotion/registry.ts. Written by
 *        src/lib/generators/reddit-story.ts.
 */

import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { z } from "zod";

import { RENDER_FONT_FAMILY } from "@/lib/captions/fonts";
import { getPalette } from "@/lib/palettes";
import { REDDIT_CARD_ELEMENT_KIND } from "@/lib/generators";
import type { RenderItemProps } from "@/lib/types";

/**
 * SOURCE OF TRUTH KEYWORDS: redditCardPropsSchema
 *
 * WHAT:  The content a card reads out of its scene spec.
 * WHY:   `passthrough()` on the element, because a scene element's knobs belong
 *        to its family and the schema here names only what THIS component
 *        draws — a future prop added by the generator must not fail the parse
 *        and blank the card.
 */
const redditCardPropsSchema = z.object({
  scene: z
    .object({
      elements: z
        .array(
          z
            .object({
              kind: z.string().optional(),
              text: z.string().optional(),
              props: z
                .object({
                  subreddit: z.string().optional(),
                  author: z.string().optional(),
                  paletteId: z.string().min(1).max(60).optional(),
                })
                .partial()
                .passthrough()
                .optional(),
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough()
    .optional(),
});

/**
 * SOURCE OF TRUTH KEYWORDS: TITLE_SIZE_BANDS, CARD_FITS_ITS_TITLE
 *
 * Font size as a fraction of canvas HEIGHT, by title length. Fractions rather
 * than pixels for the reason the text overlay records: the same document has to
 * render at 1080x1920 and at the editor's proxy without a second layout pass.
 *
 * Three bands, widest first. A fourth would be invisible; a continuous fit
 * would make no two cards the same size.
 */
const TITLE_SIZE_BANDS: readonly { upTo: number; ratio: number }[] = [
  { upTo: 60, ratio: 0.052 },
  { upTo: 140, ratio: 0.042 },
  { upTo: Number.POSITIVE_INFINITY, ratio: 0.034 },
];

/** The entrance: a short rise and fade, in frames. */
const ENTER_FRAMES = 10;

export function RedditCard({ item, canvas }: RenderItemProps) {
  const frame = useCurrentFrame();
  const parsed = redditCardPropsSchema.safeParse(item);

  const element = parsed.success
    ? parsed.data.scene?.elements?.find(
        (candidate) => candidate.kind === REDDIT_CARD_ELEMENT_KIND,
      )
    : undefined;

  const title = element?.text?.trim() ?? "";
  /* UNLIKE the backdrop, an unparseable card draws NOTHING. A gradient has an
   * obvious safe answer; a title card has none — an empty card over somebody's
   * video is worse than four seconds of the video itself, which is exactly
   * what the absence leaves. */
  if (title.length === 0) return null;

  const palette = getPalette(element?.props?.paletteId);
  const subreddit = element?.props?.subreddit?.trim() ?? "";
  const author = element?.props?.author?.trim() ?? "";

  const ratio =
    TITLE_SIZE_BANDS.find((band) => title.length <= band.upTo)?.ratio ??
    /* Unreachable — the last band is unbounded — but a `!` is banned and a
     * missing size would render at the browser default. */
    0.034;

  /* A rise and a fade, clamped so the card is fully settled for the rest of
   * its span. `extrapolateRight: "clamp"` is what makes this deterministic
   * past the entrance rather than drifting. */
  const progress = interpolate(frame, [0, ENTER_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        /* The card is centred and horizontally inset, not full-bleed: it has
         * to read as a card sitting ON the video rather than as a second
         * background. */
        padding: `0 ${0.07 * canvas.width}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: progress,
        transform: `translateY(${(1 - progress) * 0.03 * canvas.height}px)`,
      }}
    >
      <div
        style={{
          width: "100%",
          /* OUR surface, not Reddit's — see NO_REDDIT_BRANDING. The palette's
             own text colour is guaranteed legible over its `from` stop, so the
             card is tinted from the same two values the backdrop uses. */
          background: palette.from,
          border: `${Math.max(2, 0.002 * canvas.height)}px solid ${palette.accent}`,
          borderRadius: 0.028 * canvas.height,
          padding: `${0.035 * canvas.height}px ${0.04 * canvas.width}px`,
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.45)",
          display: "flex",
          flexDirection: "column",
          gap: 0.018 * canvas.height,
        }}
      >
        {subreddit.length > 0 ? (
          <span
            style={{
              fontFamily: RENDER_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 0.022 * canvas.height,
              letterSpacing: "0.04em",
              color: palette.accent,
            }}
          >
            {/* Plain-text attribution. A subreddit name is a fact about where
                the story came from, not a logo. */}
            r/{subreddit}
          </span>
        ) : null}

        <h1
          style={{
            margin: 0,
            fontFamily: RENDER_FONT_FAMILY,
            fontWeight: 700,
            fontSize: ratio * canvas.height,
            lineHeight: 1.18,
            color: palette.text,
            /* A 300-character title must wrap rather than bleed off the
               frame. */
            overflowWrap: "break-word",
          }}
        >
          {title}
        </h1>

        {author.length > 0 ? (
          <span
            style={{
              fontFamily: RENDER_FONT_FAMILY,
              fontWeight: 400,
              fontSize: 0.02 * canvas.height,
              /* The palette's text colour at reduced opacity rather than a
                 second hardcoded grey — the card has to stay legible in every
                 palette, including the light ones. */
              color: palette.text,
              opacity: 0.72,
            }}
          >
            {/* AUTHOR_IS_DISPLAY_ONLY — shown as attribution, never
                synthesised as a voice. */}
            u/{author}
          </span>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
