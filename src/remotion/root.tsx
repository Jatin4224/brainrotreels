/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
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

import { Composition } from 'remotion'

import { planComposition } from '@/lib/render'
import { resolveWordAnchors } from '@/lib/timeline'
import { FIXTURES_BY_KIND } from '@/lib/timeline/fixtures'
import { devAssetMap } from './dev-assets'
import { TimelineRenderer } from './timeline-renderer'

export function RemotionRoot() {
  return (
    <>
      {Object.entries(FIXTURES_BY_KIND).map(([kind, build]) => {
        const doc = resolveWordAnchors(build())
        const plan = planComposition(doc)

        return (
          <Composition
            key={kind}
            /* The project kind IS the composition id, so the render command in
             * package.json reads `remotion render … reddit-story` — a name
             * somebody can guess rather than an index. */
            id={kind}
            component={TimelineRenderer}
            durationInFrames={plan.durationInFrames}
            fps={plan.fps}
            width={plan.width}
            height={plan.height}
            defaultProps={{ doc, assets: devAssetMap(doc) }}
          />
        )
      })}
    </>
  )
}
