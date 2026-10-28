/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AvatarOverlay, avatarOverlayPropsSchema,
 *   STATE_IS_LOOKED_UP_NOT_DERIVED, NEUTRAL_IS_THE_FALLBACK,
 *   PARSE_AT_THE_COMPONENT, DETERMINISM, MISSING_ASSET_DRAWS_NOTHING,
 *   NO_CROSSFADE_BETWEEN_STATES
 *
 * WHAT:  Draws the active speaker's character: at rest, talking, or reacting,
 *        according to the timeline the generator baked onto the item.
 *
 * WHY:   STATE_IS_LOOKED_UP_NOT_DERIVED, and it is forced rather than chosen. A
 *        render component receives `item`, `assets`, `frames` and `canvas` and
 *        NOT the document (RENDER_COMPONENT_CONTRACT), so it cannot read
 *        `doc.words` and could not work out when its speaker was talking even
 *        if it wanted to. The windows and the state spans are computed in the
 *        generator (WINDOWS_ARE_COMPUTED_NOT_DRAWN in
 *        src/lib/generators/avatar-windows.ts), which is also where the
 *        flicker coalescing belongs — and this component does one scan to find
 *        the span covering the current frame.
 *
 *        That is what keeps a frame a pure function of its number, which Phase
 *        04's render reuse rests on: there is no accumulated state, no
 *        transition in progress, nothing that depends on which frame was
 *        rendered before this one. Remotion renders frames out of order and in
 *        parallel.
 *
 *        NO_CROSSFADE_BETWEEN_STATES. The switch is a hard cut, deliberately.
 *        A crossfade between a closed and an open mouth reads as a dissolve
 *        rather than as speech — and at the cadence of real narration it would
 *        be fading more often than it was settled. The coalescing in the
 *        generator is what makes a hard cut comfortable: nothing switches
 *        faster than the flicker threshold.
 *
 *        NEUTRAL_IS_THE_FALLBACK, in three places, because three things can go
 *        wrong independently: the props may not parse (an item written by a
 *        newer release), the state timeline may not cover this frame (it does,
 *        and the generator's test proves it, but a hand-edited document is
 *        reachable), and the handle for the state may have no URL (its artwork
 *        is still ingesting, or its variant failed). The first two resolve to
 *        `neutral`; the third follows MISSING_ASSET_DRAWS_NOTHING and draws
 *        nothing at all, because a character that appears in the wrong pose is
 *        worse than one that is absent for a beat.
 *
 *        The artwork is drawn with `object-fit: contain` and bottom-aligned: a
 *        character cut-out is a figure, so it must keep its proportions and
 *        stand on the same line whatever its frame's aspect is. `cover` would
 *        crop a head off, and a centred figure would appear to hop between
 *        states whose artwork is not the same height.
 * WHERE: Registered as `characterOverlay` in src/remotion/registry.ts. Written
 *        by src/lib/generators/reddit-story.ts.
 */

import { useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

import { AVATAR_STATES } from "@/lib/types/avatar";
import type { RenderItemProps } from "@/lib/types";

/**
 * SOURCE OF TRUTH KEYWORDS: avatarOverlayPropsSchema, PARSE_AT_THE_COMPONENT
 *
 * WHAT:  The handles and the state timeline an overlay reads off its item.
 * WHY:   The timeline crossed a JSON serialisation to get here (Remotion ships
 *        props to each worker, and Phase 04 ships them to Lambda), so it
 *        arrives as plain data and is parsed rather than trusted. The state is
 *        narrowed against the SAME union the generator wrote
 *        (`AVATAR_STATES`), so a state this build cannot draw fails the parse
 *        here instead of indexing the handle map with `undefined`.
 */
const avatarOverlayPropsSchema = z.object({
  box: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number().optional(),
    })
    .optional(),
  props: z
    .object({
      handles: z
        .object({
          neutral: z.string().min(1),
          talking: z.string().min(1),
          reaction: z.string().min(1),
        })
        .partial()
        .optional(),
      states: z
        .array(
          z.object({
            state: z.enum(AVATAR_STATES),
            start: z.number(),
            duration: z.number(),
          }),
        )
        .optional(),
    })
    .partial()
    .passthrough()
    .optional(),
});

export function AvatarOverlay({ item, assets, canvas }: RenderItemProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const parsed = avatarOverlayPropsSchema.safeParse(item);
  if (!parsed.success) return null;

  const handles = parsed.data.props?.handles;
  if (handles === undefined) return null;

  /* FRAMES_ARE_RELATIVE_INSIDE — the walker mounts every item in its own
   * `<Sequence>`, so this frame is already relative to the item and the state
   * timeline is written in the same coordinates. No offset arithmetic. */
  const seconds = frame / fps;
  const spans = parsed.data.props?.states ?? [];

  /* One scan, and `neutral` when nothing covers this frame. The generator
   * guarantees full coverage (NO_GAPS_NO_OVERLAPS); this is the fallback for a
   * document somebody edited by hand. */
  const active =
    spans.find(
      (span) => seconds >= span.start && seconds < span.start + span.duration,
    )?.state ?? "neutral";

  /* NEUTRAL_IS_THE_FALLBACK — a state with no handle declared falls back to
   * the resting frame rather than drawing nothing. */
  const handle = handles[active] ?? handles.neutral;
  const url = handle === undefined ? null : (assets[handle]?.url ?? null);

  /* MISSING_ASSET_DRAWS_NOTHING — artwork still ingesting, a failed variant, or
   * a signing refusal. A character in the wrong pose would be worse. */
  if (url === null) return null;

  const box = parsed.data.box;

  return (
    <div
      style={
        box === undefined
          ? { position: "absolute", inset: 0 }
          : {
              position: "absolute",
              left: box.x * canvas.width,
              top: box.y * canvas.height,
              width: box.w * canvas.width,
              ...(box.h !== undefined
                ? { height: box.h * canvas.height }
                : {}),
              display: "flex",
              /* A figure stands on a line. See the note in the file header. */
              alignItems: "flex-end",
              justifyContent: "center",
            }
      }
    >
      {/* A plain <img>, not next/image: this tree is rendered by Remotion's own
          bundler in a headless browser, where Next's loader does not exist. The
          URL is already a signed, short-lived one — or a permanent CDN one for
          a library asset (LIBRARY_IS_SERVED_FROM_THE_CDN). */}
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img
        src={url}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          objectPosition: "bottom center",
        }}
      />
    </div>
  );
}
