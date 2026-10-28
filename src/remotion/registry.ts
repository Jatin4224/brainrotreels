/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_COMPONENTS, resolveRenderComponent,
 *   THE_ONLY_EXTENSION_POINT, UNKNOWN_DRAWS_NOTHING, RenderKind, RenderItemProps
 *
 * WHAT:  The map from a document item's `render` value to the component that
 *        draws it, and the lookup that never throws.
 * WHY:   THE_ONLY_EXTENSION_POINT. This file is the entire answer to "how do I
 *        add a format": Phase 12 adds a Reddit card by writing a component and
 *        adding a key HERE, and Phase 13 and 16 do the same. Nobody edits
 *        TimelineRenderer again — it walks the plan and looks components up,
 *        and it has no idea what a Reddit card is. The brief states that as a
 *        requirement and the registry is how it is kept true.
 *
 *        UNKNOWN_DRAWS_NOTHING: an unrecognised `render` value resolves to
 *        null, logs once, and the render continues. This is not defensive
 *        programming for its own sake — it is the trade architecture.md names
 *        explicitly: a missing element is recoverable, a failed render is money
 *        gone. A document written by a newer release and rendered by an older
 *        worker is the realistic way this happens, and it must degrade rather
 *        than abort.
 *
 *        `Partial<Record<…>>` rather than a full Record, deliberately. Every
 *        RenderKind that is NOT yet implemented is a documented gap rather
 *        than a compile error, so this phase can ship `media` and `text`
 *        without stub components for four unwritten formats — stubs that draw
 *        nothing are indistinguishable from the fallback, and they would hide
 *        which families actually exist.
 * WHERE: Consumed by src/remotion/timeline-renderer.tsx. The components live
 *        in src/remotion/components/.
 */

import type { ComponentType } from "react";

import { RENDER_KINDS, type RenderKind } from "@/lib/timeline";
import type { RenderItemProps } from "@/lib/types";
import { AvatarOverlay } from "./components/avatar-overlay";
import { Backdrop } from "./components/backdrop";
import { MediaClip } from "./components/media-clip";
import { QuizCard } from "./components/quiz-card";
import { RedditCard } from "./components/reddit-card";
import { TextOverlay } from "./components/text-overlay";

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_COMPONENTS
 *
 * Implemented in Phase 03:
 *   media → MediaClip   (video, image; cover/contain/fill, looping, Ken Burns)
 *   text  → TextOverlay (a positioned text badge)
 *
 * Added in Phase 09:
 *   backdrop → Backdrop (a full-frame gradient in one of src/lib/palettes)
 *
 * Added in Phase 12:
 *   redditCard       → RedditCard    (the title scene of a Reddit story)
 *   characterOverlay → AvatarOverlay (the active speaker, at rest/talking/reacting)
 *
 * Added in Phase 13:
 *   quizCard → QuizCard (the intro, question, reveal and outro cards of a
 *              quiz — ONE family switching on `scene.layout`, see
 *              ONE_FAMILY_FOUR_LAYOUTS for why that is not four entries)
 *
 * Deliberately absent, with the phase that adds it:
 *   motion           → Phase 16 (motion graphics studio)
 *
 * Captions are NOT a render kind and never will be: a caption item carries a
 * word range rather than a `render` field (WORD_RANGE_NOT_TEXT in the timeline
 * schema). Phase 08 added them as a LAYER in TimelineRenderer — one component
 * reading `doc.words` and a style from src/lib/captions/ — rather than as an
 * entry here. Grep CAPTIONS_ARE_A_LAYER.
 */
export const RENDER_COMPONENTS: Partial<
  Record<RenderKind, ComponentType<RenderItemProps>>
> = {
  media: MediaClip,
  text: TextOverlay,
  backdrop: Backdrop,
  redditCard: RedditCard,
  characterOverlay: AvatarOverlay,
  quizCard: QuizCard,
};

/* One warning per unknown kind per process, not per frame. A 60-second render
 * is 1800 frames, and an unknown overlay would otherwise write 1800 identical
 * lines into the log that matters most when a render goes wrong. */
const warned = new Set<string>();

/**
 * SOURCE OF TRUTH KEYWORDS: resolveRenderComponent, UNKNOWN_DRAWS_NOTHING
 *
 * WHAT:  The component for a render kind, or null.
 * WHY:   Returns null rather than throwing or substituting a placeholder. A
 *        visible placeholder was the alternative and it is worse for the paid
 *        path: it would composite a box reading "unsupported" into a customer's
 *        finished video, where silence is the honest failure.
 * WHERE: TimelineRenderer, once per planned item.
 */
export function resolveRenderComponent(
  render: string | null,
): ComponentType<RenderItemProps> | null {
  if (render === null) return null;

  /* Narrowed against the document's own union, not against this file's keys —
   * so a VALID kind that simply has no component yet (`motion` until Phase 16)
   * takes the same path as a garbage value, which is correct: both draw
   * nothing and both are worth one log line. */
  const component = isRenderKind(render)
    ? RENDER_COMPONENTS[render]
    : undefined;
  if (component !== undefined) return component;

  if (!warned.has(render)) {
    warned.add(render);
    console.warn(
      `[remotion/registry] No component for render kind "${render}" — drawing nothing. ` +
        "Add it to RENDER_COMPONENTS in src/remotion/registry.ts.",
    );
  }
  return null;
}

function isRenderKind(value: string): value is RenderKind {
  return (RENDER_KINDS as readonly string[]).includes(value);
}
