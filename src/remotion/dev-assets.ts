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
 * SOURCE OF TRUTH KEYWORDS: devAssetMap, DEV_ASSETS, DEV_ONLY_MEDIA,
 *   BY_KIND_NOT_BY_HANDLE, LOCAL_MEDIA_NO_NETWORK
 *
 * WHAT:  Resolves a fixture's asset handles to the small media files committed
 *        in `public/dev-assets/`, so the studio and the local render work with
 *        no database, no bucket and no network.
 * WHY:   DEV_ONLY_MEDIA. A fixture's handles point at Asset row ids that exist
 *        in nobody's database (`ast_bg_loop_07`), so something has to stand in
 *        for them or the composition cannot be opened at all. The real map
 *        comes from `projects.preview`, which signs URLs out of R2; this is its
 *        development twin and nothing in the request path imports it.
 *
 *        BY_KIND_NOT_BY_HANDLE: the stand-in is chosen by the handle's
 *        declared `kind`, not by its name. Listing names would mean editing
 *        this file every time a fixture gains a clip — and the four fixtures
 *        between them already reference nine handles. By kind, every present
 *        and future fixture resolves with no maintenance, and a new asset kind
 *        is a compile error on the Record below rather than a blank frame.
 *
 *        LOCAL_MEDIA_NO_NETWORK: these are `staticFile()` paths, so a render
 *        fetches nothing. The files are deliberately tiny and synthetic
 *        (ffmpeg test patterns and sine tones, ~110 KB in total) — real media
 *        in the repository would be both a licensing question and a download
 *        every clone pays for.
 *
 *        The video is intentionally SHORTER than the fixtures' narration (4s
 *        against ~9s), because that is what exercises looping — the case a
 *        background clip is in for most real videos.
 * WHERE: src/remotion/root.tsx, for the studio and the `remotion render` CLI.
 *        Never imported by anything under src/app or src/trpc.
 */

import { staticFile } from 'remotion'

import type { TimelineDoc } from '@/lib/timeline'
import type { AssetUrlMap, ResolvedAsset } from '@/lib/types'

/* The committed files, with the real durations they were generated at — a loop
 * needs the source length, and reading it from the file would mean decoding
 * before the first frame. Keep these in step with the files. */
const DEV_ASSETS: Readonly<
  Record<ResolvedAsset['kind'], { file: string; durationInSeconds?: number; width?: number; height?: number }>
> = {
  video: { file: 'dev-assets/bg-loop.mp4', durationInSeconds: 4, width: 540, height: 960 },
  audio: { file: 'dev-assets/narration.m4a', durationInSeconds: 6 },
  image: { file: 'dev-assets/logo-badge.png', width: 360, height: 144 },
  /* A document may declare a font asset; nothing in Phase 03 draws from one
   * (the render font is bundled — BUNDLED_FONT_ONLY), so it resolves to no
   * URL, which every component already handles. */
  font: { file: '' },
}

/**
 * SOURCE OF TRUTH KEYWORDS: devAssetMap
 *
 * WHAT:  An AssetUrlMap for a fixture, pointing at the local dev media.
 * WHY:   Produces the same SHAPE the signing path produces, including the
 *        nullable `url` and the `variant` field, so the studio exercises the
 *        real contract rather than a convenient subset. `variant` is null
 *        because a dev file is not a variant of anything — which is also what
 *        a caller sees when an ingest has not produced one yet.
 * WHERE: Composition defaultProps in root.tsx.
 */
export function devAssetMap(doc: TimelineDoc): AssetUrlMap {
  const map: AssetUrlMap = {}

  for (const [handle, ref] of Object.entries(doc.assets)) {
    const standIn = DEV_ASSETS[ref.kind]
    /* `noUncheckedIndexedAccess` is on, so a Record read is `T | undefined`
     * even though DEV_ASSETS is total over the kind union. Skipping is the
     * honest handling: an unmapped kind simply has no stand-in, and the
     * components already treat an absent handle as a gap. */
    if (standIn === undefined) continue

    map[handle] = {
      assetId: ref.assetId,
      kind: ref.kind,
      url: standIn.file === '' ? null : staticFile(standIn.file),
      variant: null,
      ...(standIn.durationInSeconds !== undefined
        ? { durationInSeconds: standIn.durationInSeconds }
        : {}),
      ...(standIn.width !== undefined ? { width: standIn.width } : {}),
      ...(standIn.height !== undefined ? { height: standIn.height } : {}),
    }
  }

  return map
}
