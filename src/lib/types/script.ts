/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SECTION_TYPES, sectionTypeSchema, SectionType,
 *   SCRIPT_TONES, scriptToneSchema, ScriptTone, WORDS_PER_SECOND,
 *   estimateSpokenSeconds, SCRIPT_WARN_SECONDS, scriptDraftSchema,
 *   ScriptBlockDraft, SOURCE_KINDS, generateScriptSchema, MODEL_OUTPUT_SCHEMA
 *
 * WHAT:  The vocabulary of a script — its sections, its tones, the pacing
 *        maths, the shape the MODEL must return, and the input schema of every
 *        `scripts.*` procedure.
 *
 * WHY:   The model-facing schema and the database-facing one are deliberately
 *        DIFFERENT objects, and that separation is the phase's central safety
 *        property. `scriptDraftSchema` is what a model is constrained to
 *        produce; `ScriptBlock` rows are what we store. Nothing writes a row
 *        from model output without passing through the draft schema first, so
 *        "malformed model output never reaches the database" is structural
 *        rather than a rule somebody remembers.
 *
 *        Keeping them separate also means the model is never asked for fields
 *        it has no business choosing — a row id, a project id, a position in
 *        a list it cannot see. Grep MODEL_OUTPUT_SCHEMA.
 * WHERE: src/lib/script/*, src/services/scripts.service.ts,
 *        src/trpc/routers/scripts.ts and the script editor.
 *        Re-exported from src/lib/types.
 */

import { z } from 'zod'

/**
 * SOURCE OF TRUTH KEYWORDS: SECTION_TYPES, sectionTypeSchema, SectionType
 *
 * WHAT:  What a block is for.
 * WHY:   Three, and only three, because they are the three jobs a short-form
 *        script does: earn attention, deliver, ask. A free-form label would
 *        let a model invent `intro`, `outro`, `transition` — and every
 *        consumer downstream (the editor's grouping, Phase 07's voice
 *        assignment, Phase 09's timeline builder) would need a fallback for
 *        labels nobody designed for.
 *
 *        `hook` and `cta` are expected to appear at most once; that is NOT
 *        enforced by this type because a model returning two hooks is a
 *        quality problem, not a corrupt document, and refusing the whole
 *        generation over it would waste a paid request that is otherwise
 *        usable. The editor shows them grouped and the customer can delete
 *        one.
 * WHERE: ScriptBlock.sectionType; the editor's section grouping.
 */
export const SECTION_TYPES = ['hook', 'body', 'cta'] as const

export const sectionTypeSchema = z.enum(SECTION_TYPES)

export type SectionType = z.infer<typeof sectionTypeSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: SCRIPT_TONES, scriptToneSchema, ScriptTone
 *
 * WHAT:  The voice a script is written in.
 * WHY:   A CLOSED ENUM rather than a free-text style field, and the reason is
 *        security as much as product: the tone is interpolated into the
 *        prompt, so a free-text value is an instruction channel straight into
 *        the model with no delimiter around it. An enum cannot carry an
 *        injection. Grep UNTRUSTED_TEXT_IS_NEVER_SYSTEM.
 * WHERE: generateScriptSchema; the tone picker.
 */
export const SCRIPT_TONES = ['casual', 'dramatic', 'educational', 'hype'] as const

export const scriptToneSchema = z.enum(SCRIPT_TONES)

export type ScriptTone = z.infer<typeof scriptToneSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: SOURCE_KINDS, sourceKindSchema, SourceKind
 *
 * WHAT:  Where the raw material came from.
 * WHY:   Recorded because the three paths fail differently and a customer
 *        asking "why is my script wrong" is usually answered by which one ran:
 *        a URL may have been paywalled and yielded navigation chrome, a PDF
 *        may have been a scan with no text layer, and raw text is whatever
 *        they pasted. The phase asks for this explicitly.
 * WHERE: `Project.sourceRef` carries the value; this records the path.
 */
export const SOURCE_KINDS = ['url', 'pdf', 'text'] as const

export const sourceKindSchema = z.enum(SOURCE_KINDS)

export type SourceKind = z.infer<typeof sourceKindSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: WORDS_PER_SECOND, estimateSpokenSeconds,
 *   SCRIPT_WARN_SECONDS, PACING
 *
 * WHAT:  How long a piece of narration takes to say.
 * WHY:   2.5 words per second is the phase's figure and is a reasonable
 *        mid-point for energetic short-form delivery (roughly 150 wpm).
 *
 *        It is an ESTIMATE and is labelled as one everywhere it surfaces. The
 *        real duration is not known until Phase 07 synthesises the audio and
 *        Phase 08 aligns it — at which point the timeline uses the measured
 *        word timings, not this. What this number is for is the two decisions
 *        that must be made BEFORE spending anything: warning a customer that
 *        their script is too long, and pricing the generation.
 *
 *        SCRIPT_WARN_SECONDS is 60 because that is where most short-form
 *        surfaces stop favouring a video. The phase is explicit that this
 *        WARNS rather than truncates: silently cutting a script loses work the
 *        customer may have wanted, and does it at the end, where they will not
 *        notice until the video is made.
 * WHERE: The duration on every block, the pacing warning, the credit estimate.
 */
