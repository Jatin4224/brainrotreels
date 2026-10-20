/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: RemotionRoot, FIXTURES_ARE_THE_COMPOSITIONS,
 *   TimelineRenderer, RESOLVE_BEFORE_RENDER, DURATION_FROM_THE_DOCUMENT
 *
 * WHAT:  Registers one composition per timeline fixture, which is what the
 *        studio lists and what `remotion render` targets.
 * WHY:   FIXTURES_ARE_THE_COMPOSITIONS. `src/lib/timeline/fixtures/` already
 *        declares itself production data with three consumers, and this is the
 *        third: the studio renders the same documents the validation tests
 *        assert on, so a schema change cannot pass the tests while breaking
 *        the renderer. Iterating FIXTURES_BY_KIND means a fifth project kind
 *        appears in the studio automatically, with no edit here.
 *
 *        RESOLVE_BEFORE_RENDER: every fixture goes through
 *        `resolveWordAnchors()` first. The voiceover fixture is deliberately
 *        ANCHORED — it exists to exercise that form — and an anchored document
 *        has no absolute times, so a renderer handed one would draw nothing.
 *        Resolving here is the same step the pipeline performs before a real
 *        render, so the studio is not a special case.
 *
 *        DURATION_FROM_THE_DOCUMENT: `durationInFrames` comes from
 *        `planComposition()`, never a constant. The brief requires it, and a
 *        hard-coded length would silently truncate any document longer than
 *        the guess — the failure being a video that ends mid-sentence.
 * WHERE: Loaded by ./index.ts, which the studio and the CLI use as their entry.
 *        The Player on the preview page does NOT come through here: it mounts
 *        TimelineRenderer directly with a real signed-URL map.
 */

import { Composition } from "remotion";

import { planComposition } from "@/lib/render";
import { resolveWordAnchors, timelineDocSchema } from "@/lib/timeline";
import { FIXTURES_BY_KIND } from "@/lib/timeline/fixtures";
import { TIMELINE_COMPOSITION_ID } from "@/lib/types/render";
import { devAssetMap } from "./dev-assets";
import {
  TimelineRenderer,
  type TimelineRendererProps,
} from "./timeline-renderer";

/**
 * SOURCE OF TRUTH KEYWORDS: METADATA_FROM_THE_PROPS, calculateMetadata,
 *   ONE_PRODUCTION_COMPOSITION, DURATION_FROM_THE_DOCUMENT
 *
 * WHAT:  Derives a composition's canvas and frame count from the document it
 *        is actually being handed.
 *
 * WHY:   METADATA_FROM_THE_PROPS, and it is the piece without which a cloud
 *        render is silently wrong. A `<Composition>` declares its
 *        `durationInFrames`, `fps`, `width` and `height` at REGISTRATION time
 *        — when the bundle is built, long before anybody asks for a render —
 *        so a composition registered from a fixture renders every document at
 *        the FIXTURE's length. A 60-second project handed to a composition
 *        registered from a 7.6-second fixture produces 7.6 seconds of video:
 *        it succeeds, it is paid for, and the only symptom is a video that
 *        stops mid-sentence.
 *
 *        `calculateMetadata` is the hook that runs with the real
 *        `inputProps` in hand, so the answer comes from `planComposition()` on
 *        the document being rendered. It is the same function the preview page
 *        and the local CLI already use, which is what keeps all three
 *        agreeing (DURATION_FROM_THE_DOCUMENT).
 *
 *        The document is PARSED here rather than trusted, because props arrive
 *        as JSON across a network on the Lambda path and this runs before the
 *        component does. A document that will not parse falls back to one
 *        second at the canvas the schema defaults to, so the render produces a
 *        black frame and the component logs the reason
 *        (BAD_DOCUMENT_DRAWS_BLACK) — rather than this throwing, which on
 *        Lambda is a render that consumed its budget and produced nothing to
 *        look at.
 * WHERE: The production composition below, and every fixture composition, so
 *        the studio exercises the same code path a render does.
 */
function metadataFromProps({ props }: { props: TimelineRendererProps }) {
  const parsed = timelineDocSchema.safeParse(props.doc);
  if (!parsed.success) {
    console.error(
      "[remotion/root] calculateMetadata could not parse the document; rendering one black frame.",
      parsed.error.issues.slice(0, 5),
    );
    return { durationInFrames: 30, fps: 30, width: 1080, height: 1920 };
  }

  const plan = planComposition(parsed.data);
  return {
    durationInFrames: plan.durationInFrames,
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
  };
}

export function RemotionRoot() {
  return (
    <>
      {/* ONE_PRODUCTION_COMPOSITION — the id a cloud render names. It carries
          no document of its own: every dimension comes from the props it is
          handed, and `defaultProps` is the empty shape only so the studio can
          list it. Rendering it with no props draws one black frame, which is
          the honest result of being asked to render nothing. */}
      <Composition
        id={TIMELINE_COMPOSITION_ID}
        component={TimelineRenderer}
        calculateMetadata={metadataFromProps}
        defaultProps={{ doc: {}, assets: {}, watermark: false }}
      />
      {Object.entries(FIXTURES_BY_KIND).map(([kind, build]) => {
        const doc = resolveWordAnchors(build());

        return (
          <Composition
            key={kind}
            /* The project kind IS the composition id, so the render command in
             * package.json reads `remotion render … reddit-story` — a name
             * somebody can guess rather than an index. */
            id={kind}
            component={TimelineRenderer}
            /* The same derivation as the production composition, rather than
             * the fixture's own numbers computed here. It is the same answer
             * for an unedited fixture, and it means the studio exercises the
             * code path a cloud render depends on — so a bug in
             * METADATA_FROM_THE_PROPS shows up locally instead of only in a
             * paid render. */
            calculateMetadata={metadataFromProps}
            defaultProps={{ doc, assets: devAssetMap(doc), watermark: false }}
          />
        );
      })}
    </>
  );
}
