/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: renderCacheKey, RenderCacheInputs, docHash,
 *   RENDER_REUSE, KEY_COVERS_THE_OUTPUT, PLAN_IS_PURE, RENDER_KEY_VERSION
 *
 * WHAT:  The value stored in `Render.docHash` — the key that decides whether a
 *        render already exists or has to be paid for again.
 *
 * WHY:   KEY_COVERS_THE_OUTPUT. `@@unique([projectId, docHash])` is what the
 *        phase calls the thing that "makes render reuse correct rather than
 *        best-effort", and that is only true if the key says everything about
 *        the FILE. `hashDoc()` says everything about the DOCUMENT, which is
 *        not the same claim: two renders of one unchanged document can still
 *        be two different videos. Storing a bare `hashDoc()` would be a
 *        correctness bug with a bill attached, in both directions:
 *
 *          - A 720p render would satisfy a later request for 1080p. The
 *            customer asked for HD, paid nothing, and got the file they
 *            already had.
 *          - A free workspace's WATERMARKED output would be handed back after
 *            it upgraded — so the first thing a new subscriber does, export
 *            the video they just paid to clean up, returns the watermarked
 *            one. That is the single worst reuse failure available here,
 *            because it looks like the upgrade did nothing.
 *
 *        So the key is `hashDoc(doc)` combined with every input that changes
 *        the pixels. Today that is the resolution and the watermark. ANYTHING
 *        added later that the composition can see — a palette, a caption
 *        style, an encoder setting — belongs in this function, and the test
 *        beside it exists to make that omission fail rather than ship.
 *
 *        It is READABLE rather than re-hashed: `a1b2c3d4e5f60718-1080p-wm0`,
 *        not a second opaque digest. Two reasons. An operator looking at a
 *        `render` row can tell what was asked for without running code, which
 *        is most of what support needs; and re-hashing would buy nothing —
 *        this is a cache key in a column with a unique index, not a value
 *        anybody has to be prevented from reversing. The document half is
 *        already a hash, so the length stays bounded whatever the document.
 *
 *        RENDER_KEY_VERSION is the escape hatch for the case this scheme
 *        cannot otherwise express: a change to the COMPOSITION that changes
 *        the picture without changing any document. A font swap, a fixed
 *        overlay position, a bug in the ducking curve. The document is
 *        identical and every setting is identical, so every existing render
 *        would be reused and no customer would ever see the fix. Bumping this
 *        constant invalidates the whole cache deliberately, which is a cost
 *        worth paying consciously and never worth paying by accident.
 *
 *        PLAN_IS_PURE: no React, no Remotion, no database, no storage — the
 *        property the whole folder holds. The router computes this key inside
 *        a transaction and the workflow recomputes it to check the row it was
 *        handed is the one it thinks; neither could do that if this reached
 *        for anything.
 * WHERE: `renders.create` and `renders.retry` in src/trpc/routers/renders.ts;
 *        the `validate` step of src/inngest/functions/project-render.ts.
 */

import { hashDoc, type TimelineDoc } from "@/lib/timeline";
import type { RenderResolution } from "@/lib/types/render";

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_KEY_VERSION
 *
 * Bump this when a change to src/remotion/ alters the output of a document
 * that has not itself changed. See the file header for why that case cannot
 * be detected and must be declared.
 */
export const RENDER_KEY_VERSION = 1;

/**
 * SOURCE OF TRUTH KEYWORDS: RenderCacheInputs
 *
 * WHAT:  Everything besides the document that changes the rendered file.
 * WHY:   A named type rather than loose arguments, so adding a field is a
 *        compile error at every call site rather than a silently-ignored
 *        option at one of them. That is the whole defence against the failure
 *        this module exists to prevent.
 * WHERE: The single argument of renderCacheKey.
 */
export interface RenderCacheInputs {
  doc: TimelineDoc;
  resolution: RenderResolution;
  watermark: boolean;
}

/**
 * SOURCE OF TRUTH KEYWORDS: renderCacheKey, docHash
 *
 * WHAT:  The cache key for one render, stored as `Render.docHash`.
 * WHERE: See the file header.
 */
export function renderCacheKey(inputs: RenderCacheInputs): string {
  const { doc, resolution, watermark } = inputs;

  /* `v1` first so the version is visible at a glance and sorts together, and
   * `wm0`/`wm1` rather than `false`/`true` so the whole key stays short enough
   * to read in a log line. */
  return [
    `v${RENDER_KEY_VERSION}`,
    hashDoc(doc),
    resolution,
    watermark ? "wm1" : "wm0",
  ].join("-");
}