export const WORDS_PER_SECOND = 2.5

export const SCRIPT_WARN_SECONDS = 60

/**
 * SOURCE OF TRUTH KEYWORDS: countSpokenWords, estimateSpokenSeconds
 *
 * WHAT:  Seconds of speech for a piece of narration.
 * WHY:   Splitting on whitespace is deliberately crude and is right for this:
 *        the alternative (syllable counting, a pronunciation dictionary) is
 *        far more code for a number that is superseded by real alignment two
 *        phases later. What it must do is be STABLE — the same text always
 *        gives the same number — so the warning and the charge agree.
 *
 *        Returns 0 for empty or whitespace-only text rather than a floor,
 *        because an empty block genuinely takes no time and a floor would make
 *        a script of ten empty blocks look like it had content.
 * WHERE: Every write of `ScriptBlock.durationEstimate`.
 */
export function countSpokenWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

export function estimateSpokenSeconds(text: string): number {
  const words = countSpokenWords(text)
  if (words === 0) return 0
  /* Rounded to two decimals: the column is a float and a full-precision
   * division produces values like 4.800000000000001, which render badly and
   * make two equal scripts look different in a diff. */
  return Math.round((words / WORDS_PER_SECOND) * 100) / 100
}

/**
 * SOURCE OF TRUTH KEYWORDS: MODEL_OUTPUT_SCHEMA, scriptDraftSchema,
 *   ScriptDraft, ScriptBlockDraft
 *
 * WHAT:  Exactly what a model is allowed to return for a whole script.
 *
 * WHY:   MODEL_OUTPUT_SCHEMA. This is the boundary the phase's "malformed
 *        model output never reaches the database" rests on, so every field is
 *        bounded rather than merely typed:
 *
 *        - `narrationText` has a MINIMUM and a MAXIMUM. A one-character block
 *          is a model failure, not a terse hook; a 5,000-character block is a
 *          model that ignored the structure and returned an essay, and storing
 *          it would produce a "block" nothing can re-record.
 *        - `blocks` is capped. An unbounded array is an unbounded number of
 *          database rows from one paid request.
 *        - There is NO `position` field. Order is the array's order, assigned
 *          by us on write — asking a model for indices invites gaps,
 *          duplicates and off-by-ones that then have to be repaired.
 *        - There is no id, no projectId, no durationEstimate. The model is
 *          asked only for what it is qualified to decide: words and their
 *          purpose.
 *
 *        `.strict()` so an invented field fails the parse rather than being
 *        silently dropped — on this path an unexpected field means the model
 *        misunderstood the task, and that is worth one retry.
 * WHERE: Passed as `schema` to the LLM adapter; parsed before any write.
 */
export const SCRIPT_BLOCK_MIN_CHARS = 2
export const SCRIPT_BLOCK_MAX_CHARS = 2_000
export const SCRIPT_MAX_BLOCKS = 40

export const scriptBlockDraftSchema = z
  .object({
    sectionType: sectionTypeSchema,
    narrationText: z.string().min(SCRIPT_BLOCK_MIN_CHARS).max(SCRIPT_BLOCK_MAX_CHARS),
  })
  .strict()

export type ScriptBlockDraft = z.infer<typeof scriptBlockDraftSchema>

export const scriptDraftSchema = z
  .object({
    title: z.string().min(1).max(200),
    blocks: z.array(scriptBlockDraftSchema).min(1).max(SCRIPT_MAX_BLOCKS),
  })
  .strict()

export type ScriptDraft = z.infer<typeof scriptDraftSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: blockRewriteSchema
 *
 * WHAT:  What a model returns when rewriting ONE block.
 * WHY:   A separate, smaller schema than the whole draft — the model is asked
 *        for one block and must not be able to return a second
 *        (CONTEXT_IN_ONLY_ONE_OUT). `sectionType` is absent because the
 *        section is not the model's to change: a hook being rewritten stays a
 *        hook, and letting the model move it would reorder the script as a
 *        side effect of a rewrite.
 * WHERE: regenerateScriptBlock.
 */
export const blockRewriteSchema = z
  .object({
    narrationText: z.string().min(SCRIPT_BLOCK_MIN_CHARS).max(SCRIPT_BLOCK_MAX_CHARS),
  })
  .strict()

