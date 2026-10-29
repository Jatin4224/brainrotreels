/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: VISUAL_SOURCES, visualSourceSchema, VisualSource,
 *   blockVisualSchema, BlockVisual, visualsSettingsSchema, VisualsSettings,
 *   visualsSettingsToJson, visualPlanSchema, VisualPlan, stockCandidateSchema,
 *   StockCandidate, searchStockSchema, setBlockVisualSchema,
 *   listBlockVisualsSchema, regenerateVisualsSchema, visualPromptHash,
 *   FALLBACK_CHAIN_IS_THE_POINT, PROVENANCE_IS_NOT_OPTIONAL,
 *   CHOICE_IS_STORED_NOT_THE_BYTES, PROMPT_IS_THE_CACHE_KEY,
 *   UPLOAD_IS_A_FOURTH_SOURCE
 *
 * WHAT:  The vocabulary of per-block visuals — where a block's picture came
 *        from, what is stored about it on the project, what a MODEL returns
 *        when it proposes search queries and image prompts, and the input
 *        schema of every `visuals.*` procedure.
 *
 * WHY:   FALLBACK_CHAIN_IS_THE_POINT. The phase's step 4 is a chain — best
 *        matching stock clip, then a generated image, then the styled backdrop
 *        — and every step of it is allowed to fail. So the stored shape has to
 *        be able to say "this block fell back", which is why `source` is a
 *        closed union including `background` rather than a nullable asset id.
 *        A null would be indistinguishable from "nobody has resolved this yet",
 *        and the whole promise of the phase is that a video completes with both
 *        providers unset. A block that fell back is RESOLVED, and the document
 *        it produces is a complete one.
 *
 *        PROVENANCE_IS_NOT_OPTIONAL, and it is the one field here that is
 *        load-bearing on something other than a picture. The phase says it
 *        plainly: "a stock clip whose provenance is unrecorded is unusable the
 *        moment anyone asks". So a stock choice carries the provider, that
 *        provider's own id for the clip and the licence string, and an
 *        `ai_image` choice carries its prompt and (on the asset row) the model
 *        version — the two questions a rights holder actually asks. They are
 *        REQUIRED on the choice rather than optional-with-a-default, because a
 *        default licence is a claim nobody checked (the same argument
 *        LICENSE_TERMS_ARE_NOT_A_CATEGORY makes in ./background.ts).
 *
 *        CHOICE_IS_STORED_NOT_THE_BYTES. What lands in `Project.settings` is
 *        the DECISION — which clip, which prompt — and an `assetId` that is
 *        filled in once the ingest has finished. It is deliberately NOT the
 *        provider's URL used as the thing a timeline points at: the phase's own
 *        "no timeline item references a provider URL directly" is enforced
 *        structurally by `ResolvedBlockVisual` (src/lib/generators/types.ts)
 *        carrying an `assetId` and nothing else, so a generator has no URL to
 *        reach for. `downloadUrl` lives here only long enough for the ingest
 *        workflow to read it once, on the far side of the queue.
 *
 *        PROMPT_IS_THE_CACHE_KEY is the phase's step 10, and it is a HASH
 *        rather than the text because it is matched against an indexed column:
 *        the prompt itself is up to five hundred characters of prose, and
 *        `Asset.promptText` exists for the audit rather than for the lookup.
 *        Hashed with the same `hashValue` the render cache and the idempotency
 *        keys use, so there is one hasher in the codebase and not three.
 *
 *        UPLOAD_IS_A_FOURTH_SOURCE, and it is a deliberate widening of the
 *        phase's own contract. The phase's `resolveBlockVisual` returns
 *        `'stock' | 'ai_image' | 'background'`, but its step 8 requires that a
 *        customer can "upload their own" for a block — and that outcome is none
 *        of the three. Folding it into `stock` would record a stock licence
 *        against a customer's own file, which is exactly the claim
 *        PROVENANCE_IS_NOT_OPTIONAL exists to prevent. So there are four
 *        values, the automatic chain still only ever produces the phase's
 *        three, and the fourth is reachable only from the swap UI.
 *
 *        PURE — no Prisma, no network, no `server-only`. The schemas are read
 *        by a form, a router, a workflow and a generator alike.
 * WHERE: Written by `src/services/visuals.service.ts` into
 *        `Project.settings.visuals`; read by `generatorContextFor`, the
 *        `visuals` stage of src/inngest/functions/project-generate.ts, the
 *        `visuals` router and the visual picker.
 */

