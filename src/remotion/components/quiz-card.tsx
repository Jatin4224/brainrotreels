/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: QuizCard, quizCardPropsSchema, fitTextRatio,
 *   CARD_FITS_ITS_TEXT, SHRINK_BEFORE_TRUNCATE, ONE_FAMILY_FOUR_LAYOUTS,
 *   COUNTDOWN_RING_IS_DETERMINISTIC, CORRECT_IS_NEVER_ONLY_COLOUR,
 *   PARSE_AT_THE_COMPONENT, DETERMINISM, OPTION_ORDER_IS_ITS_INDEX
 *
 * WHAT:  The four cards of a quiz video — the intro, a question with its
 *        options and a countdown ring, the reveal with the correct answer
 *        marked, and the outro.
 *
 * WHY:   ONE_FAMILY_FOUR_LAYOUTS. All four are one render kind (`quizCard`)
 *        switching on `scene.layout`, not four registry entries, and the reason
 *        is in what they share rather than in what they do: the palette read,
 *        the safe-zone box, the auto-shrink, the entrance and the typography
 *        are identical, and only the elements drawn differ. Four components
 *        would be four copies of `fitTextRatio`, and the third copy would be
 *        the one with a slightly different step.
 *
 *        An unrecognised layout falls back to the QUESTION card when the scene
 *        has options, which is not defensive clutter: `quizFixture` in
 *        src/lib/timeline/fixtures/quiz.ts predates this phase and uses
 *        `quiz-four-up`, and a document written by a newer release has to
 *        degrade rather than draw nothing (UNKNOWN_DRAWS_NOTHING is the
 *        registry's rule for an unknown KIND; a known kind with an unfamiliar
 *        layout can do better than that).
 *
 *        CARD_FITS_ITS_TEXT and SHRINK_BEFORE_TRUNCATE are the phase's step 6,
 *        and the order of preference is stated there: "step the font size down
 *        within a defined range, wrap, and only truncate with an ellipsis as a
 *        genuine last resort. A clipped question is a broken video; a slightly
 *        smaller one is not."
 *
 *        So the size is chosen from the text's LENGTH, in bands, before
 *        anything is laid out — and nothing here measures the DOM. That is a
 *        constraint rather than a shortcut: this component runs in a Lambda
 *        worker during a paid render, and a layout that depended on a measured
 *        text node would be a layout that could differ between the browser
 *        preview and the render. A frame has to be a pure function of its
 *        number and its props for Phase 04's render reuse to be correct, and
 *        measurement is how that quietly stops being true.
 *
 *        Bands rather than a continuous fit for the reason the Reddit card
 *        records (TITLE_SIZE_BANDS): a continuous fit makes no two cards the
 *        same size and the set stops looking designed. The last band is sized
 *        so that the longest text the SCHEMA allows — 200 characters, which is
 *        the cap `quizQuestionSchema` enforces — fits the safe box with room
 *        to wrap. Truncation is therefore unreachable through the product's own
 *        forms; the ellipsis exists for a document written by hand or by a
 *        future release with a higher cap, and `-webkit-line-clamp` is what
 *        applies it without measuring.
 *
 *        CORRECT_IS_NEVER_ONLY_COLOUR, which is the same argument Phase 12
 *        makes for per-speaker captions (COLOUR_IS_NEVER_THE_ONLY_SIGNAL) and
 *        it matters more here, because the information is the entire point of
 *        the video. Roughly one man in twelve cannot reliably distinguish a
 *        green row from a neutral one, and for them a reveal that tints the
 *        right answer has revealed nothing. So the correct option is marked
 *        THREE ways at once — a tick, a heavier weight and the accent fill —
 *        and the tick is the one that does the work.
 *
 *        OPTION_ORDER_IS_ITS_INDEX. Options are sorted by `props.index` rather
 *        than drawn in array order, because an editor is free to reorder a
 *        scene's elements and a quiz whose options silently rearranged would
 *        move the answer away from `correctIndex`. The generator's own note
 *        says so from the other side (QUIZ_ELEMENT_KINDS).
 *
 *        COUNTDOWN_RING_IS_DETERMINISTIC. The ring is driven by
 *        `useCurrentFrame()` and the ring's OWN length in seconds, which the
 *        generator wrote onto the element — not by the item's duration. The
 *        question card is on screen for its narration AND the countdown, so a
 *        ring spanning the item would be wrong for the whole first half of
 *        every question. It runs over the LAST `seconds` of the card, which is
 *        exactly the silent beat `layNarration` left.
 *
 *        PARSE_AT_THE_COMPONENT, like every other component here: the walker
 *        hands over a loose `item` that crossed a JSON serialisation (Remotion
 *        ships props to each worker, and Phase 04 ships them to Lambda), so
 *        this narrows what it needs with a real schema and `passthrough()` on
 *        the parts whose knobs belong to the family.
 *
 *        DETERMINISM: no clock, no randomness, no measurement, nothing read
 *        from outside the props.
 * WHERE: Registered as `quizCard` in src/remotion/registry.ts. Written by
 *        src/lib/generators/quiz.ts.
 */

