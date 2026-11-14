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

import { compositionMetadataFor } from "@/lib/render";
import { resolveWordAnchors } from "@/lib/timeline";
import { FIXTURES_BY_KIND } from "@/lib/timeline/fixtures";
import { TIMELINE_COMPOSITION_ID } from "@/lib/types/render";
import { devAssetMap } from "./dev-assets";
import {
  TimelineRenderer,
  type TimelineRendererProps,
} from "./timeline-renderer";

/**
 * SOURCE OF TRUTH KEYWORDS: METADATA_FROM_THE_PROPS, calculateMetadata,
 *   ONE_PRODUCTION_COMPOSITION, DURATION_FROM_THE_DOCUMENT,
 *   SANITISE_BEFORE_BOTH_PARSES, compositionMetadataFor
 *
 * WHAT:  Adapts `compositionMetadataFor` to the argument shape Remotion hands
 *        a `calculateMetadata` prop.
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
 *        `calculateMetadata` is the hook that runs with the real `inputProps`
 *        in hand, so the answer can come from the document being rendered
 *        (DURATION_FROM_THE_DOCUMENT).
 *
 *        The derivation itself lives in src/lib/render/metadata.ts, not here,
 *        because it has to stay in lockstep with the sanitise-then-parse the
 *        COMPONENT performs (SANITISE_BEFORE_BOTH_PARSES) and because this
 *        file cannot be unit-tested without a browser. Keeping only the
 *        adapter here is what let that ordering be tested at all.
 * WHERE: The production composition below, and every fixture composition, so
 *        the studio exercises the same code path a render does.
 */
function metadataFromProps({ props }: { props: TimelineRendererProps }) {
  return compositionMetadataFor(props.doc);
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
