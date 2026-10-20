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
 * SOURCE OF TRUTH KEYWORDS: RenderQuality, renderQualitySchema,
 *   RESOLVED_ASSET, ResolvedAsset, AssetUrlMap, assetUrlMapSchema,
 *   TimelineRendererProps, timelineRendererPropsSchema, RenderItemProps,
 *   VARIANT_BY_QUALITY, previewProjectSchema, URL_NEVER_IN_THE_DOCUMENT
 *
 * WHAT:  The contract between a timeline document and the Remotion composition
 *        that draws it: which variant each quality reads, the signed-URL map
 *        the composition is handed, and the props every render component
 *        receives.
 * WHY:   URL_NEVER_IN_THE_DOCUMENT. `doc.assets` holds Asset row ids and
 *        licences, never URLs — `assetRefSchema` in src/lib/timeline/schema.ts
 *        says so, because a URL is signed per request and a stored one is a
 *        leak with an expiry date. So the renderer needs a SECOND input: the
 *        document says which asset, this map says where it is right now. Any
 *        design that merges them puts a credential inside a document that gets
 *        hashed, cached and copied.
 *
 *        VARIANT_BY_QUALITY is the other half of the pairing architecture.md
 *        calls the reason preview and output match: the browser scrubs
 *        `proxy_480` and the render composites `vertical_1080`, and those two
 *        were produced from the same master by the same ingest (Phase 02), so
 *        they are the same framing at two resolutions. Nothing else about the
 *        composition changes between the two.
 *
 *        These live here, not in src/remotion/, because CLAUDE.md puts every
 *        custom type in lib/types — and because the editor (Phase 15) and the
 *        cloud renderer (Phase 04) both need them without importing Remotion.
 * WHERE: Consumed by src/remotion/* and src/lib/render/*; produced by
 *        `projects.preview` in src/trpc/routers/projects.ts.
 *        Re-exported from src/lib/types.
 */

import { z } from 'zod'

import { variantNameSchema, type VariantName } from './asset'

/**
 * SOURCE OF TRUTH KEYWORDS: RenderQuality, renderQualitySchema, VARIANT_BY_QUALITY
 *
 * WHAT:  Which rendition of every asset to use, and the TTL that goes with it.
 * WHY:   Two qualities rather than a free-form variant choice, because the
 *        choice is not per-asset — a preview that read the master for ONE clip
 *        would stutter on exactly that clip, which is the hardest kind of
 *        performance bug to attribute. One decision for the whole document.
 *
 *        The TTLs differ for a concrete reason, not symmetry. A preview URL is
 *        handed to a browser and only has to outlive a scrubbing session. A
 *        final URL is handed to a renderer that may queue behind other jobs and
 *        then spend minutes fetching, so it has to outlive the whole render —
 *        and Phase 04 runs that render somewhere this process cannot re-sign
 *        for.
 * WHERE: `projects.preview`; the render pre-flight in Phase 04.
 */
export const RENDER_QUALITIES = ['preview', 'final'] as const

export const renderQualitySchema = z.enum(RENDER_QUALITIES)

export type RenderQuality = z.infer<typeof renderQualitySchema>

export const VARIANT_BY_QUALITY: Readonly<Record<RenderQuality, VariantName>> = {
  preview: 'proxy_480',
  final: 'vertical_1080',
}

/** 30 minutes: long enough for a scrubbing session, short enough that a copied
 *  URL is useless by the time it is pasted anywhere. */
export const PREVIEW_URL_TTL_SECONDS = 1800

/** Six hours. A queued render that started five hours late must still be able
 *  to fetch its media; a render that cannot is money already spent. */
export const FINAL_URL_TTL_SECONDS = 21600

export const TTL_BY_QUALITY: Readonly<Record<RenderQuality, number>> = {
  preview: PREVIEW_URL_TTL_SECONDS,
  final: FINAL_URL_TTL_SECONDS,
}

/**
 * SOURCE OF TRUTH KEYWORDS: ResolvedAsset, resolvedAssetSchema, AssetUrlMap,
 *   MISSING_ASSET_IS_NOT_AN_ERROR
 *
 * WHAT:  One document handle resolved to something playable, plus the facts the
 *        components need about it.
 * WHY:   MISSING_ASSET_IS_NOT_AN_ERROR. `url` is NULLABLE, and every component
 *        has to handle null. Three ordinary situations produce it: an ingest
 *        that has not finished, an asset deleted after the document referenced
 *        it, and a signing refusal (SIGNING_BOUNDARY in assets.service.ts). A
 *        renderer that threw on any of them would turn a recoverable gap — one
 *        missing clip — into a failed paid render, which is the trade
 *        architecture.md explicitly forbids.
 *
 *        `durationInSeconds` is carried because looping needs it: to loop a
 *        4-second background under a 40-second narration the component has to
 *        know it is 4 seconds long, and asking the file at render time means a
 *        decode before the first frame.
 *
 *        `variant` records WHICH rendition this URL points at, so a preview
 *        that silently fell back to the master is visible in the props rather
 *        than only in the frame timings.
 * WHERE: Values of AssetUrlMap; read by MediaClip and the audio components.
 */