import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { z } from "zod";

import { RENDER_FONT_FAMILY } from "@/lib/captions/fonts";
import { QUIZ_ELEMENT_KINDS, QUIZ_LAYOUTS } from "@/lib/generators";
import { getPalette } from "@/lib/palettes";
import { SAFE_ZONE_INSETS, safeZoneSchema } from "@/lib/types/caption";
import type { RenderItemProps } from "@/lib/types";

/**
 * SOURCE OF TRUTH KEYWORDS: quizCardPropsSchema
 *
 * WHAT:  The content a quiz card reads out of its scene spec.
 * WHY:   `passthrough()` on the element and on its props, because a scene
 *        element's knobs belong to its family and the schema here names only
 *        what THIS component draws — a future prop added by the generator must
 *        not fail the parse and blank the card.
 *
 *        `index` and `correct` are parsed rather than read loosely because both
 *        change what is drawn: one decides where an option sits and the other
 *        decides whether it is marked as the answer.
 */
const quizCardPropsSchema = z.object({
  scene: z
    .object({
      layout: z.string().optional(),
      elements: z
        .array(
          z
            .object({
              id: z.string().optional(),
              kind: z.string().optional(),
              text: z.string().optional(),
              props: z
                .object({
                  paletteId: z.string().min(1).max(60).optional(),
                  safeZone: safeZoneSchema.optional(),
                  showOptions: z.boolean().optional(),
                  index: z.number().optional(),
                  correct: z.boolean().optional(),
                  seconds: z.number().optional(),
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
 * SOURCE OF TRUTH KEYWORDS: PROMPT_SIZE_BANDS, CARD_FITS_ITS_TEXT
 *
 * Font size as a fraction of canvas HEIGHT, by text length. Fractions rather
 * than pixels for the reason the text overlay and the Reddit card both record:
 * the same document has to render at 1080x1920 and at the editor's 480p proxy
 * without a second layout pass.
 *
 * Four bands, widest first. The last covers everything up to the schema's
 * 200-character cap, and is sized so that the cap WRAPS inside the safe box
 * rather than reaching the ellipsis — see SHRINK_BEFORE_TRUNCATE.
 */
const PROMPT_SIZE_BANDS: readonly { upTo: number; ratio: number }[] = [
  { upTo: 40, ratio: 0.054 },
  { upTo: 90, ratio: 0.044 },
  { upTo: 140, ratio: 0.036 },
  { upTo: Number.POSITIVE_INFINITY, ratio: 0.03 },
];

/**
 * SOURCE OF TRUTH KEYWORDS: OPTION_SIZE_BANDS
 *
 * The same idea for an option, stepped on the LONGEST option rather than on
 * each one: four options at four different sizes reads as a rendering fault,
 * and the list has to look like a list.
 */
const OPTION_SIZE_BANDS: readonly { upTo: number; ratio: number }[] = [
  { upTo: 18, ratio: 0.03 },
  { upTo: 36, ratio: 0.026 },
  { upTo: Number.POSITIVE_INFINITY, ratio: 0.022 },
];

/**
 * SOURCE OF TRUTH KEYWORDS: PROMPT_LINE_CLAMP, SHRINK_BEFORE_TRUNCATE
 *
 * The last resort, and it is genuinely last: the smallest band fits the
 * schema's longest allowed question inside the safe box, so this is reached
 * only by a document written outside the product's own forms. Line-clamping is
 * how an ellipsis is applied WITHOUT measuring anything, which keeps the frame
 * a pure function of its props.
 */
const PROMPT_LINE_CLAMP = 6;
const OPTION_LINE_CLAMP = 2;

/** The entrance: a short rise and fade, in frames. */
const ENTER_FRAMES = 8;

export function QuizCard({ item, canvas, frames }: RenderItemProps) {
  const frame = useCurrentFrame();
  const parsed = quizCardPropsSchema.safeParse(item);
  const elements = parsed.success ? (parsed.data.scene?.elements ?? []) : [];

  const prompt = elements.find(
    (element) => element.kind === QUIZ_ELEMENT_KINDS.prompt,
  );
  const promptText = prompt?.text?.trim() ?? "";

  /* An unparseable or empty card draws NOTHING, the same decision the Reddit
   * card makes and for the same reason: a gradient has an obvious safe answer
   * and a card has none. An empty card over somebody's video is worse than the
   * video, which is exactly what the absence leaves. */
  if (promptText.length === 0) return null;

  const palette = getPalette(prompt?.props?.paletteId);
  const insets = SAFE_ZONE_INSETS[prompt?.props?.safeZone ?? "none"];

  const options = elements
    .filter((element) => element.kind === QUIZ_ELEMENT_KINDS.option)
    /* OPTION_ORDER_IS_ITS_INDEX — never the array's order. */
    .map((element, fallbackIndex) => ({
      index: element.props?.index ?? fallbackIndex,
      text: element.text?.trim() ?? "",
      correct: element.props?.correct === true,
    }))
    .filter((option) => option.text.length > 0)
    .sort((a, b) => a.index - b.index);

  const note = elements.find(
    (element) => element.kind === QUIZ_ELEMENT_KINDS.note,
  );
  const noteText = note?.text?.trim() ?? "";

  const countdown = elements.find(
    (element) => element.kind === QUIZ_ELEMENT_KINDS.countdown,
  );
  const countdownSeconds = countdown?.props?.seconds ?? 0;

  const layout = parsed.success
    ? (parsed.data.scene?.layout ?? "")
    : "";
  const view = resolveView(layout, options.length > 0);

  const showOptions =
    view !== "headline" &&
    options.length > 0 &&
    /* ANSWER_TYPE_IS_PRESENTATION — an `open` quiz keeps its options in the
     * document (the reveal needs them) and simply does not draw them on the
     * question card. The REVEAL always draws them: that is the reveal. */
    (view === "reveal" || prompt?.props?.showOptions !== false);

  const progress = interpolate(frame, [0, ENTER_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const promptRatio = bandFor(PROMPT_SIZE_BANDS, promptText.length);
  const optionRatio = bandFor(
    OPTION_SIZE_BANDS,
    options.reduce((longest, option) => Math.max(longest, option.text.length), 0),
  );

  return (
    <AbsoluteFill
      style={{
        /* The safe zone as real padding, so everything below is laid out
         * INSIDE the platform's chrome rather than being nudged away from it
         * afterwards — OVERFLOW_IS_A_BUG, the same construction the caption
         * box uses. */
        paddingLeft: insets.sides * canvas.width,
        paddingRight: insets.sides * canvas.width,
        paddingTop: insets.top * canvas.height,
        paddingBottom: insets.bottom * canvas.height,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
        gap: 0.025 * canvas.height,
        opacity: progress,
        transform: `translateY(${(1 - progress) * 0.02 * canvas.height}px)`,
      }}
    >
      <div
        style={{
          borderRadius: 0.024 * canvas.height,
          background: palette.from,
          border: `${Math.max(2, 0.0018 * canvas.height)}px solid ${palette.accent}`,
          padding: `${0.03 * canvas.height}px ${0.035 * canvas.width}px`,
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.45)",
          display: "flex",
          flexDirection: "column",
          gap: 0.016 * canvas.height,
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: RENDER_FONT_FAMILY,
            fontWeight: 700,
            fontSize: promptRatio * canvas.height,
            lineHeight: 1.18,
            textAlign: "center",
            color: palette.text,
            /* Wrap first (SHRINK_BEFORE_TRUNCATE); the clamp is the last
             * resort and is unreachable through the product's own forms. */
            overflowWrap: "break-word",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: PROMPT_LINE_CLAMP,
            overflow: "hidden",
          }}
        >
          {promptText}
        </p>

        {view === "headline" && noteText.length > 0 ? (
          <span
            style={{
              fontFamily: RENDER_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 0.026 * canvas.height,
              textAlign: "center",
              letterSpacing: "0.04em",
              color: palette.accent,
            }}
          >
            {noteText}
          </span>
        ) : null}
      </div>

      {showOptions ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0.014 * canvas.height,
          }}
        >
          {options.map((option) => {
            const marked = view === "reveal" && option.correct;
            return (
              <div
                key={option.index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.02 * canvas.width,
                  borderRadius: 0.016 * canvas.height,
                  /* CORRECT_IS_NEVER_ONLY_COLOUR — the fill is one of three
                   * signals, not the signal. */
                  background: marked ? palette.accent : palette.from,
                  border: `${Math.max(2, 0.0014 * canvas.height)}px solid ${palette.accent}`,
                  padding: `${0.018 * canvas.height}px ${0.028 * canvas.width}px`,
                  opacity: view === "reveal" && !marked ? 0.55 : 1,
                }}
              >
                <span
                  style={{
                    fontFamily: RENDER_FONT_FAMILY,
                    fontWeight: 700,
                    fontSize: optionRatio * canvas.height,
                    color: marked ? palette.from : palette.accent,
                    minWidth: 0.04 * canvas.width,
                  }}
                >
                  {/* A letter rather than a number, so the narration's
                      "question three" cannot be confused with an option. */}
                  {optionLetter(option.index)}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontFamily: RENDER_FONT_FAMILY,
                    fontWeight: marked ? 700 : 400,
                    fontSize: optionRatio * canvas.height,
                    lineHeight: 1.2,
                    color: marked ? palette.from : palette.text,
                    overflowWrap: "break-word",
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: OPTION_LINE_CLAMP,
                    overflow: "hidden",
                  }}
                >
                  {option.text}
                </span>
                {marked ? (
                  <span
                    aria-hidden
                    style={{
                      fontFamily: RENDER_FONT_FAMILY,
                      fontWeight: 700,
                      fontSize: optionRatio * canvas.height,
                      color: palette.from,
                    }}
                  >
                    {/* The signal that does not depend on colour vision at
                        all — see CORRECT_IS_NEVER_ONLY_COLOUR. */}
                    ✓
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {view === "reveal" && noteText.length > 0 ? (
        <p
          style={{
            margin: 0,
            fontFamily: RENDER_FONT_FAMILY,
            fontWeight: 400,
            fontSize: 0.024 * canvas.height,
            lineHeight: 1.3,
            textAlign: "center",
            /* The palette's own text colour at reduced opacity rather than a
               second hardcoded grey — a card has to stay legible in every
               palette, including the light ones. */
            color: palette.text,
            opacity: 0.78,
            overflowWrap: "break-word",
          }}
        >
          {noteText}
        </p>
      ) : null}

      {view === "question" && countdownSeconds > 0 ? (
        <CountdownRing
          seconds={countdownSeconds}
          frame={frame}
          durationInFrames={frames.durationInFrames}
          canvas={canvas}
          accent={palette.accent}
          text={palette.text}
        />
      ) : null}
    </AbsoluteFill>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveView, LAYOUT_PICKS_THE_CARD
 *
 * WHAT:  Which of the three drawings a layout asks for.
 * WHY:   The intro and the outro are ONE view (`headline`), because they are
 *        the same card with different words — a prompt and a short note, no
 *        options, no ring. Giving them separate branches would be two copies
 *        of one layout kept in step by hand.
 *
 *        An unfamiliar layout with options becomes a QUESTION card and one
 *        without becomes a headline, which is what keeps the pre-phase
 *        `quizFixture` (`quiz-four-up`) renderable and what lets a document
 *        from a newer release degrade into something sensible.
 * WHERE: `QuizCard`.
 */
function resolveView(
  layout: string,
  hasOptions: boolean,
): "headline" | "question" | "reveal" {
  if (layout === QUIZ_LAYOUTS.intro || layout === QUIZ_LAYOUTS.outro) {
    return "headline";
  }
  if (layout === QUIZ_LAYOUTS.reveal) return "reveal";
  if (layout === QUIZ_LAYOUTS.question) return "question";
  return hasOptions ? "question" : "headline";
}

/**
 * SOURCE OF TRUTH KEYWORDS: CountdownRing, COUNTDOWN_RING_IS_DETERMINISTIC
 *
 * WHAT:  The timer: a ring that empties over the thinking beat, with the
 *        seconds remaining in the middle.
 *
 * WHY:   It runs over the LAST `seconds` of the card rather than the whole of
 *        it — see COUNTDOWN_RING_IS_DETERMINISTIC in the file header. Drawn as
 *        a conic gradient rather than an SVG arc because a conic gradient needs
 *        no path arithmetic and no `pathLength` support, and both render
 *        identically in Chromium, which is what Remotion renders in.
 *
 *        The number counts DOWN and is floored, so the last whole second shows
 *        "1" and the ring reaches empty together with it. Ceiling would show
 *        the starting number for no frames at all and would skip the "1".
 * WHERE: The question card only.
 */
function CountdownRing({
  seconds,
  frame,
  durationInFrames,
  canvas,
  accent,
  text,
}: {
  seconds: number;
  frame: number;
  /** The CARD's length, which is its narration plus this beat. */
  durationInFrames: number;
  canvas: { width: number; height: number; fps: number };
  accent: string;
  text: string;
}) {
  const beatFrames = Math.max(1, Math.round(seconds * canvas.fps));
  /* The beat is the card's LAST `seconds`, because that is where
   * `layNarration` left the silence. So the ring is full while the question is
   * being read and starts emptying when the narration stops. A card shorter
   * than its own beat starts at frame zero, which shows the whole countdown
   * over the reading — the honest drawing of a card with no room for one. */
  const beatStart = Math.max(0, durationInFrames - beatFrames);
  const ringFrame = Math.min(Math.max(frame - beatStart, 0), beatFrames);
  const remaining = 1 - ringFrame / beatFrames;

  const size = 0.1 * canvas.height;
  const thickness = Math.max(4, 0.01 * size);
  const secondsLeft = Math.max(1, Math.ceil(remaining * seconds));

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          /* The filled arc shrinks clockwise from the top. */
          background: `conic-gradient(${accent} ${remaining * 360}deg, rgba(0, 0, 0, 0.35) 0deg)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: thickness,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "82%",
            height: "82%",
            borderRadius: "50%",
            background: "rgba(0, 0, 0, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: RENDER_FONT_FAMILY,
            fontWeight: 700,
            fontSize: size * 0.42,
            color: text,
          }}
        >
          {secondsLeft}
        </div>
      </div>
    </div>
  );
}

function bandFor(
  bands: readonly { upTo: number; ratio: number }[],
  length: number,
): number {
  return (
    bands.find((band) => length <= band.upTo)?.ratio ??
    /* Unreachable — the last band is unbounded — but a `!` is banned and a
     * missing size would render at the browser default. */
    bands[bands.length - 1]?.ratio ??
    0.03
  );
}

/** A, B, C, D. Past the fourth it falls back to the number. */
function optionLetter(index: number): string {
  const letters = ["A", "B", "C", "D"];
  return letters[index] ?? String(index + 1);
}