export type BlockRewrite = z.infer<typeof blockRewriteSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: SOURCE_TEXT_MAX_CHARS, EXTRACTED_TEXT_CAP
 *
 * WHAT:  The most source material that will ever reach a model.
 * WHY:   EXTRACTED_TEXT_CAP. Three reasons, in order of how much they hurt:
 *        an unbounded input is an unbounded BILL per generation; a long input
 *        dilutes the instructions that matter (a script is made from the first
 *        few thousand words, not from an entire site); and a very long input
 *        can push the response into `max_tokens` and fail the schema.
 *
 *        Truncation here is deliberate and REPORTED — `extractSource` returns
 *        whether it trimmed, and the UI says so — unlike the silent cap inside
 *        the fetch, which is about memory rather than meaning.
 * WHERE: src/lib/script/ingest.ts.
 */
export const SOURCE_TEXT_MAX_CHARS = 24_000

/** The most bytes a fetched page may occupy in memory. See CAP_WHILE_STREAMING. */
export const SOURCE_FETCH_MAX_BYTES = 2 * 1024 * 1024

/** One budget for the whole redirect chain. */
export const SOURCE_FETCH_TIMEOUT_MS = 15_000

/**
 * SOURCE OF TRUTH KEYWORDS: generateScriptSchema, listScriptSchema,
 *   updateScriptBlockSchema, reorderScriptSchema, regenerateBlockSchema,
 *   deleteScriptBlockSchema, addScriptBlockSchema
 *
 * WHAT:  The input contract of every `scripts.*` procedure.
 * WHY:   `tone` and `kind` are enums rather than strings for the reason on
 *        SCRIPT_TONES: both are interpolated into a prompt, and an enum cannot
 *        carry an instruction.
 *
 *        `targetSeconds` is bounded at both ends. Below about ten seconds
 *        there is no room for a hook and a payoff; above three minutes this is
 *        not the product. The cap is also a cost control — the word budget,
 *        and therefore the output tokens, is derived from it.
 *
 *        `source` is a discriminated union so a URL and a blob of pasted text
 *        cannot be confused: they are validated differently (a URL must parse
 *        and pass the SSRF guard) and a single `value: string` field would
 *        make the kind a claim rather than a constraint.
 * WHERE: src/trpc/routers/scripts.ts and the generation form.
 */
export const SCRIPT_TARGET_SECONDS_MIN = 10
export const SCRIPT_TARGET_SECONDS_MAX = 180

export const scriptSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('url'),
    /* Checked properly by the SSRF guard server-side; this only catches the
     * obvious before a request is made. */
    value: z.string().trim().url().max(2_000),
  }),
  z.object({
    kind: z.literal('text'),
    value: z.string().trim().min(1).max(SOURCE_TEXT_MAX_CHARS),
  }),
  z.object({
    kind: z.literal('pdf'),
    /* A storage key for an already-uploaded PDF, not the bytes. The file goes
     * through the normal upload path so it is size-capped and owned by the
     * workspace before anything reads it. */
    value: z.string().trim().min(1).max(500),
  }),
])

export type ScriptSource = z.infer<typeof scriptSourceSchema>

export const generateScriptSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  source: scriptSourceSchema,
  tone: scriptToneSchema,
  targetSeconds: z
    .number()
    .int()
    .min(SCRIPT_TARGET_SECONDS_MIN)
    .max(SCRIPT_TARGET_SECONDS_MAX),
})

export type GenerateScriptValues = z.infer<typeof generateScriptSchema>

export const listScriptSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
})

export const updateScriptBlockSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
  narrationText: z.string().trim().min(SCRIPT_BLOCK_MIN_CHARS).max(SCRIPT_BLOCK_MAX_CHARS),
})

export type UpdateScriptBlockValues = z.infer<typeof updateScriptBlockSchema>

export const addScriptBlockSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  sectionType: sectionTypeSchema,
  /* Where to insert. Omitted means append. */
  afterId: z.string().min(1).optional(),
})

export const deleteScriptBlockSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
})

export const reorderScriptSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  /* The complete, ordered list of block ids. Sent whole rather than as a
   * from/to pair, because a drag is a new ORDER and reconstructing it from a
   * move is how two concurrent drags produce an order neither person chose. */
  orderedIds: z.array(z.string().min(1)).min(1).max(SCRIPT_MAX_BLOCKS),
})

export const regenerateBlockSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
  tone: scriptToneSchema,
  /* Optional free-text direction from the customer ("make it funnier"). It is
   * untrusted and goes through wrapUntrusted like any other foreign text. */
  instruction: z.string().trim().max(500).optional(),
})

export type RegenerateBlockValues = z.infer<typeof regenerateBlockSchema>