import { z } from "zod";

import { hashValue } from "@/lib/timeline/hash";
import type { JsonObject } from "./json";

/**
 * SOURCE OF TRUTH KEYWORDS: VISUAL_SOURCES, visualSourceSchema, VisualSource,
 *   FALLBACK_CHAIN_IS_THE_POINT, UPLOAD_IS_A_FOURTH_SOURCE
 *
 * WHAT:  Where one block's picture came from.
 * WHY:   A closed union, in the chain's own order, because every consumer
 *        branches on it and three of the four have different provenance
 *        obligations. `background` is a REAL outcome and not an error state —
 *        see FALLBACK_CHAIN_IS_THE_POINT in the file header. `upload` is the
 *        widening UPLOAD_IS_A_FOURTH_SOURCE explains.
 * WHERE: `visualChoiceSchema`'s discriminator; the swap UI's tabs.
 */
export const VISUAL_SOURCES = [
  "stock",
  "ai_image",
  "upload",
  "background",
] as const;

export const visualSourceSchema = z.enum(VISUAL_SOURCES);

export type VisualSource = z.infer<typeof visualSourceSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: VISUAL_QUERY_MAX_CHARS, VISUAL_PROMPT_MAX_CHARS,
 *   VISUAL_STOCK_RESULTS, BOUND_WHAT_THE_MODEL_WRITES
 *
 * WHAT:  How long a proposed search query and image prompt may be, and how
 *        many candidates a search returns.
 *
 * WHY:   BOUND_WHAT_THE_MODEL_WRITES, for the same reasons every other cap in
 *        this codebase exists. A query is typed into somebody else's search API
 *        and a long one matches nothing — stock search is keyword matching, so
 *        "a lone astronaut drifting past a shattered viewport" returns fewer
 *        and worse results than "astronaut space station". The prompt cap is
 *        generous because an image prompt genuinely needs sentences, and it is
 *        still a cap because it is stored on every asset row for auditing and
 *        sent to a billed model.
 *
 *        Twelve candidates is a judgement in the same shape as
 *        REDDIT_TOP_COMMENTS: enough that the swap UI is a choice rather than a
 *        single suggestion, few enough that one search is one screen.
 * WHERE: `visualPlanSchema`, `searchStockSchema`, and the stock adapter's
 *        request parameters.
 */
export const VISUAL_QUERY_MAX_CHARS = 120;
export const VISUAL_PROMPT_MAX_CHARS = 500;
export const VISUAL_STOCK_RESULTS = 12;

/**
 * SOURCE OF TRUTH KEYWORDS: VISUAL_MIN_CLIP_SECONDS, A_CLIP_SHORTER_THAN_A_BEAT
 *
 * WHAT:  The shortest stock clip worth using for a block.
 * WHY:   A_CLIP_SHORTER_THAN_A_BEAT. A one-second clip under a six-second
 *        narration block loops six times, which reads as a stutter rather than
 *        as footage — and `LOOP_IS_A_MODULO` will happily do it. Two seconds is
 *        the point below which a loop is visible on a phone at a glance; above
 *        it, a repeat reads as a held shot. It is a floor on the SEARCH rather
 *        than on the chain: a block with no clip above the floor falls through
 *        to an image, which never stutters.
 * WHERE: The stock search's `minDurationSec`.
 */
export const VISUAL_MIN_CLIP_SECONDS = 2;

