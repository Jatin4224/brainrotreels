/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: RenderQuality, renderQualitySchema,
 *   RESOLVED_ASSET, ResolvedAsset, AssetUrlMap, assetUrlMapSchema,
 *   TimelineRendererProps, timelineRendererPropsSchema, RenderItemProps,
 *   VARIANT_BY_QUALITY, previewProjectSchema, URL_NEVER_IN_THE_DOCUMENT,
 *   RENDER_STATUSES, renderStatusSchema, RENDER_RESOLUTIONS,
 *   SCALE_BY_RESOLUTION, RESOLUTION_PER_PLAN, createRenderSchema,
 *   RENDER_ATTEMPT_LIMIT, LOCKED_NOT_HIDDEN
 *
 * WHAT:  The contract between a timeline document and the Remotion composition
 *        that draws it: which variant each quality reads, the signed-URL map
 *        the composition is handed, and the props every render component
 *        receives — plus, from Phase 04 down the second half of the file, the
 *        vocabulary of a CLOUD render: its status, its output size, and the
 *        input schema of every `renders.*` procedure.
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

import { z } from "zod";

import type { PlanKey } from "@/lib/config/plans";
import { variantNameSchema, type VariantName } from "./asset";
import type { SafeZone } from "./caption";

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
/**
 * SOURCE OF TRUTH KEYWORDS: TIMELINE_COMPOSITION_ID, ONE_PRODUCTION_COMPOSITION
 *
 * WHAT:  The id of the composition a CLOUD render targets.
 * WHY:   ONE_PRODUCTION_COMPOSITION. The studio registers one composition per
 *        fixture (FIXTURES_ARE_THE_COMPOSITIONS in src/remotion/root.tsx),
 *        which is right for development and wrong for a render: those
 *        compositions carry a fixture's document as their default props and,
 *        before Phase 04, took their duration from it. A cloud render names
 *        THIS id instead — a composition with no document of its own, whose
 *        canvas and frame count are computed from the props it is handed.
 *
 *        It lives here rather than in src/remotion/ because the adapter that
 *        names it must not import a React module: `@/lib/adapters/render` runs
 *        in a workflow with no DOM, and importing src/remotion/index.ts would
 *        execute `registerRoot`. One string, two consumers, neither importing
 *        the other.
 * WHERE: Registered in src/remotion/root.tsx; named by
 *        src/lib/adapters/render/lambda.
 */
export const TIMELINE_COMPOSITION_ID = "timeline";

export const RENDER_QUALITIES = ["preview", "final"] as const;

export const renderQualitySchema = z.enum(RENDER_QUALITIES);

export type RenderQuality = z.infer<typeof renderQualitySchema>;

export const VARIANT_BY_QUALITY: Readonly<Record<RenderQuality, VariantName>> =
  {
    preview: "proxy_480",
    final: "vertical_1080",
  };

/** 30 minutes: long enough for a scrubbing session, short enough that a copied
 *  URL is useless by the time it is pasted anywhere. */
export const PREVIEW_URL_TTL_SECONDS = 1800;

/** Six hours. A queued render that started five hours late must still be able
 *  to fetch its media; a render that cannot is money already spent. */
export const FINAL_URL_TTL_SECONDS = 21600;

export const TTL_BY_QUALITY: Readonly<Record<RenderQuality, number>> = {
  preview: PREVIEW_URL_TTL_SECONDS,
  final: FINAL_URL_TTL_SECONDS,
};

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
    kind: z.enum(["video", "audio", "image", "font"]),
    url: z.string().min(1).nullable(),
    variant: variantNameSchema.nullable(),
    durationInSeconds: z.number().positive().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

export type ResolvedAsset = z.infer<typeof resolvedAssetSchema>;

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
export const assetUrlMapSchema = z.record(z.string(), resolvedAssetSchema);