export const resolvedAssetSchema = z
  .object({
    /* The real Asset row id, copied from doc.assets — useful in a log line
     * when a render complains about media it could not fetch. */
    assetId: z.string().min(1),
    kind: z.enum(['video', 'audio', 'image', 'font']),
    url: z.string().min(1).nullable(),
    variant: variantNameSchema.nullable(),
    durationInSeconds: z.number().positive().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict()

export type ResolvedAsset = z.infer<typeof resolvedAssetSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: AssetUrlMap, assetUrlMapSchema
 *
 * WHAT:  Every handle in `doc.assets`, resolved — keyed by the HANDLE, not by
 *        the Asset row id.
 * WHY:   Keyed by handle because that is what an item's `assetId` field
 *        actually contains (ASSET_HANDLE_INDIRECTION — see the timeline
 *        schema), so a component can look up its own media with the string it
 *        already holds. Keying by row id would make every component perform
 *        the indirection itself, which is exactly the confusion that
 *        indirection is already prone to.
 * WHERE: The `assets` prop of TimelineRenderer.
 */
export const assetUrlMapSchema = z.record(z.string(), resolvedAssetSchema)

export type AssetUrlMap = z.infer<typeof assetUrlMapSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: TimelineRendererProps, timelineRendererPropsSchema,
 *   PROPS_ARE_SERIALISABLE
 *
 * WHAT:  The composition's whole input: a resolved document and the URL map.
 * WHY:   PROPS_ARE_SERIALISABLE. Remotion serialises composition props to JSON
 *        to pass them to each render worker, so the schema is not decoration —
 *        it is the boundary those props cross, and Phase 04 will send them
 *        across a network to Lambda. A zod schema here means a malformed
 *        payload fails with a field path instead of rendering a blank video.
 *
 *        The document is typed as a JSON record rather than imported as
 *        `TimelineDoc`, deliberately: `timelineDocSchema` is `.strict()` and
 *        pinned to the current version, so parsing it HERE would duplicate
 *        validation that `projects.preview` already did through migrate() and
 *        validate(). The composition re-parses with the real schema at the
 *        point of use instead (see src/remotion/timeline-renderer.tsx).
 * WHERE: `<Composition schema={…}>` in src/remotion/root.tsx and the Player on
 *        the preview page.
 */
export const timelineRendererPropsSchema = z
  .object({
    doc: z.record(z.string(), z.unknown()),
    assets: assetUrlMapSchema,
  })
  .strict()

/**
 * SOURCE OF TRUTH KEYWORDS: RenderItemProps, RENDER_COMPONENT_CONTRACT
 *
 * WHAT:  What every component in RENDER_COMPONENTS receives.
 * WHY:   RENDER_COMPONENT_CONTRACT — one shape for every render kind, so
 *        adding a family is a registry key and a component, with no change to
 *        the walker (the brief's rule 2). That forces the props to be the
 *        UNION of what any family could need, which is why `item` is the whole
 *        track item rather than a narrowed type: a component knows its own
 *        kind and narrows internally, whereas a generic walker cannot know
 *        which narrowing to apply.
 *
 *        `assets` is the whole map, not this item's asset, because a scene
 *        item's media lives on its ELEMENTS (Phase 12's Reddit card, Phase 13's
 *        quiz) and the item itself has no single asset.
 *
 *        `item` and `doc` are typed loosely here for the same reason the props
 *        schema is: this file must not import the timeline module, or every
 *        consumer of a render type drags the document schema in with it. The
 *        components narrow with the real zod schemas.
 * WHERE: Implemented by every component under src/remotion/components/;
 *        the value type of RENDER_COMPONENTS in src/remotion/registry.ts.
 */
export interface RenderItemProps {
  /** The track item being drawn, as the document holds it. */
  item: Record<string, unknown>
  /** Every resolved handle in the document. */
  assets: AssetUrlMap
  /**
   * This item's span in whole frames, in DOCUMENT coordinates.
   *
   * FRAMES_ARE_RELATIVE_INSIDE: the walker mounts every item inside its own
   * `<Sequence from={frames.from}>`, so `useCurrentFrame()` within a component
   * returns a frame RELATIVE to the item — 0 on the item's first frame,
   * `durationInFrames - 1` on its last. That is what makes an animation's
   * progress `frame / (durationInFrames - 1)` with no offset arithmetic.
   *
   * `from` is therefore only needed to convert back to absolute document
   * frames, which one thing needs: comparing against a window somewhere else
   * in the document, as audio ducking does against the narration.
   */
  frames: { from: number; durationInFrames: number }
  /** The canvas, so a component can convert a normalized box to pixels. */
  canvas: { width: number; height: number; fps: number }
}

/**
 * SOURCE OF TRUTH KEYWORDS: previewProjectSchema
 *
 * WHAT:  Input for `projects.preview`.
 * WHY:   A separate schema from getProjectSchema because it carries `quality`,
 *        and because the two answer different questions — `get` returns a
 *        project for a screen to edit, `preview` returns everything needed to
 *        PLAY one, which is a strictly larger and more expensive payload (it
 *        signs a URL per asset).
 * WHERE: The preview page's client component and the router.
 */
export const previewProjectSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
  quality: renderQualitySchema.optional(),
})

export type PreviewProjectValues = z.infer<typeof previewProjectSchema>
