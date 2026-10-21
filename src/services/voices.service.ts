/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: listVoices, findVoice, upsertCatalogueVoice,
 *   deactivateMissingVoices, listSpeakers, upsertSpeakers, assignSpeakerVoice,
 *   validateAssignments, SHARED_CATALOGUE, TENANT_SCOPED_QUERY,
 *   ASSIGNMENT_BLOCKS_GENERATION, DbClient
 *
 * WHAT:  The reads and writes of the shared `voice` catalogue and of each
 *        project's `speaker` cast.
 *
 * WHY:   SHARED_CATALOGUE. `Voice` rows have NO `organizationId` — they are
 *        the operator's licensed library, read by every workspace, exactly
 *        like library Assets. So the catalogue reads here take no tenancy
 *        filter, and that is correct rather than an omission. What IS
 *        per-tenant is which of them a plan may use, and that is a `minPlan`
 *        comparison rather than a WHERE clause.
 *
 *        TENANT_SCOPED_QUERY still applies to everything else: `Speaker` rows
 *        belong to a workspace, so every speaker function takes an
 *        `organizationId` and puts it in the WHERE clause even when it also
 *        has a primary key. The procedure factory proves the CALLER belongs to
 *        the org they named; it says nothing about the row.
 *
 *        ASSIGNMENT_BLOCKS_GENERATION is the rule this file exists to make
 *        enforceable. A project with an unassigned speaker must REFUSE to
 *        generate rather than fall back to a default voice — a video narrated
 *        by somebody the customer did not choose is worse than one that did
 *        not start. `validateAssignments` returns the names so the UI can say
 *        which, which is the phase's own requirement: a disabled button with
 *        the speakers listed, not a generic error.
 * WHERE: src/trpc/routers/voices.ts and the TTS workflow.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma";
import { type DbClient } from "@/lib/config/prisma";
import type { PlanKey } from "@/lib/config/plans";
import {
  voiceAvailableOnPlan,
  type VoiceAccent,
  type VoiceGender,
  type VoiceTone,
} from "@/lib/types/voice";

/**
 * SOURCE OF TRUTH KEYWORDS: VOICE_SELECT, VoiceRow
 *
 * WHAT:  The columns the picker renders.
 * WHY:   `providerVoiceId` is deliberately EXCLUDED from the client payload.
 *        It is the id the synthesis endpoint takes, and a browser has no use
 *        for it — shipping it would put the operator's licensed catalogue
 *        mapping in a page bundle for anyone to read.
 * WHERE: listVoices; the voice picker.
 */
export const VOICE_SELECT = {
  id: true,
  name: true,
  gender: true,
  accent: true,
  tone: true,
  minPlan: true,
  previewAssetId: true,
} as const satisfies Prisma.VoiceSelect;

export type VoiceRow = Prisma.VoiceGetPayload<{ select: typeof VOICE_SELECT }>;

