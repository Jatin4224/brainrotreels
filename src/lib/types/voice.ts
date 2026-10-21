/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: VOICE_GENDERS, VOICE_ACCENTS, VOICE_TONES,
 *   NARRATION_STATUSES, narrationStatusSchema, SPEAKER_STATES,
 *   voiceFilterSchema, assignVoiceSchema, listVoicesSchema,
 *   TEXT_HASH_COVERS_THE_VOICE, PREMIUM_IS_A_MIN_PLAN, NO_VOICE_CLONING
 *
 * WHAT:  The vocabulary of the voice catalogue and of narration — what a voice
 *        can be described as, what state a line can be in, and the input
 *        schema of every `voices.*` and `speakers.*` procedure.
 *
 * WHY:   PREMIUM_IS_A_MIN_PLAN. A voice is gated by `minPlan`, a PlanKey, not
 *        by a boolean `premium` flag. A boolean cannot express "available from
 *        Pro upward" alongside "available from Starter upward", and the first
 *        time a third tier of voices is wanted it has to be migrated anyway.
 *        The registry's `premiumVoices` FLAG is a different thing and both
 *        exist on purpose: the flag answers "may this workspace use gated
 *        voices at all" for the UI's lock badge, and `minPlan` answers "which
 *        ones" — see voiceAvailableOnPlan below.
 *
 *        NO_VOICE_CLONING. Nothing in this module describes a cloned voice,
 *        and nothing should ever be added that does. The phase states it as a
 *        legal position rather than a preference: no clones of real people or
 *        third-party characters, ever. `providerVoiceId` points at a LICENSED
 *        catalogue entry.
 *
 *        The descriptive axes are closed enums rather than free text because
 *        they drive a FILTER UI. A free-text accent field produces "British",
 *        "british", "UK" and "English (UK)" as four different filter options
 *        within a month of a catalogue sync, and the picker becomes unusable
 *        exactly as the catalogue becomes useful.
 * WHERE: src/lib/narration/, src/services/voices.service.ts,
 *        src/trpc/routers/voices.ts and the voice picker.
 *        Re-exported from src/lib/types.
 */

import { z } from "zod";

import { PLAN_KEYS, type PlanKey } from "@/lib/config/plans";

/**
 * SOURCE OF TRUTH KEYWORDS: VOICE_GENDERS, voiceGenderSchema
 *
 * WHAT:  How a voice presents.
 * WHY:   `neutral` is a real catalogue category, not a hedge — several library
 *        voices are deliberately androgynous and a customer filtering for one
 *        is filtering for a sound, not making a statement. Three values
 *        because that is what the catalogue actually distinguishes; a
 *        free-text field here would be both unfilterable and an invitation to
 *        write something about a person.
 * WHERE: Voice.gender; the picker's filters.
 */
export const VOICE_GENDERS = ["female", "male", "neutral"] as const;

export const voiceGenderSchema = z.enum(VOICE_GENDERS);

export type VoiceGender = z.infer<typeof voiceGenderSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: VOICE_ACCENTS, voiceAccentSchema
 *
 * WHAT:  Where a voice sounds like it is from.
 * WHY:   Coarse on purpose. The catalogue's own labels are far more specific
 *        ("Received Pronunciation", "General American", "Estuary"), and
 *        surfacing that specificity would give the picker thirty filter
 *        options for forty voices — at which point filtering stops narrowing
 *        anything. The sync maps provider labels onto these; `other` is the
 *        honest bucket for anything that does not fit, rather than forcing a
 *        wrong one.
 * WHERE: Voice.accent; the picker's filters.
 */
export const VOICE_ACCENTS = [
  "american",
  "british",
  "australian",
  "irish",
  "indian",
  "african",
  "european",
  "other",
] as const;

export const voiceAccentSchema = z.enum(VOICE_ACCENTS);

export type VoiceAccent = z.infer<typeof voiceAccentSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: VOICE_TONES, voiceToneSchema
 *
 * WHAT:  What a voice sounds like doing.
 * WHY:   These map onto the SCRIPT_TONES a script is written in, which is what
 *        makes an automatic suggestion possible later — a `dramatic` script
 *        wants a `dramatic` or `deep` voice, not a `warm` one. They are not
 *        identical sets, because a script's tone is about the words and a
 *        voice's is about the delivery.
 * WHERE: Voice.tone; the picker's filters.
 */