/**
 * SOURCE OF TRUTH KEYWORDS: stockCandidateSchema, StockCandidate,
 *   PROVENANCE_IS_NOT_OPTIONAL, LICENCE_TRAVELS_WITH_THE_CANDIDATE
 *
 * WHAT:  One clip a stock provider offered, as the swap UI shows it and as the
 *        ingest reads it back.
 *
 * WHY:   LICENCE_TRAVELS_WITH_THE_CANDIDATE. The licence and the attribution
 *        are on the CANDIDATE, not looked up later from the provider id,
 *        because the phase's step 8 requires the licence to be shown on each
 *        candidate — and a UI that had to resolve a provider id to a licence
 *        string would be a second copy of the mapping, in a component, drifting
 *        from the one the asset row records.
 *
 *        `previewUrl` and `downloadUrl` are different fields on purpose. The
 *        preview is a small file a browser shows in a grid; the download is the
 *        full-resolution master the ingest pulls. Collapsing them would either
 *        ingest a thumbnail or make the picker fetch megabytes per tile.
 * WHERE: Returned by `visuals.searchStock`; carried on a `stock` choice.
 */
export const stockCandidateSchema = z
  .object({
    /** The stock seam's provider id — `pexels` today. */
    provider: z.string().trim().min(1).max(40),
    /** That provider's OWN id for this clip. Half of the provenance record. */
    providerId: z.string().trim().min(1).max(120),
    previewUrl: z.string().url().max(2_000),
    downloadUrl: z.string().url().max(2_000),
    /** The licence NAME, as the provider states it. Never defaulted. */
    license: z.string().trim().min(1).max(200),
    attribution: z.string().trim().max(300).optional(),
    durationSec: z.number().positive().finite().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

export type StockCandidate = z.infer<typeof stockCandidateSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: visualChoiceSchema, VisualChoice,
 *   CHOICE_IS_STORED_NOT_THE_BYTES, PROMPT_IS_THE_CACHE_KEY
 *
 * WHAT:  What was decided for one block, before or after the bytes exist.
 *
 * WHY:   A DISCRIMINATED UNION on `source`, so each outcome carries exactly the
 *        provenance it owes and nothing it does not. A single flat object with
 *        every field optional was the alternative and it loses the only
 *        property that matters here: that a `stock` choice CANNOT exist without
 *        a licence, and an `ai_image` choice cannot exist without the prompt it
 *        was made from. TypeScript enforces that at every callsite instead of a
 *        reviewer having to.
 *
 *        `background` carries nothing, because the backdrop is a style the
 *        document already knows (`paletteIdFor`) rather than an asset. An
 *        `assetId` on it would be a handle to a thing that does not exist.
 * WHERE: `blockVisualSchema.choice`.
 */
export const visualChoiceSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("stock"),
      provider: stockCandidateSchema.shape.provider,
      providerId: stockCandidateSchema.shape.providerId,
      previewUrl: stockCandidateSchema.shape.previewUrl,
      downloadUrl: stockCandidateSchema.shape.downloadUrl,
      license: stockCandidateSchema.shape.license,
      attribution: stockCandidateSchema.shape.attribution,
      durationSec: stockCandidateSchema.shape.durationSec,
      width: stockCandidateSchema.shape.width,
      height: stockCandidateSchema.shape.height,
    })
    .strict(),
  z
    .object({
      source: z.literal("ai_image"),
      prompt: z.string().trim().min(1).max(VISUAL_PROMPT_MAX_CHARS),
      /* PROMPT_IS_THE_CACHE_KEY — see the file header. Stored rather than
       * recomputed so the row the cache matched can be found again from the
       * settings alone, without re-hashing prose that a later release might
       * normalise differently. */
      promptHash: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      source: z.literal("upload"),
      /** The workspace's own Asset. Checked for readability on the write. */
      assetId: z.string().trim().min(1).max(120),
    })
    .strict(),
  z.object({ source: z.literal("background") }).strict(),
]);

