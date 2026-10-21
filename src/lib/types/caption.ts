/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: CaptionStyle, captionStyleSchema, CAPTION_ANIMATIONS,
 *   CAPTION_CASES, CAPTION_POSITIONS, CAPTION_FONT_KEYS, SAFE_ZONE_INSETS,
 *   CAPTION_WORDS_PER_CHUNK, applyCaptionStyleSchema, alignProjectSchema,
 *   STYLES_ARE_DATA, PREMIUM_IS_A_STYLE_TIER, BUNDLED_FONT_ONLY,
 *   COLOURS_ARE_CONTENT, ALIGNMENT_ENGINES
 *
 * WHAT:  The vocabulary of the caption library — what a style may say about
 *        itself, what a platform's safe zone is worth in pixels, and the input
 *        schema of every `captions.*` procedure.
 *
 * WHY:   STYLES_ARE_DATA is the phase's step 5 and the reason this file is a
 *        type rather than a component. A caption style is a ROW OF CONFIG, not
 *        a React component: thirty styles as thirty components is thirty
 *        places for the word-highlighting logic to drift, and adding the
 *        thirty-first becomes a deploy of new code instead of a data change.
 *        One component reads these fields; a new style is an object in
 *        src/lib/captions/styles/.
 *
 *        COLOURS_ARE_CONTENT. Every other surface in this app is forbidden
 *        literal colours and must use the theme tokens — a caption is the one
 *        exception, and deliberately: it is burned into a customer's video,
 *        which has no theme, no dark mode and no CSS variables. A caption that
 *        followed `--foreground` would be invisible on half the backgrounds
 *        people put behind it. The price of that exception is that every
 *        colour here has to pass a CONTRAST TEST instead of a reviewer's eye —
 *        see src/lib/captions/contrast.ts, which is run over the whole library
 *        by a test rather than trusted.
 *
 *        BUNDLED_FONT_ONLY, inherited from src/remotion/fonts.ts and the
 *        reason `font` is a KEY rather than a family name. There is exactly
 *        one bundled face today, so a style claiming "Impact" would render in
 *        Geist and the customer would never be told. `CAPTION_FONT_KEYS` maps
 *        the names a style may ask for onto the faces that are actually
 *        bundled; adding a face is a woff2 in public/fonts plus a key here,
 *        and until then a style cannot claim one that does not exist.
 *
 *        PREMIUM_IS_A_STYLE_TIER: `minPlan` on the style, plus the
 *        `premiumCaptionStyles` registry flag. Identical to the voice
 *        catalogue's split and for the identical reason — the flag answers
 *        "may this workspace use gated styles at all", `minPlan` answers
 *        "which ones", and a boolean cannot express the second.
 * WHERE: src/lib/captions/, src/remotion/components/captions.tsx,
 *        src/services/alignment.service.ts, src/trpc/routers/captions.ts and
 *        the style gallery. Re-exported from src/lib/types.
 */

import { z } from "zod";

import { PLAN_KEYS, type PlanKey } from "@/lib/config/plans";

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_ANIMATIONS, captionAnimationSchema
 *
 * WHAT:  How the active word enters.
 * WHY:   Four, closed, and the phase's own list. They are a closed union
 *        rather than free text because the COMPONENT implements each one — an
 *        unknown animation is not a degraded look, it is a style that silently
 *        does nothing, and the renderer would have no way to tell the customer.
 * WHERE: CaptionStyle.animation; the one caption component switches on it.
 */
export const CAPTION_ANIMATIONS = ["pop", "bounce", "fade", "slide"] as const;

export const captionAnimationSchema = z.enum(CAPTION_ANIMATIONS);

export type CaptionAnimation = z.infer<typeof captionAnimationSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_CASES, captionCaseSchema
 *
 * WHAT:  What the style does to the text it was given.
 * WHY:   `asWritten` is the honest name for "do nothing", and it exists as a
 *        value rather than as an absent field so every style states its
 *        intention. The casing is applied at RENDER time and never written
 *        back into `doc.words` — the words are the script's, and a style that
 *        rewrote them would make a restyle change the data the captions are
 *        derived from. That is the whole point of WORD_RANGE_NOT_TEXT.
 * WHERE: CaptionStyle.case.
 */
export const CAPTION_CASES = ["upper", "lower", "title", "asWritten"] as const;

export const captionCaseSchema = z.enum(CAPTION_CASES);

