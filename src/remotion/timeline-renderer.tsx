/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: TimelineRenderer, WALK_DONT_BRANCH,
 *   SEQUENCE_PER_ITEM, narrationWindows, PARSE_ONCE_AT_THE_BOUNDARY,
 *   BAD_DOCUMENT_DRAWS_BLACK, DETERMINISM
 *
 * WHAT:  The one composition. It takes a resolved timeline document and a map
 *        of signed URLs, and draws every item through the component registry.
 * WHY:   WALK_DONT_BRANCH is the whole design, and it is the brief's rule 2.
 *        This file contains NO `if (kind === 'redditCard')` and must never
 *        gain one: it walks the plan, looks each item's `render` up in
 *        RENDER_COMPONENTS, and renders what it finds. Phase 08, 12, 13, 14 and
 *        16 each add a format by writing a component and a registry key, and
 *        none of them touches this file. The moment a format name appears here,
 *        that property is gone and every future format pays for it.
 *
 *        SEQUENCE_PER_ITEM: every item is mounted inside its own `<Sequence>`,
 *        which is what makes an item exist only during its own span — Remotion
 *        unmounts it outside, so a 2-second badge costs nothing for the other
 *        58 seconds, and each component's `useCurrentFrame()` is relative to
 *        its own start (FRAMES_ARE_RELATIVE_INSIDE on RenderItemProps).
 *
 *        PARSE_ONCE_AT_THE_BOUNDARY: the document arrives as JSON — Remotion
 *        serialises composition props to reach each render worker, and Phase 04
 *        sends them to Lambda — so it is parsed with the real schema HERE,
 *        once, rather than trusted or re-parsed per item.
 *
 *        BAD_DOCUMENT_DRAWS_BLACK: a document that fails to parse renders an
 *        empty black frame and logs, rather than throwing. The same trade as
 *        everywhere else on the render path: a blank video is a visible,
 *        refundable failure, whereas a thrown error inside a Lambda worker is
 *        a render that consumed its budget and produced nothing.
 *
 *        DETERMINISM: nothing in this tree may read `Date.now()`,
 *        `Math.random()` or anything else outside its props. Phase 04 reuses a
 *        render when the document hash matches, so a component that varies
 *        between runs makes a cached render differ from a fresh one. An eslint
 *        rule over src/remotion/** enforces this, and determinism.test.ts
 *        asserts it independently, because a lint rule is skippable.
 * WHERE: Registered in src/remotion/root.tsx for the studio and the CLI, and
 *        mounted by the Player on /dashboard/projects/[id]/preview.
 */

import { createElement } from "react";
import { AbsoluteFill, Sequence } from "remotion";

import {
  dropUnknownRenderKinds,
  planTimeline,
  type PlannedItem,
} from "@/lib/render";
import { DEFAULT_CAPTION_STYLE_ID } from "@/lib/captions";
import {
  timelineDocSchema,
  type TimelineDoc,
  type WordToken,
} from "@/lib/timeline";
import type { AssetUrlMap, RenderItemProps } from "@/lib/types";
import { AudioClip } from "./components/audio-clip";
import { CaptionGroup } from "./components/captions";
import { Watermark } from "./components/watermark";
import { loadRenderFonts } from "./fonts";
import { resolveRenderComponent } from "./registry";

/* A type alias, not an interface, and that is load-bearing: Remotion's
 * `component` prop requires props assignable to `Record<string, unknown>`, and
 * TypeScript grants an implicit index signature to object-literal type aliases
 * but never to interfaces. As an interface this fails to compile at
 * <Composition> with an error that points at Remotion rather than here. */
export type TimelineRendererProps = {
  /** A resolved document, as JSON — see PARSE_ONCE_AT_THE_BOUNDARY. */
  doc: Record<string, unknown>;
  assets: AssetUrlMap;
  /**
   * WATERMARK_IS_A_PROP. Set by the render pre-flight from the workspace's
   * `watermarkFree` entitlement, never by a generator and never from the
   * document — see the note on `timelineRendererPropsSchema` in
   * src/lib/types/render.ts for the three ways a document field would go
   * wrong. Optional and defaulting to false, because the studio and the CLI
   * render fixtures with no workspace behind them.
   */
  watermark?: boolean;
};