export type VisualChoice = z.infer<typeof visualChoiceSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: VISUAL_STATUSES, visualStatusSchema, VisualStatus
 *
 * WHAT:  How far one block's visual has got.
 * WHY:   The same split, and for the same reason, as `Asset.status`: a choice
 *        that has been made and a choice whose bytes are in our bucket are
 *        different facts, and the generator may only use the second. `failed`
 *        is kept rather than collapsing to `background`, because the two tell a
 *        customer different things — one says "this is what you chose" and the
 *        other says "we could not fetch it, here is why" — and the swap UI
 *        offers a retry only for the second.
 * WHERE: `blockVisualSchema.status`.
 */
export const VISUAL_STATUSES = ["pending", "ready", "failed"] as const;

export const visualStatusSchema = z.enum(VISUAL_STATUSES);

export type VisualStatus = z.infer<typeof visualStatusSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: blockVisualSchema, BlockVisual, BLOCK_ID_IS_THE_KEY
 *
 * WHAT:  One script block's visual: what was chosen, where the bytes ended up,
 *        and the query the choice came from.
 *
 * WHY:   BLOCK_ID_IS_THE_KEY, not the block's position. A block's position
 *        changes when one is inserted or deleted on the script screen, and a
 *        positional key would silently re-point every visual after the edit —
 *        the picture for paragraph three ending up over paragraph four, which
 *        is a bug nobody would attribute to a script edit. The `ScriptBlock` id
 *        is stable for the life of the block, which is exactly the lifetime a
 *        visual has.
 *
 *        `query` and `prompt` are carried even for a resolved block, because
 *        the swap UI's "search again" and "generate again" actions need the
 *        text that produced the current pick — and re-deriving it would mean a
 *        second model call to ask the same question twice.
 * WHERE: `visualsSettingsSchema.blocks`.
 */
export const blockVisualSchema = z
  .object({
    blockId: z.string().trim().min(1).max(120),
    choice: visualChoiceSchema,
    status: visualStatusSchema,
    /** The real `Asset` row id. Absent while pending, and for `background`. */
    assetId: z.string().trim().min(1).max(120).optional(),
    /** The stock query this block's pick came from, for a second search. */
    query: z.string().trim().max(VISUAL_QUERY_MAX_CHARS).optional(),
    /** The image prompt proposed for this block, for a second generation. */
    prompt: z.string().trim().max(VISUAL_PROMPT_MAX_CHARS).optional(),
    /** Customer-facing, and only on `failed`. */
    error: z.string().trim().max(300).optional(),
  })
  .strict();

export type BlockVisual = z.infer<typeof blockVisualSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: visualsSettingsSchema, VisualsSettings,
 *   SETTINGS_ARE_PARSED_NOT_TRUSTED, IMAGES_GENERATED_IS_CUMULATIVE
 *
 * WHAT:  The `visuals` block of `Project.settings`.
 *
 * WHY:   A record under one key, parsed with its own schema on every read, like
 *        every other owner of that shared jsonb column (`generate`, `captions`,
 *        `quiz`). `blocks` is an ARRAY rather than a map keyed by block id,
 *        because the order is the script's and a map would need sorting at
 *        every read to render a list.
 *
 *        IMAGES_GENERATED_IS_CUMULATIVE: a COUNT rather than something derived
 *        from `blocks`, because it has to survive a re-prompt. A block
 *        generated twice cost two images, and the number the customer was
 *        charged has to agree with what was spent rather than with how many
 *        pictures happen to be in the document now.
 * WHERE: Read by `readBlockVisuals`; written by `writeBlockVisuals`.
 */
export const visualsSettingsSchema = z
  .object({
    blocks: z.array(blockVisualSchema).max(200),
    /** Images this project has paid a model for, cumulatively. */
    imagesGenerated: z.number().int().min(0).default(0),
  })
  .strict();

export type VisualsSettings = z.infer<typeof visualsSettingsSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: visualsSettingsToJson, JSON_IS_NOT_THE_TYPE
 *
 * WHAT:  The settings as a plain `JsonObject`, for the jsonb write.
 * WHY:   JSON_IS_NOT_THE_TYPE, exactly why `quizSettingsToJson` exists: a
 *        zod-inferred object with optional properties is not assignable to
 *        Prisma's `InputJsonValue`, and the honest fix is one explicit mapping
 *        rather than a cast at the callsite. Absent fields are OMITTED rather
 *        than written as null, so a re-read parses to the same value it was
 *        given.
 * WHERE: `writeBlockVisuals` in src/services/visuals.service.ts.
 */