export type CaptionCase = z.infer<typeof captionCaseSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_POSITIONS, captionPositionSchema,
 *   POSITION_IS_A_BAND
 *
 * WHAT:  Which third of the frame the caption sits in.
 * WHY:   POSITION_IS_A_BAND rather than a pixel offset, because the pixels
 *        depend on the SAFE ZONE and the safe zone depends on the platform —
 *        a caption pinned to "1600px" is under TikTok's caption bar on one
 *        export and fine on another. The band is the customer's choice; the
 *        pixels are derived from it and from `SAFE_ZONE_INSETS`, in one place.
 *
 *        The gallery's position slider moves between these three, and a
 *        caption item may still carry a finer `position.y` (see
 *        captionItemSchema) for Phase 15's manual nudge — the band is what a
 *        generator and the gallery write.
 * WHERE: CaptionStyle.position, applyCaptionStyleSchema.
 */
export const CAPTION_POSITIONS = ["top", "middle", "bottom"] as const;

export const captionPositionSchema = z.enum(CAPTION_POSITIONS);

export type CaptionPosition = z.infer<typeof captionPositionSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_FONT_KEYS, captionFontSchema,
 *   BUNDLED_FONT_ONLY
 *
 * WHAT:  The typefaces a style is allowed to ask for.
 * WHY:   See BUNDLED_FONT_ONLY in the file header. One key today, because one
 *        face is bundled. The key is not the family name: the mapping to a
 *        real family lives in src/lib/captions/fonts.ts next to the renderer
 *        that uses it, so the library can gain a face without every style
 *        object learning a font stack.
 * WHERE: CaptionStyle.font.
 */
export const CAPTION_FONT_KEYS = ["display"] as const;

export const captionFontSchema = z.enum(CAPTION_FONT_KEYS);

export type CaptionFontKey = z.infer<typeof captionFontSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_WEIGHTS, captionWeightSchema
 *
 * The two weights bundled in public/fonts. A style asking for 900 would be
 * rendered by the browser as a synthesised bold — which looks different in
 * Chrome's headless renderer and in the Player, i.e. different in the preview
 * and in the paid output. Refused at the type level instead.
 */
export const CAPTION_WEIGHTS = [400, 700] as const;

export const captionWeightSchema = z.union([z.literal(400), z.literal(700)]);

export type CaptionWeight = z.infer<typeof captionWeightSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_WORDS_PER_CHUNK_MIN,
 *   CAPTION_WORDS_PER_CHUNK_MAX, GROUPING_IS_TWO_TO_FOUR
 *
 * The phase's grouping rule, as numbers the chunker and the UI both read.
 * Fewer than two words is a flicker — a new card every third of a second —
 * and more than four does not fit a 9:16 frame at a readable size without
 * wrapping into the safe zone.
 */
export const CAPTION_WORDS_PER_CHUNK_MIN = 2;
export const CAPTION_WORDS_PER_CHUNK_MAX = 4;

export const captionWordsPerChunkSchema = z
  .number()
  .int()
  .min(CAPTION_WORDS_PER_CHUNK_MIN)
  .max(CAPTION_WORDS_PER_CHUNK_MAX);

/**
 * SOURCE OF TRUTH KEYWORDS: hexColorSchema, COLOURS_ARE_CONTENT
 *
 * WHAT:  A six-digit hex colour, uppercase or lower.
 * WHY:   Six digits, not eight: transparency belongs in the style's own
 *        opacity fields, and an alpha channel smuggled into a colour defeats
 *        the contrast check — which computes luminance and cannot know what
 *        the colour will be composited over.
 * WHERE: Every colour on CaptionStyle.
 */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour, e.g. #FFFFFF");

/**
 * SOURCE OF TRUTH KEYWORDS: CaptionStyle, captionStyleSchema, STYLES_ARE_DATA
 *
 * WHAT:  One caption look, completely described.
 *
 * WHY:   Every field here is something the ONE caption component reads. There
 *        is deliberately no escape hatch — no `css`, no `className`, no
 *        `props: Record<string, unknown>` — because the moment one exists,
 *        half the library expresses itself through it and the contrast test,
 *        the safe-zone check and the Player/Lambda equivalence all stop
 *        covering the thing that actually renders.
 *
 *        `sizeVh` is a PERCENTAGE OF FRAME HEIGHT, not a pixel size, because
 *        the same document renders at 1080x1920 in a preview proxy and at
 *        2160x3840 on a 4K export — a pixel size would make the captions half
 *        as big on the one the customer pays for.
 *
 *        `stroke` and `shadow` are not decoration. They are what makes a
 *        caption legible over footage whose brightness changes every frame,
 *        which is why the contrast rule treats the stroke as a participant
 *        rather than an embellishment (see passesContrast).
 * WHERE: src/lib/captions/styles/*.ts define them; the gallery lists them;
 *        src/remotion/components/captions.tsx renders them.
 */