export interface VoiceListFilters {
  search?: string | undefined;
  gender?: VoiceGender | undefined;
  accent?: VoiceAccent | undefined;
  tone?: VoiceTone | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: listVoices, LOCKED_NOT_HIDDEN
 *
 * WHAT:  The catalogue a workspace can see, newest-irrelevant, ordered by name.
 *
 * WHY:   LOCKED_NOT_HIDDEN — the plan is NOT a filter here. Every active voice
 *        comes back and the caller marks the ones out of reach, because a
 *        voice a customer never sees is one they have no reason to pay for.
 *        Filtering by plan in SQL is the obvious implementation and it quietly
 *        removes the entire upsell.
 *
 *        `isActive` IS a filter, and it is a different thing: a deactivated
 *        voice is one the operator no longer licenses, so showing it would
 *        offer something that cannot legally be used at any price.
 *
 *        Ordered by name because the picker is browsed, not paged — forty
 *        voices in a searchable grid, where a stable alphabetical order is
 *        what lets somebody find the one they used last time.
 * WHERE: `voices.list`.
 */
export async function listVoices(
  db: DbClient,
  filters: VoiceListFilters = {},
): Promise<VoiceRow[]> {
  const where: Prisma.VoiceWhereInput = {
    isActive: true,
    ...(filters.gender !== undefined ? { gender: filters.gender } : {}),
    ...(filters.accent !== undefined ? { accent: filters.accent } : {}),
    ...(filters.tone !== undefined ? { tone: filters.tone } : {}),
    ...(filters.search !== undefined && filters.search.length > 0
      ? { name: { contains: filters.search, mode: "insensitive" } }
      : {}),
  };

  return db.voice.findMany({
    where,
    select: VOICE_SELECT,
    orderBy: { name: "asc" },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: findVoice, findVoiceForSynthesis
 *
 * WHAT:  One catalogue voice.
 * WHY:   Two functions rather than one with a flag, because they return
 *        different things on purpose: the picker's version omits
 *        `providerVoiceId` (see VOICE_SELECT), and only the synthesis path —
 *        which runs server-side in a workflow — is allowed to see it.
 * WHERE: `voices.preview` and the assignment check.
 */
export async function findVoice(
  db: DbClient,
  id: string,
): Promise<VoiceRow | null> {
  return db.voice.findFirst({
    where: { id, isActive: true },
    select: VOICE_SELECT,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: findVoiceForSynthesis, PROVIDER_ID_STAYS_SERVER_SIDE
 *
 * WHAT:  A voice including the id the provider needs.
 * WHY:   PROVIDER_ID_STAYS_SERVER_SIDE. Separated from `findVoice` so the
 *        provider mapping cannot leak into a client payload by somebody
 *        widening a select. Grep this symbol — every caller should be a
 *        workflow step.
 * WHERE: The TTS workflow only.
 */
export async function findVoiceForSynthesis(
  db: DbClient,
  id: string,
): Promise<{
  id: string;
  providerVoiceId: string;
  provider: string;
  minPlan: string;
} | null> {
  return db.voice.findFirst({
    where: { id, isActive: true },
    select: {
      id: true,
      providerVoiceId: true,
      provider: true,
      minPlan: true,
    },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: upsertCatalogueVoice, CATALOGUE_SYNC,
 *   SYNC_PRESERVES_OPERATOR_EDITS
 *
 * WHAT:  Writes one provider voice into the catalogue.
 *
 * WHY:   SYNC_PRESERVES_OPERATOR_EDITS, and this is the decision that makes a
 *        re-runnable sync safe. The provider owns the NAME and the voice id;
 *        the OPERATOR owns `minPlan` and `isActive`. So an update writes the
 *        provider's fields and leaves the operator's alone — otherwise every
 *        sync would reset a carefully tiered catalogue back to `free`, and the
 *        second sync would silently give away every premium voice.
 *
 *        The descriptive axes are only written on CREATE for the same reason:
 *        they are mapped from fuzzy provider labels, so an operator who
 *        corrected a mislabelled accent must not have it overwritten the next
 *        time somebody presses sync.
 *
 *        Upserts on `(provider, providerVoiceId)` — the unique pair — so
 *        re-running updates rather than duplicating.
 * WHERE: `voices.sync`.
 */
export async function upsertCatalogueVoice(
  db: DbClient,
  data: {
    provider: string;
    providerVoiceId: string;
    name: string;
    gender: VoiceGender;
    accent: VoiceAccent;
    tone: VoiceTone;
    minPlan: PlanKey;
    previewAssetId?: string | null;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await db.voice.findUnique({
    where: {
      provider_providerVoiceId: {
        provider: data.provider,
        providerVoiceId: data.providerVoiceId,
      },
    },
    select: { id: true },
  });

  if (existing !== null) {
    await db.voice.update({
      where: { id: existing.id },
      data: {
        /* Provider-owned only. `minPlan`, `isActive` and the descriptive axes
         * are the operator's — see SYNC_PRESERVES_OPERATOR_EDITS. */
        name: data.name,
        ...(data.previewAssetId !== undefined && data.previewAssetId !== null
          ? { previewAssetId: data.previewAssetId }
          : {}),
      },
    });
    return { id: existing.id, created: false };
  }

  const created = await db.voice.create({
    data: {
      provider: data.provider,
      providerVoiceId: data.providerVoiceId,
      name: data.name,
      gender: data.gender,
      accent: data.accent,
      tone: data.tone,
      minPlan: data.minPlan,
      ...(data.previewAssetId != null
        ? { previewAssetId: data.previewAssetId }
        : {}),
    },
    select: { id: true },
  });

  return { id: created.id, created: true };
}

/**
 * SOURCE OF TRUTH KEYWORDS: deactivateMissingVoices, DEACTIVATE_NEVER_DELETE
 *
 * WHAT:  Marks voices inactive when the provider no longer lists them.
 *
 * WHY:   DEACTIVATE_NEVER_DELETE. A voice that disappears from the provider's
 *        library is still REFERENCED — by speakers that have it assigned, by
 *        narration lines already synthesised with it, and by the `textHash`
 *        of every one of those lines. Deleting the row would orphan all of
 *        that and, worse, would change what those hashes mean: the next
 *        generation would miss the cache and re-synthesise audio that already
 *        exists, in a voice that no longer does.
 *
 *        Deactivating hides it from the picker while leaving every existing
 *        assignment intact and playable. A customer whose chosen voice was
 *        withdrawn keeps their finished videos and is only stopped from
 *        picking it again.
 * WHERE: The end of `voices.sync`.
 */
export async function deactivateMissingVoices(
  db: DbClient,
  provider: string,
  seenProviderVoiceIds: readonly string[],
): Promise<number> {
  const result = await db.voice.updateMany({
    where: {
      provider,
      isActive: true,
      providerVoiceId: { notIn: [...seenProviderVoiceIds] },
    },
    data: { isActive: false },
  });
  return result.count;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SPEAKER_SELECT, SpeakerRow
 *
 * WHAT:  A project's cast as the assignment panel renders it.
 * WHERE: listSpeakers.
 */
export const SPEAKER_SELECT = {
  id: true,
  projectId: true,
  tag: true,
  voiceId: true,
  state: true,
} as const satisfies Prisma.SpeakerSelect;

export type SpeakerRow = Prisma.SpeakerGetPayload<{
  select: typeof SPEAKER_SELECT;
}>;

export async function listSpeakers(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<SpeakerRow[]> {
  return db.speaker.findMany({
    where: { organizationId, projectId },
    select: SPEAKER_SELECT,
    orderBy: { tag: "asc" },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: upsertSpeakers, SPEAKERS_FOLLOW_THE_SCRIPT,
 *   ASSIGNMENT_SURVIVES_REGENERATION
 *
 * WHAT:  Makes sure a speaker row exists for every tag the script uses.
 *
 * WHY:   SPEAKERS_FOLLOW_THE_SCRIPT. The tags come from `ScriptBlock.speakerTag`
 *        — the script decides who speaks, and this only ensures each of them
 *        is castable. It is called after every generation, because a rewrite
 *        can introduce a tag that did not exist before.
 *
 *        ASSIGNMENT_SURVIVES_REGENERATION is why this upserts rather than
 *        replacing. Regenerating a script must NOT clear the cast: the
 *        customer picked those voices, the tags usually stay the same, and
 *        wiping them would mean re-casting after every edit — and, worse,
 *        would invalidate every `textHash` and re-synthesise the entire
 *        narration at full price.
 *
 *        Tags that have DISAPPEARED from the script are left alone rather than
 *        deleted. They cost one row, they are invisible in the panel once
 *        nothing references them, and keeping them means a tag that comes back
 *        (an edit undone) still has its voice.
 * WHERE: After `scripts.generate`, and before the TTS fan-out.
 */
export async function upsertSpeakers(
  db: DbClient,
  args: { organizationId: string; projectId: string; tags: readonly string[] },
): Promise<SpeakerRow[]> {
  const unique = [...new Set(args.tags.map((tag) => tag.trim()).filter(Boolean))];

  for (const tag of unique) {
    await db.speaker.upsert({
      where: { projectId_tag: { projectId: args.projectId, tag } },
      /* Nothing to change on an existing row — the whole point is that the
       * assignment survives. */
      update: {},
      create: {
        organizationId: args.organizationId,
        projectId: args.projectId,
        tag,
      },
    });
  }

  return listSpeakers(db, args.organizationId, args.projectId);
}

/**
 * SOURCE OF TRUTH KEYWORDS: assignSpeakerVoice, ASSIGNMENT_SETS_STATE
 *
 * WHAT:  Gives a speaker a voice and marks it ready.
 * WHY:   ASSIGNMENT_SETS_STATE — `state` moves to `ready` in the SAME write as
 *        `voiceId`, so the two can never disagree. A separate "mark ready"
 *        call is a second chance to leave a speaker with a voice and an
 *        `unassigned` state, which would block generation for a cast that is
 *        actually complete.
 *
 *        Scoped by `organizationId` as well as id, so a guessed speaker id
 *        from another workspace matches nothing.
 * WHERE: `voices.assign`.
 */
export async function assignSpeakerVoice(
  db: DbClient,
  organizationId: string,
  speakerId: string,
  voiceId: string,
): Promise<number> {
  const result = await db.speaker.updateMany({
    where: { id: speakerId, organizationId },
    data: { voiceId, state: "ready" },
  });
  return result.count;
}

/**
 * SOURCE OF TRUTH KEYWORDS: validateAssignments, ASSIGNMENT_BLOCKS_GENERATION,
 *   NAME_THE_UNASSIGNED
 *
 * WHAT:  Whether a project's cast is complete, and which speakers are missing.
 *
 * WHY:   ASSIGNMENT_BLOCKS_GENERATION. A project with an unassigned speaker is
 *        refused rather than narrated in a default voice. The phase is
 *        explicit and the reason is product rather than technical: a video in
 *        a voice the customer did not choose is worse than one that did not
 *        start, because they only find out after it is made.
 *
 *        NAME_THE_UNASSIGNED — it returns the TAGS, not just a boolean, so the
 *        UI can say "Assign a voice to OP and A" instead of "something is
 *        wrong". The phase asks for exactly that: a disabled button with the
 *        speakers named.
 *
 *        A project with NO speakers at all is `ok: false` with an empty list,
 *        which is a third state worth distinguishing — it means the script has
 *        not been split yet, so the right UI is "generate a script first"
 *        rather than "assign a voice". The caller branches on
 *        `unassigned.length`.
 *
 *        It also re-checks that each assigned voice still EXISTS and is
 *        active, because a voice the operator withdrew leaves a speaker
 *        pointing at a row the picker no longer offers
 *        (DEACTIVATE_NEVER_DELETE). Without this, generation would reach the
 *        provider with a dead voice id and fail per line.
 * WHERE: The TTS workflow's gate, and the generate button's enabled state.
 */
export async function validateAssignments(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<{ ok: boolean; unassigned: string[]; hasSpeakers: boolean }> {
  const speakers = await db.speaker.findMany({
    where: { organizationId, projectId },
    select: { tag: true, voiceId: true },
    orderBy: { tag: "asc" },
  });

  if (speakers.length === 0) {
    return { ok: false, unassigned: [], hasSpeakers: false };
  }

  const assignedVoiceIds = speakers
    .map((speaker) => speaker.voiceId)
    .filter((id): id is string => id !== null);

  /* One query for every assigned voice, rather than one per speaker — a cast
   * is small, but this runs on the generate button's enabled state. */
  const liveVoices =
    assignedVoiceIds.length === 0
      ? []
      : await db.voice.findMany({
          where: { id: { in: assignedVoiceIds }, isActive: true },
          select: { id: true },
        });
  const live = new Set(liveVoices.map((voice) => voice.id));

  const unassigned = speakers
    .filter(
      (speaker) => speaker.voiceId === null || !live.has(speaker.voiceId),
    )
    .map((speaker) => speaker.tag);

  return { ok: unassigned.length === 0, unassigned, hasSpeakers: true };
}

/**
 * SOURCE OF TRUTH KEYWORDS: assertVoiceAllowedOnPlan, LOCKED_NOT_HIDDEN
 *
 * WHAT:  Whether this plan may ASSIGN this voice.
 * WHY:   The server half of the lock badge. The picker disables what a plan
 *        cannot use, and this is the boundary — a disabled control stops a
 *        mistake, not a request. Grep LOCKED_NOT_HIDDEN for the other half.
 *
 *        Takes the voice's `minPlan` rather than the voice, so the caller can
 *        check before or after loading the row and the rule stays one
 *        comparison in one place.
 * WHERE: `voices.assign`, and re-checked in the TTS workflow.
 */
export function assertVoiceAllowedOnPlan(
  minPlan: string,
  plan: PlanKey,
): boolean {
  return voiceAvailableOnPlan(minPlan, plan);
}