export type AssetUrlMap = z.infer<typeof assetUrlMapSchema>;

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
    /**
     * WATERMARK_IS_A_PROP, not a document field, and that distinction is the
     * whole of the phase's rule 7. It is an ENTITLEMENT — the answer depends
     * on the plan the workspace is on at the moment the render starts, which
     * is not a property of the video being made. Putting it in the document
     * would mean a generator decided it (which the phase forbids outright), a
     * downgrade could be escaped by re-rendering an old document, and the
     * value would be covered by `hashDoc` instead of by the cache key, so an
     * upgrade would be served the watermarked file it had already paid for.
     *
     * Optional, defaulting to false at the component, because the studio and
     * the CLI render a fixture with no workspace behind it. The only thing
     * that may set it true is the pre-flight in
     * src/inngest/functions/project-render.ts.
     */
    watermark: z.boolean().optional(),
  })
  .strict();

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
  item: Record<string, unknown>;
  /** Every resolved handle in the document. */
  assets: AssetUrlMap;
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
  frames: { from: number; durationInFrames: number };
  /** The canvas, so a component can convert a normalized box to pixels. */
  canvas: { width: number; height: number; fps: number };
  /**
   * SOURCE OF TRUTH KEYWORDS: STYLE_IS_PART_OF_THE_CONTRACT
   *
   * The document's own `style` spec — which palette, which caption style,
   * which platform's safe zone.
   *
   * WHY: added in Phase 16. Before it, a scene family that needed the palette
   * had no way to reach it: the walker hands a component its ITEM, and
   * `sceneItemSchema` is `.strict()` with nowhere to put a document-level
   * value. Phase 13's quiz card worked around that by having its GENERATOR
   * copy `paletteId` and `safeZone` down into an element's `props`, which
   * means the same two values exist in as many copies as there are scenes and
   * a restyle has to rewrite every one of them. Phase 16's motion scenes need
   * both on every beat, so copying that workaround ten times was the moment to
   * fix it instead.
   *
   * It belongs in the shared contract rather than in one family's props for
   * the reason RENDER_COMPONENT_CONTRACT already gives: these props are the
   * UNION of what any family could need, and "what does this document look
   * like" is not specific to one family. Purely additive — every existing
   * component ignores it, and the quiz card's own `props` path still works.
   */
  style: {
    paletteId: string;
    captionStyleId: string;
    safeZone: SafeZone;
  };
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
});

export type PreviewProjectValues = z.infer<typeof previewProjectSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_STATUSES, renderStatusSchema, RenderStatus,
 *   RENDER_TERMINAL_STATUSES, isTerminalRenderStatus, STRING_NOT_ENUM
 *
 * WHAT:  The lifecycle of a Render row.
 * WHY:   STRING_NOT_ENUM, the same reason as every other status union in this
 *        folder: `Render.status` is a Prisma `String` column, so this is the
 *        only thing between a typo and a row no screen can interpret.
 *
 *        `failed` and `timedOut` are SEPARATE states although both mean "no
 *        video". They are different failures with different owners: `failed`
 *        carries a provider error about this document — a composition that
 *        threw, media that could not be fetched — and is usually the
 *        customer's to fix; `timedOut` means the render never reported back
 *        inside the window and says nothing about the document at all, which
 *        is an operator's problem. Collapsing them would make the second kind
 *        invisible, and it is the kind that indicates the renderer itself is
 *        unhealthy.
 *
 *        `queued` is the DEFAULT and is load-bearing: `renders.create` returns
 *        before anything has been started (RENDER_STARTS_OUTSIDE_THE_REQUEST),
 *        so the honest initial state is "accepted, not yet running".
 * WHERE: Render.status; the render panel's progress copy; the workflow's
 *        terminal writes in src/services/renders.service.ts.
 */
export const RENDER_STATUSES = [
  "queued",
  "rendering",
  "completed",
  "failed",
  "timedOut",
] as const;

export const renderStatusSchema = z.enum(RENDER_STATUSES);

export type RenderStatus = z.infer<typeof renderStatusSchema>;