export const captionStyleSchema = z
  .object({
    id: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(60),
    /** The gallery's grouping. Purely presentational. */
    family: z.string().trim().min(1).max(40),
    minPlan: z.enum(PLAN_KEYS),

    font: captionFontSchema,
    weight: captionWeightSchema,
    case: captionCaseSchema,
    /** Cap height as a percentage of FRAME HEIGHT — see the WHY above. */
    sizeVh: z.number().min(2).max(14),
    /** Letter spacing, in em. Negative tightens. */
    tracking: z.number().min(-0.1).max(0.3),
    /** Line height as a multiple of the font size. */
    lineHeight: z.number().min(0.8).max(2),

    fill: hexColorSchema,
    /** The colour of the word being spoken right now. */
    highlight: hexColorSchema,
    /** A filled box behind the active word, if the style uses one. */
    highlightBox: hexColorSchema.nullable(),
    stroke: z
      .object({
        /** As a fraction of the font size, so it scales with the frame. */
        width: z.number().min(0).max(0.25),
        color: hexColorSchema,
      })
      .strict(),
    shadow: z
      .object({
        blur: z.number().min(0).max(0.5),
        offsetY: z.number().min(-0.2).max(0.4),
        color: hexColorSchema,
        opacity: z.number().min(0).max(1),
      })
      .strict(),

    animation: captionAnimationSchema,
    maxWords: captionWordsPerChunkSchema,
    position: captionPositionSchema,
  })
  .strict();

export type CaptionStyle = z.infer<typeof captionStyleSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: SAFE_ZONE_INSETS, SafeZone, safeZoneSchema,
 *   SAFE_ZONE_IS_PER_PLATFORM
 *
 * WHAT:  How much of the frame each platform's own UI covers, as a fraction
 *        of the frame.
 *
 * WHY:   SAFE_ZONE_IS_PER_PLATFORM, which is the phase's step 8 and the thing
 *        a single "bottom margin" constant gets wrong. TikTok stacks a
 *        caption, a handle and a button rail over the bottom fifth and the
 *        right edge; Reels puts its own caption and audio row along the
 *        bottom; Shorts is lighter at the bottom and heavier at the top, where
 *        the title sits. One number for all three means captions sitting
 *        under somebody else's UI on two platforms out of three — invisible
 *        in the preview, obvious in the published video, and not fixable
 *        after the fact.
 *
 *        Fractions rather than pixels for the same reason as `sizeVh`: the
 *        same document renders at several resolutions.
 *
 *        These are measured from the platforms' own published safe areas and
 *        rounded UP. Rounding up costs a little vertical room; rounding down
 *        costs the caption.
 * WHERE: src/lib/captions/safe-zone.ts turns these into pixels; the gallery's
 *        preview draws them as a guide.
 */
export const SAFE_ZONES = ["tiktok", "reels", "shorts", "none"] as const;

export const safeZoneSchema = z.enum(SAFE_ZONES);

export type SafeZone = z.infer<typeof safeZoneSchema>;

export interface SafeZoneInsets {
  top: number;
  bottom: number;
  sides: number;
}

export const SAFE_ZONE_INSETS: Readonly<Record<SafeZone, SafeZoneInsets>> = {
  /* Caption, handle and description stack low; the button rail owns the right
   * edge, so the side inset is not symmetric in reality — it is applied to
   * both sides because a caption centred in an asymmetric box reads as
   * off-centre, which looks like a bug rather than a margin. */
  tiktok: { top: 0.08, bottom: 0.22, sides: 0.08 },
  reels: { top: 0.08, bottom: 0.2, sides: 0.07 },
  /* Shorts carries the title at the top and a lighter bottom bar. */
  shorts: { top: 0.12, bottom: 0.16, sides: 0.06 },
  /* Still not zero. A bare export is still watched on a phone, and text
   * touching the frame edge reads as a mistake on any platform. */
  none: { top: 0.05, bottom: 0.05, sides: 0.05 },
};

/**
 * SOURCE OF TRUTH KEYWORDS: ALIGNMENT_ENGINES, DEGRADED_ENGINE,
 *   alignmentEngineSchema
 *
 * WHAT:  What produced a stored alignment.
 * WHY:   `even-distribution` is a first-class engine name rather than an empty
 *        string next to `degraded: true`, because the two have to agree and
 *        one source of truth is cheaper than a constraint. A row written by
 *        the degrade path says so twice, in the flag the UI reads and in the
 *        name an operator greps.
 * WHERE: Alignment.engine.
 */
export const DEGRADED_ENGINE = "even-distribution" as const;

export const alignmentEngineSchema = z.string().trim().min(1).max(40);

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_STYLE_PAGE_SIZE, listCaptionStylesSchema
 *
 * The gallery lists the whole library — thirty-odd cards, each a few hundred
 * bytes of config — so there is no pagination and deliberately so: a style is
 * chosen by eye, and paginating a visual comparison is how a customer never
 * sees half the library. Filters narrow it instead.
 */
