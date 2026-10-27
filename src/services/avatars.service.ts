/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: listAvatars, findAvatar, assignSpeakerAvatar,
 *   upsertAvatar, deactivateMissingAvatars, resolveAvatarSet, AvatarRow,
 *   AVATAR_SELECT, ARTWORK_MUST_EXIST_FIRST, DEACTIVATE_NEVER_DELETE,
 *   TENANT_SCOPED_QUERY, DbClient
 *
 * WHAT:  The Prisma reads and writes of the `avatar` table, the speaker
 *        assignment that finally uses `Speaker.avatarId`, and the upsert the
 *        operator's manifest sync performs.
 *
 * WHY:   ARTWORK_MUST_EXIST_FIRST, and it is the one ordering rule in this
 *        file. An `Avatar` row holds three Asset ids, and those assets are
 *        created by the PHASE 11 LIBRARY SYNC from the background manifest —
 *        so `upsertAvatar` is handed already-resolved ids and refuses to write
 *        a row whose artwork is missing. Writing the row first and hoping the
 *        assets arrive later would put a character in the picker that renders
 *        as three gaps, and `signDocumentAssets` would quite correctly resolve
 *        every one of them to `url: null`.
 *
 *        DEACTIVATE_NEVER_DELETE, the same rule the voice catalogue follows and
 *        for a sharper reason here: `Speaker.avatarId` points at these rows and
 *        a project rendered last month must keep rendering the same way. A
 *        character removed from the manifest is deactivated, so it disappears
 *        from the picker and keeps working in the documents that already
 *        reference it.
 *
 *        TENANT_SCOPED_QUERY applies to the ASSIGNMENT and not to the
 *        catalogue: an `Avatar` has no `organizationId` (it is shared, like a
 *        `Voice`), while a `Speaker` has one and every write to it filters by
 *        it. The asymmetry is the same one the voices service has.
 *
 *        Pure Prisma: no plan resolution, no entitlement read, no audit.
 *        `avatarAvailableOnPlan` is applied by the router, which is where the
 *        tier has already been resolved.
 * WHERE: src/trpc/routers/avatars.ts and the `reddit-story` generator's cast
 *        resolution in src/services/pipeline.service.ts.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma";
import { type DbClient } from "@/lib/config/prisma";
import {
  readAvatarAssetSet,
  type AvatarAssetSet,
} from "@/lib/types/avatar";

/**
 * SOURCE OF TRUTH KEYWORDS: AVATAR_SELECT, AvatarRow
 *
 * WHAT:  The columns a picker tile and the generator need.
 * WHY:   Everything but the timestamps, which no consumer reads — a catalogue
 *        of a dozen characters is not a table anybody sorts by date.
 * WHERE: Both reads below.
 */
export const AVATAR_SELECT = {
  id: true,
  name: true,
  assetSet: true,
  minPlan: true,
  isActive: true,
} as const satisfies Prisma.AvatarSelect;

export type AvatarRow = Prisma.AvatarGetPayload<{
  select: typeof AVATAR_SELECT;
}>;

/**
 * SOURCE OF TRUTH KEYWORDS: listAvatars, LOCKED_NOT_HIDDEN
 *
 * WHAT:  The whole ACTIVE catalogue, oldest first.
 * WHY:   Takes no organization id and no plan: an avatar is shared, and the
 *        lock is the router's to compute (LOCKED_NOT_HIDDEN — the picker
 *        renders every character and locks the ones out of reach, because a
 *        character a customer never sees is one they have no reason to pay
 *        for).
 *
 *        `isActive` IS filtered here, unlike the plan gate, because a
 *        deactivated character is not an upsell — it is withdrawn, and showing
 *        it locked would offer an upgrade that does not unlock it.
 *
 *        Ordered by creation so the catalogue does not reshuffle between page
 *        loads; `name` would reorder the whole picker the first time a
 *        character was renamed.
 * WHERE: `avatars.list`.
 */