export const VOICE_TONES = [
  "warm",
  "energetic",
  "calm",
  "authoritative",
  "dramatic",
  "conversational",
] as const;

export const voiceToneSchema = z.enum(VOICE_TONES);

export type VoiceTone = z.infer<typeof voiceToneSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: voiceAvailableOnPlan, PREMIUM_IS_A_MIN_PLAN,
 *   LOCKED_NOT_HIDDEN
 *
 * WHAT:  Whether a plan may use a given voice.
 * WHY:   Compares POSITION in the plan ladder, not equality, so a Pro
 *        workspace gets every Starter voice without the catalogue listing each
 *        voice against every plan that includes it.
 *
 *        LOCKED_NOT_HIDDEN, the same rule as the render panel's resolutions:
 *        the picker renders every voice and locks the ones out of reach,
 *        because a voice a customer never hears is one they have no reason to
 *        pay for. The phase is explicit — previews are deliberately NOT gated
 *        and cost no credits, since hearing what you cannot yet use is the
 *        upsell.
 * WHERE: The picker's lock badge, and re-checked server-side on assignment.
 */
export function voiceAvailableOnPlan(minPlan: string, plan: PlanKey): boolean {
  const required = PLAN_KEYS.indexOf(minPlan as PlanKey);
  const actual = PLAN_KEYS.indexOf(plan);
  /* An unrecognised minPlan is treated as unavailable rather than free: a
   * catalogue row written by a future release with a plan this build does not
   * know about must not be handed out for nothing. */
  if (required < 0 || actual < 0) return false;
  return actual >= required;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SPEAKER_STATES, speakerStateSchema
 *
 * WHAT:  Whether a speaker is ready to be synthesised.
 * WHY:   Two states, and the reason there are only two is that the question
 *        this column answers is binary: can generation proceed. A speaker with
 *        no voice BLOCKS generation (see validateAssignments) rather than
 *        falling back to a default, because a video narrated in a voice the
 *        customer did not choose is worse than one that refused to start.
 * WHERE: Speaker.state.
 */
export const SPEAKER_STATES = ["unassigned", "ready"] as const;

export const speakerStateSchema = z.enum(SPEAKER_STATES);

export type SpeakerState = z.infer<typeof speakerStateSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: NARRATION_STATUSES, narrationStatusSchema,
 *   NarrationStatus
 *
 * WHAT:  The synthesis lifecycle of one line.
 * WHY:   `pending` is the DEFAULT and is load-bearing: a line exists the
 *        moment the script is split, before any provider has been called, so
 *        the honest initial state is "not yet recorded". Only the TTS workflow
 *        moves a line to `ready` or `failed`, and nothing may assemble
 *        narration from a line that is not `ready`.
 *
 *        `failed` is per LINE rather than per project, because one line
 *        failing is recoverable — the phase's whole caching design exists so
 *        that re-running synthesises only what is missing.
 * WHERE: NarrationLine.status.
 */
export const NARRATION_STATUSES = [
  "pending",
  "synthesizing",
  "ready",
  "failed",
] as const;

export const narrationStatusSchema = z.enum(NARRATION_STATUSES);

export type NarrationStatus = z.infer<typeof narrationStatusSchema>;

/** No further transition is possible from these. */
export const NARRATION_TERMINAL_STATUSES: readonly NarrationStatus[] = [
  "ready",
  "failed",
];

export function isTerminalNarrationStatus(status: string): boolean {
  return (NARRATION_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * SOURCE OF TRUTH KEYWORDS: LINE_MAX_CHARS, LINE_MIN_CHARS,
 *   SPLIT_LONG_BLOCKS
 *
 * WHAT:  How long one synthesised line may be.
 *
 * WHY:   SPLIT_LONG_BLOCKS. A line is the unit of RE-SYNTHESIS, so its length
 *        decides what a one-word edit costs. A whole 400-character block
 *        re-recorded because somebody fixed a typo in its last sentence is
 *        both a provider call and a noticeably different take of everything
 *        before the typo — the delivery drifts, and the customer hears the
 *        seam.
 *
 *        The cap is generous rather than tight because splitting too
 *        aggressively has its own cost: a sentence split mid-clause is
 *        synthesised with the wrong intonation at the break, and stitching
 *        those together sounds worse than one long take.
 *
 *        `LINE_MIN_CHARS` stops a stray "Yes." becoming its own provider call
 *        — below it, a fragment is kept with its neighbour.
 * WHERE: splitBlockIntoLines in src/lib/narration/split.ts.
 */
export const LINE_MAX_CHARS = 280;

export const LINE_MIN_CHARS = 24;

/**
 * SOURCE OF TRUTH KEYWORDS: listVoicesSchema, voiceFilterSchema,
 *   VOICE_FILTER_ALL
 *
 * WHAT:  The picker's filter state and the list input.
 * WHY:   `VOICE_FILTER_ALL` is a client-only sentinel that is NORMALISED AWAY
 *        before the request — the same pattern as the projects and media
 *        filters, so the wire carries an absent field rather than the string
 *        "all", and the server never has to know what the UI called "no
 *        filter".
 * WHERE: The voice picker.
 */
export const VOICE_FILTER_ALL = "all";

export const listVoicesSchema = z.object({
  organizationId: z.string().min(1),
  search: z.string().trim().max(100).optional(),
  gender: voiceGenderSchema.optional(),
  accent: voiceAccentSchema.optional(),
  tone: voiceToneSchema.optional(),
});

export type ListVoicesValues = z.infer<typeof listVoicesSchema>;

export const voiceFilterSchema = z.object({
  search: z.string().trim().max(100),
  gender: z.union([voiceGenderSchema, z.literal(VOICE_FILTER_ALL)]),
  accent: z.union([voiceAccentSchema, z.literal(VOICE_FILTER_ALL)]),
  tone: z.union([voiceToneSchema, z.literal(VOICE_FILTER_ALL)]),
});

export type VoiceFilterValues = z.infer<typeof voiceFilterSchema>;

export const VOICE_FILTER_DEFAULTS: VoiceFilterValues = {
  search: "",
  gender: VOICE_FILTER_ALL,
  accent: VOICE_FILTER_ALL,
  tone: VOICE_FILTER_ALL,
};

/**
 * SOURCE OF TRUTH KEYWORDS: normalizeVoiceFilters, CLIENT_SERVER_MIRROR
 *
 * WHAT:  Turns picker state into list input, dropping the sentinels.
 * WHY:   One function so the sentinel can never reach the wire — the same
 *        reason `normalizeProjectFilters` exists. A server that had to know
 *        about "all" would be a server that knows about the UI.
 * WHERE: The voice picker, before every query.
 */
export function normalizeVoiceFilters(
  organizationId: string,
  filters: VoiceFilterValues,
): ListVoicesValues {
  const search = filters.search.trim();
  return {
    organizationId,
    ...(search.length > 0 ? { search } : {}),
    ...(filters.gender !== VOICE_FILTER_ALL ? { gender: filters.gender } : {}),
    ...(filters.accent !== VOICE_FILTER_ALL ? { accent: filters.accent } : {}),
    ...(filters.tone !== VOICE_FILTER_ALL ? { tone: filters.tone } : {}),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: assignVoiceSchema, listSpeakersSchema,
 *   syncVoicesSchema, previewVoiceSchema
 *
 * WHAT:  The input contract of every `voices.*` and `speakers.*` procedure.
 * WHY:   `assignVoice` takes a speaker ID and a voice ID and nothing else —
 *        notably NOT the plan, which the server resolves. A client that could
 *        assert its own plan could assign a premium voice on a free workspace,
 *        and the lock badge would be the only thing standing in the way.
 * WHERE: src/trpc/routers/voices.ts.
 */
export const listSpeakersSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});

export const assignVoiceSchema = z.object({
  organizationId: z.string().min(1),
  speakerId: z.string().min(1),
  voiceId: z.string().min(1),
});

export type AssignVoiceValues = z.infer<typeof assignVoiceSchema>;

export const previewVoiceSchema = z.object({
  organizationId: z.string().min(1),
  voiceId: z.string().min(1),
});

/**
 * SOURCE OF TRUTH KEYWORDS: syncVoicesSchema, PORTAL_ONLY_SYNC
 *
 * WHAT:  Input for the operator's catalogue sync.
 * WHY:   PORTAL_ONLY_SYNC. The sync pulls the operator's licensed library from
 *        the provider and upserts the shared catalogue — it is not a tenant
 *        action and is gated to the portal workspace. `dryRun` exists because
 *        the first thing anybody wants from a sync against a live catalogue is
 *        to see what it WOULD do.
 * WHERE: The portal's Voices screen.
 */
export const syncVoicesSchema = z.object({
  organizationId: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export type SyncVoicesValues = z.infer<typeof syncVoicesSchema>;