export const listCaptionStylesSchema = z.object({
  organizationId: z.string().min(1),
  search: z.string().trim().max(60).optional(),
  family: z.string().trim().max(40).optional(),
});

export type ListCaptionStylesValues = z.infer<typeof listCaptionStylesSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: applyCaptionStyleSchema, RESTYLING_IS_FREE
 *
 * WHAT:  The gallery's save: which style, where it sits, how many words a card
 *        holds, and whether captions are on at all.
 * WHY:   `wordsPerChunk` is OPTIONAL and falls back to the style's own
 *        `maxWords`, because the grouping is part of a style's design — a
 *        one-word-at-a-time karaoke style and a calm two-line lower third are
 *        not the same style with a different number. The control exists for
 *        the customer who wants to override it, not as a required decision.
 *
 *        RESTYLING_IS_FREE and must stay provably so: this input cannot change
 *        a word's timing, because none of these fields is a time. The
 *        re-grouping it triggers changes which words share a card, never when
 *        a word is spoken — asserted in build-track.test.ts.
 * WHERE: The gallery's save action; `captionStyles.apply`.
 */
export const applyCaptionStyleSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  styleId: z.string().trim().min(1).max(60),
  position: captionPositionSchema.optional(),
  wordsPerChunk: captionWordsPerChunkSchema.optional(),
  enabled: z.boolean(),
});

export type ApplyCaptionStyleValues = z.infer<typeof applyCaptionStyleSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: alignProjectSchema, ALIGNMENT_IS_PAID_WORK
 *
 * WHAT:  Start (or re-start) an alignment for a project.
 * WHY:   `force` is the operator's and the customer's escape from a cache hit.
 *        It exists because the cache is keyed on the AUDIO, and the one case
 *        the key cannot see is a DEGRADED row: the audio did not change, so
 *        the hash matches, so a retry after the provider recovers would be
 *        skipped forever. The workflow re-aligns a degraded row without
 *        `force` for exactly that reason, and `force` covers the rest.
 * WHERE: The captions panel's "Re-align" action.
 */
export const alignProjectSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  force: z.boolean().optional(),
});

export type AlignProjectValues = z.infer<typeof alignProjectSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: captionSettingsSchema, CaptionSettings,
 *   CAPTION_SETTINGS_LIVE_ON_THE_PROJECT, DEFAULT_CAPTION_SETTINGS
 *
 * WHAT:  A project's caption choice, as it is stored on `Project.settings`.
 *
 * WHY:   CAPTION_SETTINGS_LIVE_ON_THE_PROJECT, not only in the timeline
 *        document, and the duplication is the point. The document is the
 *        RENDER's input and it does not exist until the generate pipeline
 *        builds one (Phase 09) — so a gallery that could only write into a
 *        document would be unusable on every project until then, and would
 *        lose the customer's choice every time a document was rebuilt from
 *        the script. The project row is where the INTENT lives; the document
 *        is where it is realised. `applyCaptionsToTimeline` keeps the second
 *        in step with the first whenever a document exists.
 *
 *        Parsed with `.catch()` on read rather than trusted: `settings` is
 *        jsonb written by several phases, and a caption block that is absent,
 *        half-written or from an older release has to resolve to the default
 *        rather than break the screen that would let somebody fix it.
 * WHERE: `Project.settings.captions`; read by the captions router and by the
 *        generate pipeline.
 */
export const captionSettingsSchema = z.object({
  styleId: z.string().trim().min(1).max(60),
  position: captionPositionSchema,
  wordsPerChunk: captionWordsPerChunkSchema,
  enabled: z.boolean(),
});

export type CaptionSettings = z.infer<typeof captionSettingsSchema>;

export const getCaptionsSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});

export type GetCaptionsValues = z.infer<typeof getCaptionsSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: captionStyleAvailableOnPlan, PREMIUM_IS_A_STYLE_TIER,
 *   LOCKED_NOT_HIDDEN
 *
 * WHAT:  Whether a plan may apply a given style.
 * WHY:   Compares POSITION in the plan ladder rather than equality, so a Pro
 *        workspace gets every Starter style without each one listing the plans
 *        above it. The same function as `voiceAvailableOnPlan`, kept separate
 *        rather than generalised: they are two different ladders' worth of
 *        meaning that happen to share an implementation today, and merging
 *        them would couple the voice catalogue's gating to the caption
 *        library's.
 * WHERE: `captionStyles.list` (the lock badge) and `.apply` (the boundary).
 */
export function captionStyleAvailableOnPlan(
  minPlan: PlanKey,
  plan: PlanKey,
): boolean {
  return PLAN_KEYS.indexOf(plan) >= PLAN_KEYS.indexOf(minPlan);
}