export function visualsSettingsToJson(settings: VisualsSettings): JsonObject {
  return {
    imagesGenerated: settings.imagesGenerated,
    blocks: settings.blocks.map(
      (block): JsonObject => ({
        blockId: block.blockId,
        choice: choiceToJson(block.choice),
        status: block.status,
        ...(block.assetId === undefined ? {} : { assetId: block.assetId }),
        ...(block.query === undefined ? {} : { query: block.query }),
        ...(block.prompt === undefined ? {} : { prompt: block.prompt }),
        ...(block.error === undefined ? {} : { error: block.error }),
      }),
    ),
  };
}

function choiceToJson(choice: VisualChoice): JsonObject {
  switch (choice.source) {
    case "stock":
      return {
        source: choice.source,
        provider: choice.provider,
        providerId: choice.providerId,
        previewUrl: choice.previewUrl,
        downloadUrl: choice.downloadUrl,
        license: choice.license,
        ...(choice.attribution === undefined
          ? {}
          : { attribution: choice.attribution }),
        ...(choice.durationSec === undefined
          ? {}
          : { durationSec: choice.durationSec }),
        ...(choice.width === undefined ? {} : { width: choice.width }),
        ...(choice.height === undefined ? {} : { height: choice.height }),
      };
    case "ai_image":
      return {
        source: choice.source,
        prompt: choice.prompt,
        promptHash: choice.promptHash,
      };
    case "upload":
      return { source: choice.source, assetId: choice.assetId };
    case "background":
      return { source: choice.source };
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: visualPromptHash, PROMPT_IS_THE_CACHE_KEY,
 *   ONE_HASHER_IN_THE_CODEBASE
 *
 * WHAT:  The cache key for one image prompt.
 *
 * WHY:   PROMPT_IS_THE_CACHE_KEY is the phase's step 10 — "an identical prompt
 *        in the same workspace reuses the existing asset rather than paying
 *        twice, the same discipline as `textHash` and `audioHash`" — and this
 *        is the function that makes "identical" mean something stable. The
 *        prompt is lower-cased and whitespace-collapsed before hashing, because
 *        two prompts differing only in a trailing newline are the same request
 *        and charging twice for them is the leak this exists to stop.
 *
 *        ONE_HASHER_IN_THE_CODEBASE: `hashValue` from the timeline module,
 *        which is the same function the render cache and the pipeline's
 *        idempotency key use. A second hash implementation here would be a
 *        second thing to keep stable across releases, and a cache key that
 *        changes meaning is a cache that silently stops working.
 *
 *        The workspace is NOT part of the key, deliberately: the key identifies
 *        the PROMPT, and the tenant scoping is a `where` clause on the lookup
 *        (`organizationId` + `promptHash`). Baking the id in would make the
 *        same prompt hash differently per tenant, which is the same answer with
 *        the scoping in the wrong place — and it would stop an operator ever
 *        being able to ask how often one prompt is used.
 * WHERE: `visualChoiceSchema`'s `ai_image` arm; the cache lookup in
 *        src/services/visuals.service.ts.
 */
export function visualPromptHash(prompt: string): string {
  return hashValue(prompt.trim().toLowerCase().replace(/\s+/g, " "));
}

/**
 * SOURCE OF TRUTH KEYWORDS: visualPlanSchema, visualPlanItemSchema, VisualPlan,
 *   MODEL_OUTPUT_SCHEMA, PLAN_IS_INDEXED_NOT_IDENTIFIED
 *
 * WHAT:  What a model returns when asked what each block should show.
 *
 * WHY:   MODEL_OUTPUT_SCHEMA, the same argument `quizDraftSchema` makes: the
 *        model is asked for the CONTENT and nothing else. No block ids, no
 *        asset ids, no source choice — the chain decides where a picture comes
 *        from (FALLBACK_CHAIN_IS_THE_POINT) and a model allowed to say "use
 *        stock for this one" would be a model overruling a decision about
 *        somebody's credits.
 *
 *        PLAN_IS_INDEXED_NOT_IDENTIFIED. The model answers by POSITION, because
 *        handing it our database ids would put opaque cuids in a prompt for no
 *        benefit and invite a model to echo one back malformed. The caller zips
 *        the answer against the blocks it sent, in order, and an item whose
 *        index is out of range is DROPPED rather than guessed at — a block with
 *        no plan entry falls through the chain to the backdrop, which is a
 *        complete video, and putting a picture over the wrong words is not.
 * WHERE: `proposeBlockVisuals` in src/lib/script/visuals.ts.
 */
export const visualPlanItemSchema = z
  .object({
    /** Zero-based, matching the order the blocks were sent in. */
    index: z.number().int().min(0),
    /** Two to five keywords for a stock search. */
    query: z.string().trim().min(1).max(VISUAL_QUERY_MAX_CHARS),
    /** A sentence or two describing the still to generate. */
    prompt: z.string().trim().min(1).max(VISUAL_PROMPT_MAX_CHARS),
  })
  .strict();

export type VisualPlanItem = z.infer<typeof visualPlanItemSchema>;

export const visualPlanSchema = z
  .object({ items: z.array(visualPlanItemSchema).min(1).max(200) })
  .strict();

export type VisualPlan = z.infer<typeof visualPlanSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Procedure inputs. One schema per verb, every one tenant-scoped —
 * `organizationId` is required on all of them because `protectedProcedure`
 * resolves the workspace from the input (src/trpc/procedures/protected.ts).
 * ──────────────────────────────────────────────────────────────────────────── */

export const listBlockVisualsSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});

