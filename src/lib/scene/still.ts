/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: buildStillDocument, stillFrameFor,
 *   A_STILL_DOCUMENT_IS_THE_GRAPHIC_ALONE, NO_ASSETS_NO_AUDIO,
 *   THE_MIDPOINT_IS_THE_HONEST_FRAME, ISOMORPHIC_PURE_MODULE
 *
 * WHAT:  A one-beat timeline document holding nothing but one scene, and the
 *        frame number worth drawing from it.
 *
 * WHY:   A_STILL_DOCUMENT_IS_THE_GRAPHIC_ALONE. The vision pass needs a
 *        picture of one beat, and the obvious way to get one — render frame N
 *        of the project's real document — is the wrong one for three reasons.
 *        It needs every narration asset resolved to a signed URL, so a QA
 *        check would depend on storage; a frame of it contains the captions
 *        and whatever else the format lays over the scene, so the model would
 *        be asked about a composite when the thing under review is the scene;
 *        and it means building the whole document to look at one beat of it.
 *
 *        NO_ASSETS_NO_AUDIO: this document names no asset at all, so the still
 *        can be rendered with an empty asset map and cannot fail on a missing
 *        one. Nothing is lost by leaving the captions out, because the layout
 *        engine already keeps every element clear of the caption box
 *        (\`safeRectFor\` subtracts it), so a caption can never be the thing
 *        overlapping a graphic — that is proved by code, not by looking.
 *
 *        The scene starts at ZERO in this document, which makes the frame
 *        arithmetic trivial and, more importantly, makes an element's
 *        beat-relative timing land where it would in the real video: a scene's
 *        \`in\` and \`out\` are relative to its own item either way.
 *
 *        ISOMORPHIC_PURE_MODULE, like everything else in this folder: no
 *        Prisma, no \`server-only\`, no Remotion, so the document the reviewer
 *        renders is built by code a test can call.
 * WHERE: src/lib/script/motion-review.ts.
 */

import {
  TIMELINE_DOC_VERSION,
  type CanvasSpec,
  type TimelineDoc,
} from "@/lib/timeline";
import type { SafeZone } from "@/lib/types/caption";
import type { Scene } from "@/lib/types/scene";

import { toSceneSpec } from "./document";

export const STILL_TRACK_ID = "scenes";
export const STILL_ITEM_ID = "beat";

/**
 * SOURCE OF TRUTH KEYWORDS: buildStillDocument, NO_ASSETS_NO_AUDIO
 *
 * WHAT:  A valid timeline document whose only content is this scene.
 * WHY:   \`timing: "resolved"\` because there are no words to anchor against —
 *        the same choice the committed motion fixture makes, and for the same
 *        reason: a document with word anchors and no words is not renderable,
 *        and the anchors were already turned into seconds before the scene was
 *        stored (RESOLVE_BEFORE_STORING).
 *
 *        The palette and the caption treatment come from the STYLE, so the
 *        still shows the colours the real video will use. The caption
 *        treatment is carried even though no caption is drawn, because
 *        \`doc.style\` is one object and omitting half of it would make this
 *        document a different shape from every other.
 * WHERE: See the file header.
 */
export function buildStillDocument(args: {
  scene: Scene;
  canvas: CanvasSpec;
  paletteId: string;
  captionStyleId: string;
  motionStyleId?: string | undefined;
  safeZone: SafeZone;
  durationSeconds: number;
}): TimelineDoc {
  const {
    scene,
    canvas,
    paletteId,
    captionStyleId,
    motionStyleId,
    safeZone,
    durationSeconds,
  } = args;

  return {
    version: TIMELINE_DOC_VERSION,
    kind: "motion",
    timing: "resolved",
    canvas,
    style: {
      paletteId,
      captionStyleId,
      safeZone,
      ...(motionStyleId !== undefined ? { motionStyleId } : {}),
    },
    words: [],
    tracks: [
      {
        id: STILL_TRACK_ID,
        type: "scene",
        label: "Scenes",
        items: [
          {
            id: STILL_ITEM_ID,
            start: 0,
            /* Clamped to a frame's worth: a zero-length item is out of range,
             * and a beat whose words were re-timed to nothing must not make an
             * invalid document out of a QA render. */
            duration: Math.max(1 / canvas.fps, durationSeconds),
            render: "motion",
            scene: toSceneSpec(scene),
          },
        ],
      },
    ],
    speakers: {},
    assets: {},
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: stillFrameFor, THE_MIDPOINT_IS_THE_HONEST_FRAME
 *
 * WHAT:  Which frame of a beat to draw.
 *
 * WHY:   THE_MIDPOINT_IS_THE_HONEST_FRAME. By the middle of a beat every
 *        element that enters has entered and every entrance has settled, so
 *        the frame shows where the ink actually lands — which is what
 *        ANIMATION_NEVER_MOVES_THE_INK promises and what the deterministic
 *        checks measured. The first frame would show an empty or
 *        half-transparent scene and have the model report missing content; the
 *        last could catch an element on its way out.
 *
 *        It is the same moment the beat strip freezes its thumbnails at, which
 *        matters: the picture a reviewer judges and the picture the model
 *        judged are then the same picture.
 * WHERE: See the file header.
 */
export function stillFrameFor(args: {
  durationSeconds: number;
  fps: number;
}): number {
  const { durationSeconds, fps } = args;
  return Math.max(0, Math.round((durationSeconds / 2) * fps));
}