/** No further transition is possible from these; nothing may overwrite them. */
export const RENDER_TERMINAL_STATUSES: readonly RenderStatus[] = [
  "completed",
  "failed",
  "timedOut",
];

export function isTerminalRenderStatus(status: string): boolean {
  return (RENDER_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** The two states a retry is allowed from — see RETRY_ONCE in the renders router. */
export const RENDER_RETRYABLE_STATUSES: readonly RenderStatus[] = [
  "failed",
  "timedOut",
];

export function isRetryableRenderStatus(status: string): boolean {
  return (RENDER_RETRYABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_ATTEMPT_LIMIT, RETRY_ONCE
 *
 * WHAT:  How many times one Render row may be sent to the provider.
 * WHY:   Two: the original and exactly one retry, which is what the phase
 *        asks for. The limit is a counted column rather than a boolean so the
 *        rule is checkable after a restart and visible to an operator reading
 *        the row — `attempts: 2` says plainly that the retry has been spent.
 *        Unbounded retries on a paid render is a customer holding a button
 *        down and an invoice nobody authorised.
 * WHERE: `renders.retry` in src/trpc/routers/renders.ts.
 */
export const RENDER_ATTEMPT_LIMIT = 2;

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_RESOLUTIONS, renderResolutionSchema,
 *   RenderResolution, SCALE_BY_RESOLUTION
 *
 * WHAT:  The output sizes a customer may ask for, and the scale factor each
 *        one means.
 * WHY:   A resolution is expressed as a SCALE of the document's own canvas,
 *        never as a pixel size. The document already states its canvas
 *        (`CANVAS_BY_ASPECT`), and every normalized box, font size and overlay
 *        position in the composition is resolved against it — so rendering at
 *        a different width by changing the canvas would move everything on
 *        screen. Remotion's `scale` multiplies the rasterised output instead,
 *        which is the one knob that changes the file without changing the
 *        picture.
 *
 *        `1080p` is therefore scale 1 — the 9:16 canvas is already 1080x1920 —
 *        and `720p` is two thirds of it. Written as a fraction rather than as
 *        720/1080 because the factor must hold for the 1:1 and 16:9 canvases
 *        Phase 15 allows, where "720p" is not a height of 720 at all.
 * WHERE: createRenderSchema; the download options on the render panel; the
 *        `scale` passed to the render adapter.
 */
export const RENDER_RESOLUTIONS = ["720p", "1080p"] as const;

export const renderResolutionSchema = z.enum(RENDER_RESOLUTIONS);

export type RenderResolution = z.infer<typeof renderResolutionSchema>;

export const SCALE_BY_RESOLUTION: Readonly<Record<RenderResolution, number>> = {
  "720p": 2 / 3,
  "1080p": 1,
};

/**
 * SOURCE OF TRUTH KEYWORDS: RESOLUTION_PER_PLAN, LOCKED_NOT_HIDDEN,
 *   resolutionsForPlan, isResolutionAllowedForPlan, bestResolutionForPlan
 *
 * WHAT:  Which output sizes each plan may render at.
 * WHY:   LOCKED_NOT_HIDDEN is the phase's own rule and it is a product
 *        decision, not a UI one: the render panel renders EVERY resolution in
 *        RENDER_RESOLUTIONS and disables the ones this plan does not include,
 *        because a hidden option cannot be upgraded towards. A customer who
 *        never sees `1080p` has no reason to pay for it.
 *
 *        Why this is not a `flag` in RESOURCES: a flag is a boolean, and this
 *        is a SET per plan. Modelling it as `hd1080` + `hd720` flags would put
 *        two registry entries in a relationship nothing enforces — a plan
 *        could end up with 1080p and not 720p — whereas a record over the
 *        resolution union cannot express that. `watermarkFree` IS genuinely
 *        boolean, which is why that one does live in the registry.
 *
 *        Free renders at 720p only. That is the deliberate pairing with the
 *        watermark: a free export is good enough to prove the product works
 *        and not good enough to publish.
 * WHERE: The render panel's option list, and re-checked server-side by
 *        `renders.create` — a disabled radio is a courtesy, not a boundary.
 */
export const RESOLUTION_PER_PLAN: Readonly<
  Record<PlanKey, readonly RenderResolution[]>
> = {
  free: ["720p"],
  starter: ["720p", "1080p"],
  pro: ["720p", "1080p"],
  enterprise: ["720p", "1080p"],
  portal: ["720p", "1080p"],
};

export function resolutionsForPlan(plan: PlanKey): readonly RenderResolution[] {
  return RESOLUTION_PER_PLAN[plan];
}

export function isResolutionAllowedForPlan(
  plan: PlanKey,
  resolution: RenderResolution,
): boolean {
  return RESOLUTION_PER_PLAN[plan].includes(resolution);
}

/** The highest resolution a plan includes — the sensible default to preselect. */
export function bestResolutionForPlan(plan: PlanKey): RenderResolution {
  const allowed = RESOLUTION_PER_PLAN[plan];
  /* Ordered by RENDER_RESOLUTIONS rather than by the per-plan array, so the
   * answer does not depend on how someone happened to type the list above. */
  const best = [...RENDER_RESOLUTIONS]
    .reverse()
    .find((candidate) => allowed.includes(candidate));
  /* Checked rather than asserted: an empty per-plan list is a configuration
   * mistake, and quietly falling back to 1080p would hand it away for free. */
  if (best === undefined) {
    throw new Error(
      `[types/render] No render resolution is enabled for the "${plan}" plan.`,
    );
  }
  return best;
}

/**
 * SOURCE OF TRUTH KEYWORDS: createRenderSchema, CreateRenderValues,
 *   listRendersSchema, getRenderSchema, retryRenderSchema, RENDER_PAGE_SIZE,
 *   NO_WATERMARK_INPUT
 *
 * WHAT:  The input contract of every `renders.*` procedure.
 * WHY:   `resolution` is REQUIRED rather than defaulted, for the same reason
 *        `createProjectSchema.aspect` is (see ./project): a zod `.default()`
 *        makes a schema's input and output types differ, which breaks React
 *        Hook Form's resolver typing outright. The client preselects
 *        `bestResolutionForPlan` instead, which is a better default anyway —
 *        it is the one the customer is paying for.
 *
 *        NO_WATERMARK_INPUT: there is deliberately no `watermark` field. The
 *        watermark is an entitlement the server resolves
 *        (WATERMARK_BY_ENTITLEMENT); accepting it as input would mean the only
 *        thing between `watermark: false` from a free workspace and a clean
 *        export is a handler remembering to ignore it.
 * WHERE: src/trpc/routers/renders.ts and the render panel.
 */
export const RENDER_PAGE_SIZE = 10;

export const createRenderSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  resolution: renderResolutionSchema,
});

export type CreateRenderValues = z.infer<typeof createRenderSchema>;

export const listRendersSchema = z.object({
  organizationId: z.string().min(1),
  /* Optional: the render panel asks for one project's history, and a
   * workspace-wide activity view asks for all of it. */
  projectId: z.string().min(1).optional(),
  status: renderStatusSchema.optional(),
});

export type ListRendersValues = z.infer<typeof listRendersSchema>;

export const getRenderSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
});

export const retryRenderSchema = getRenderSchema;

export type RetryRenderValues = z.infer<typeof retryRenderSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: estimateRenderSchema, COST_ON_THE_BUTTON
 *
 * WHAT:  Input for `renders.estimate`.
 * WHY:   The same two facts `createRenderSchema` carries minus the commitment
 *        — a separate schema rather than reusing that one, because this is a
 *        READ and conflating them would mean a future required field on
 *        create silently becoming required to see a price.
 * WHERE: The render panel's cost label.
 */
export const estimateRenderSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  resolution: renderResolutionSchema,
});

export type EstimateRenderValues = z.infer<typeof estimateRenderSchema>;