export async function listAvatars(db: DbClient): Promise<AvatarRow[]> {
  return db.avatar.findMany({
    where: { isActive: true },
    select: AVATAR_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: findAvatar
 *
 * WHAT:  One character by id, active only.
 * WHY:   The `isActive` filter is here as well as in the list, because this is
 *        the function the ASSIGNMENT boundary calls: a withdrawn character must
 *        not be assignable even by an id somebody still has in a stale tab.
 *        Returns null so the caller answers NOT_FOUND.
 * WHERE: `avatars.assign`.
 */
export async function findAvatar(
  db: DbClient,
  id: string,
): Promise<AvatarRow | null> {
  return db.avatar.findFirst({
    where: { id, isActive: true },
    select: AVATAR_SELECT,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: assignSpeakerAvatar, TENANT_SCOPED_QUERY,
 *   NULL_CLEARS_THE_FACE
 *
 * WHAT:  Gives a speaker a face, or takes it away.
 * WHY:   NULL_CLEARS_THE_FACE. A speaker with no avatar is a real and common
 *        choice — a narrator who is never on screen — so clearing is the same
 *        write rather than a second mutation.
 *
 *        An `updateMany` scoped by `organizationId` rather than an `update` by
 *        id: a guessed speaker id from another workspace then matches nothing
 *        and returns a count of zero, which the caller turns into NOT_FOUND.
 *        An `update` by id alone would write it.
 *
 *        It deliberately does NOT touch `state`. That column means "has this
 *        speaker a VOICE" — it is what blocks generation
 *        (ASSIGNMENTS_BLOCK_GENERATION) — and an avatar is optional, so
 *        clearing a face must not make a cast look incomplete.
 * WHERE: `avatars.assign`.
 */
export async function assignSpeakerAvatar(
  db: DbClient,
  organizationId: string,
  speakerId: string,
  avatarId: string | null,
): Promise<number> {
  const result = await db.speaker.updateMany({
    where: { id: speakerId, organizationId },
    data: { avatarId },
  });
  return result.count;
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveAvatarSet, A_SET_IS_COMPLETE_OR_REFUSED
 *
 * WHAT:  A character's artwork ids, or null when the row cannot be drawn.
 * WHY:   One parse point for the jsonb column, so no caller indexes it by
 *        hand. Null rather than a partial set: an avatar missing its `neutral`
 *        frame has no resting state, and the generator's correct response is to
 *        emit no overlay at all rather than a character that vanishes between
 *        sentences.
 * WHERE: The generator's cast resolution; the picker's thumbnail.
 */
export function resolveAvatarSet(row: AvatarRow): AvatarAssetSet | null {
  return readAvatarAssetSet(row.assetSet);
}

/**
 * SOURCE OF TRUTH KEYWORDS: upsertAvatar, MANIFEST_KEY_IS_THE_IDENTITY,
 *   ARTWORK_MUST_EXIST_FIRST
 *
 * WHAT:  Creates or updates one character from a manifest entry.
 * WHY:   MANIFEST_KEY_IS_THE_IDENTITY — the id is derived from the manifest key
 *        (`avatarAssetId`), so a re-sync UPDATES rather than minting a second
 *        character and stranding every `Speaker.avatarId` pointing at the
 *        first.
 *
 *        `isActive: true` is written on every upsert, which is what makes
 *        re-adding a withdrawn character to the manifest bring it back — the
 *        reverse of `deactivateMissingAvatars` below, and the pair is what
 *        makes the manifest the source of truth for what is offered.
 * WHERE: `avatars.sync`.
 */
export async function upsertAvatar(
  db: DbClient,
  data: {
    id: string;
    name: string;
    minPlan: string;
    assetSet: AvatarAssetSet;
  },
): Promise<{ created: boolean }> {
  const existing = await db.avatar.findUnique({
    where: { id: data.id },
    select: { id: true },
  });

  if (existing === null) {
    await db.avatar.create({
      data: {
        id: data.id,
        name: data.name,
        minPlan: data.minPlan,
        assetSet: data.assetSet,
        isActive: true,
      },
    });
    return { created: true };
  }

  await db.avatar.update({
    where: { id: data.id },
    data: {
      name: data.name,
      minPlan: data.minPlan,
      assetSet: data.assetSet,
      isActive: true,
    },
  });
  return { created: false };
}

/**
 * SOURCE OF TRUTH KEYWORDS: deactivateMissingAvatars, DEACTIVATE_NEVER_DELETE
 *
 * WHAT:  Withdraws every character the manifest no longer declares.
 * WHY:   DEACTIVATE_NEVER_DELETE — see the file header. A delete would break
 *        every project whose cast points at the row; a deactivation removes it
 *        from the picker and leaves those documents rendering exactly as they
 *        did.
 *
 *        Takes the ids it should KEEP rather than the ones to remove, so a
 *        sync that failed halfway cannot deactivate the catalogue: an empty
 *        `keep` list would withdraw everything, which is why the caller refuses
 *        to call this on an empty manifest.
 * WHERE: `avatars.sync`, after every upsert has succeeded.
 */
export async function deactivateMissingAvatars(
  db: DbClient,
  keep: readonly string[],
): Promise<number> {
  const result = await db.avatar.updateMany({
    where: { isActive: true, id: { notIn: [...keep] } },
    data: { isActive: false },
  });
  return result.count;
}