export function TimelineRenderer({
  doc,
  assets,
  watermark = false,
}: TimelineRendererProps) {
  /* Before the first frame, not in an effect — an effect would run after
   * frame 0 had already been captured with the fallback face. */
  loadRenderFonts();

  /* FORWARD_COMPATIBLE_DOCUMENT. A document written by a NEWER release can
   * carry a render kind this build has never heard of, and the strict schema
   * below would reject the whole document for it — turning one unrecognised
   * overlay into a black video. Those items are dropped first, so the rest of
   * the document still renders. See ONE_BAD_ITEM_IS_NOT_A_BAD_DOCUMENT. */
  const sanitised = dropUnknownRenderKinds(doc);
  if (sanitised.droppedCount > 0) {
    console.warn(
      `[remotion/TimelineRenderer] Dropped ${sanitised.droppedCount} item(s) with no component ` +
        `for render kind(s): ${sanitised.droppedKinds.join(", ")}. The rest of the video still renders.`,
    );
  }

  const parsed = timelineDocSchema.safeParse(sanitised.doc);
  if (!parsed.success) {
    console.error(
      "[remotion/TimelineRenderer] The document did not parse; drawing an empty frame.",
      parsed.error.issues.slice(0, 5),
    );
    /* BAD_DOCUMENT_DRAWS_BLACK — see the file header. */
    return <AbsoluteFill style={{ backgroundColor: "black" }} />;
  }

  /* Not named `document` — that would shadow the DOM global that fonts.ts and
   * every browser API in this tree rely on. */
  const timeline = parsed.data;
  const planned = planTimeline(timeline);
  const narrationWindows = collectNarrationWindows(planned);
  const captionStyleByItem = collectCaptionStyles(timeline);

  return (
    /* Black, explicitly. A composition with no background is transparent, and
     * transparency becomes whatever the encoder decides — usually black, but
     * not guaranteed, and a background that depends on the encoder is a
     * difference between preview and output. */
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {planned.map((plan) => (
        <Sequence
          key={plan.id}
          from={plan.from}
          durationInFrames={plan.durationInFrames}
          /* `layout="none"` because each component positions itself — either
           * filling the frame or from its own normalized box. Remotion's
           * default wraps children in an absolute-fill div, which would
           * silently defeat an overlay's box. */
          layout="none"
          name={`${plan.trackType}:${plan.id}`}
        >
          <PlannedItemRenderer
            plan={plan}
            assets={assets}
            canvas={timeline.canvas}
            narrationWindows={narrationWindows}
            words={timeline.words}
            style={timeline.style}
            captionStyleByItem={captionStyleByItem}
          />
        </Sequence>
      ))}

      {/* LAST, and therefore on top of every track. Outside the walk rather
          than inside it, because an item in the plan composites by LAYER_ORDER
          and could be painted over by any full-frame clip — see
          WATERMARK_IS_NOT_A_TRACK_ITEM. */}
      {watermark ? <Watermark canvas={timeline.canvas} /> : null}
    </AbsoluteFill>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: PlannedItemRenderer, AUDIO_IS_NOT_A_RENDER_KIND
 *
 * WHAT:  Draws one planned item: audio directly, everything else through the
 *        registry.
 * WHY:   AUDIO_IS_NOT_A_RENDER_KIND. An audio item carries no `render` field —
 *        there is nothing to choose between, so the document does not express
 *        one (see `audioItemSchema`). Branching on the TRACK TYPE here is
 *        therefore not a violation of WALK_DONT_BRANCH: the rule forbids
 *        branching on FORMAT, which is the thing that grows with every phase.
 *        Track types are fixed by the schema at five and have been since
 *        Phase 01.
 *
 *        Caption items also have no `render`: they are a LAYER rather than an
 *        item family (WORD_RANGE_NOT_TEXT). Phase 08 added that layer here,
 *        which was the one sanctioned reason to edit this file again — see
 *        CAPTIONS_ARE_A_LAYER below.
 * WHERE: One per planned item, inside its Sequence.
 */
function PlannedItemRenderer({
  plan,
  assets,
  canvas,
  narrationWindows,
  words,
  style,
  captionStyleByItem,
}: {
  plan: PlannedItem;
  assets: AssetUrlMap;
  canvas: TimelineDoc["canvas"];
  narrationWindows: readonly { from: number; durationInFrames: number }[];
  words: readonly WordToken[];
  /* The whole style spec, not just the safe zone — see
   * STYLE_IS_PART_OF_THE_CONTRACT in src/lib/types/render.ts. */
  style: TimelineDoc["style"];
  captionStyleByItem: ReadonlyMap<
    string,
    { styleId: string; speakerColors: boolean }
  >;
}) {
  /* `item` is a document value, which is JSON by construction — the props
   * every component receives are deliberately loose, and each one narrows what
   * it needs with its own schema (PARSE_AT_THE_COMPONENT). */
  const props: RenderItemProps = {
    item: { ...plan.item },
    assets,
    frames: { from: plan.from, durationInFrames: plan.durationInFrames },
    canvas,
    style,
  };

  if (plan.trackType === "audio") {
    return <AudioClip {...props} narrationWindows={narrationWindows} />;
  }

  /* CAPTIONS_ARE_A_LAYER. The sanctioned second branch on TRACK TYPE, added
   * by Phase 08 — a caption item carries a word RANGE and no `render` field
   * (WORD_RANGE_NOT_TEXT), so there is nothing for the registry to choose
   * between. This is not a WALK_DONT_BRANCH violation for the same reason
   * the audio branch is not: the rule forbids branching on FORMAT, which
   * grows with every phase, and track types have been fixed at five since
   * Phase 01. */
  if (plan.trackType === "caption") {
    const item = plan.item;
    if (!("startWord" in item) || !("endWord" in item)) return null;

    return (
      <CaptionGroup
        range={{ startWord: item.startWord, endWord: item.endWord }}
        words={words}
        styleId={
          captionStyleByItem.get(plan.id)?.styleId ?? DEFAULT_CAPTION_STYLE_ID
        }
        speakerColors={captionStyleByItem.get(plan.id)?.speakerColors}
        safeZone={style.safeZone}
        canvas={canvas}
        frames={props.frames}
        y={item.position?.y}
      />
    );
  }

  const component = resolveRenderComponent(plan.render);
  if (component === null) return null;

  /* `createElement`, not `<Component {...props} />`, and not a style choice.
   * Assigning a looked-up component to a capitalised local and rendering it as
   * JSX trips react-hooks/static-components: the compiler cannot tell a
   * registry lookup (a stable module-level reference) from a component built
   * during render (a new identity every frame, which React would remount).
   * createElement says plainly that the dispatch is dynamic, and the identity
   * really is stable because RENDER_COMPONENTS is a module constant. */
  return createElement(component, props);
}

/**
 * SOURCE OF TRUTH KEYWORDS: collectNarrationWindows, NARRATION_IS_A_SPEAKER
 *
 * WHAT:  The frame windows during which narration is playing, for ducking.
 * WHY:   NARRATION_IS_A_SPEAKER. An audio item counts as narration when it
 *        names a `speaker`, because that is what the document means by one —
 *        `speakers` maps to voices, and a music bed has no voice. The
 *        alternative was a track named "narration", which would make the mix
 *        depend on a label a generator is free to change and the editor lets
 *        a customer rename.
 *
 *        An item that asks to be ducked is excluded from its own windows, so a
 *        ducked item cannot duck against itself and drop to 25% for its whole
 *        duration — which is what happens the first time someone marks a
 *        narration line `duck: true` by mistake.
 * WHERE: Passed to every AudioClip.
 */
function collectNarrationWindows(
  planned: readonly PlannedItem[],
): { from: number; durationInFrames: number }[] {
  const windows: { from: number; durationInFrames: number }[] = [];

  for (const plan of planned) {
    if (plan.trackType !== "audio") continue;
    const item = plan.item;
    if (!("speaker" in item) || typeof item.speaker !== "string") continue;
    if ("duck" in item && item.duck === true) continue;
    windows.push({ from: plan.from, durationInFrames: plan.durationInFrames });
  }

  return windows;
}

/**
 * SOURCE OF TRUTH KEYWORDS: collectCaptionStyles, TRACK_STYLE_OVERRIDES_DOC
 *
 * WHAT:  Which caption style each caption ITEM is drawn in.
 * WHY:   TRACK_STYLE_OVERRIDES_DOC. The document carries one caption style
 *        (`doc.style.captionStyleId`) and a caption TRACK may override it
 *        (`track.styleId`), which is how a second lane — a translation —
 *        gets a look of its own. The plan flattens tracks away, so the
 *        mapping has to be built here, from the document, before the walk.
 *
 *        Keyed by ITEM id rather than track id because `PlannedItem` does not
 *        carry its track: adding a `trackId` to the plan for this would make
 *        every other consumer of the plan carry a field only captions use.
 * WHERE: TimelineRenderer, once per render; read per caption item.
 */
function collectCaptionStyles(
  doc: TimelineDoc,
): ReadonlyMap<string, { styleId: string; speakerColors: boolean }> {
  const byItem = new Map<string, { styleId: string; speakerColors: boolean }>();

  for (const track of doc.tracks) {
    if (track.type !== "caption") continue;
    const styleId = track.styleId ?? doc.style.captionStyleId;
    /* Phase 12: a per-LANE setting, resolved here for the same reason the
     * style is — the plan flattens tracks away, so an item cannot reach its
     * own track once the walk starts. */
    const speakerColors = track.speakerColors ?? false;
    for (const item of track.items) {
      byItem.set(item.id, { styleId, speakerColors });
    }
  }

  return byItem;
}