export type ListBlockVisualsValues = z.infer<typeof listBlockVisualsSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: searchStockSchema, SEARCH_IS_SCORED_FOR_A_BLOCK
 *
 * WHAT:  A customer-typed stock search, for one paragraph.
 * WHY:   SEARCH_IS_SCORED_FOR_A_BLOCK. `blockId` is required although a search
 *        reads nothing about the block, because the RESULTS are ordered by how
 *        well each clip covers that paragraph's length
 *        (COVERAGE_BEATS_RESOLUTION) — and the server reads that length from
 *        the project's own measured narration rather than taking it from the
 *        client. Without it the grid would have to be ordered by the provider's
 *        relevance, which would disagree with the automatic pick and make "why
 *        did it choose that one" unanswerable (PICKER_SHOWS_THE_SAME_ORDER).
 * WHERE: `aiImages.searchStock`.
 */
export const searchStockSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  blockId: z.string().min(1),
  query: z.string().trim().min(2).max(VISUAL_QUERY_MAX_CHARS),
});

export type SearchStockValues = z.infer<typeof searchStockSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: setBlockVisualSchema, SetBlockVisualValues,
 *   SWAP_IS_ONE_BLOCK
 *
 * WHAT:  Replace one block's visual.
 * WHY:   SWAP_IS_ONE_BLOCK, which is the phase's own "swapping one block's
 *        visual leaves the other blocks untouched" expressed as a SIGNATURE
 *        rather than as something a handler remembers to do. There is no batch
 *        form and no "apply to all": the input names one `blockId`, so the only
 *        write it can perform is to that block's entry.
 * WHERE: `visuals.setBlockVisual`.
 */
export const setBlockVisualSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  blockId: z.string().min(1),
  choice: visualChoiceSchema,
});

export type SetBlockVisualValues = z.infer<typeof setBlockVisualSchema>;

/* There is deliberately NO "choose for me again" schema here. Re-running the
 * chain costs a model call for the shot plan plus a search and possibly an
 * image per block, and it belongs to the generate pipeline where the hold, the
 * settlement and the per-block ingest runs already live — see
 * THE_CHAIN_IS_NOT_RE_RUN_HERE in src/trpc/routers/visuals.ts. The four things
 * a customer can do are all one `setBlockVisual` with a different `choice`. */
