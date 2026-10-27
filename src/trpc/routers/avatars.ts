/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: avatarsRouter, avatars.list, avatars.assign,
 *   avatars.sync, LOCKED_NOT_HIDDEN, ASSIGN_IS_THE_BOUNDARY, PORTAL_ONLY_SYNC,
 *   ARTWORK_MUST_EXIST_FIRST, NULL_CLEARS_THE_FACE
 *
 * WHAT:  The character catalogue a workspace browses, the face it gives a
 *        speaker, and the operator's import of the avatar manifest.
 *
 * WHY:   LOCKED_NOT_HIDDEN, the same rule as the voice catalogue, the caption
 *        gallery and the background library. `list` returns every ACTIVE
 *        character with a `locked` flag — never a plan-filtered subset —
 *        because a character a customer never sees is one they have no reason
 *        to pay for. A DEACTIVATED character is filtered out, which is the one
 *        exception and is not an inconsistency: a withdrawn character is not an
 *        upsell, and showing it locked would offer an upgrade that does not
 *        unlock it.
 *
 *        ASSIGN_IS_THE_BOUNDARY. The plan is re-checked on the write, because a
 *        lock badge stops a mistake and not a request — and it is re-checked
 *        AGAIN at generate time (`resolveCast` in
 *        src/services/pipeline.service.ts), because a workspace can downgrade
 *        between casting a premium character and generating. Two checks, both
 *        needed: this one explains itself to a customer, that one quietly draws
 *        a video without the face.
 *
 *        PORTAL_ONLY_SYNC, exactly as `voices.sync` and
 *        `backgroundLibrary.sync` are: `Avatar` rows have no
 *        `organizationId` and are read by every tenant, so a tenant able to
 *        write them could withdraw a character for everybody.
 *
 *        ARTWORK_MUST_EXIST_FIRST is the ordering rule this router enforces,
 *        and it is why `sync` refuses rather than writing an empty-handed row:
 *        an avatar's three frames are LIBRARY ASSETS created by
 *        `backgroundLibrary.sync` from the background manifest, so the two
 *        syncs run in that order. A character whose artwork has not been
 *        ingested yet would sit in the picker rendering as three gaps.
 * WHERE: Mounted as `avatars` in src/trpc/routers/_app.ts.
 */

import { TRPCError } from "@trpc/server";

import { createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import { getOrganizationTier } from "@/lib/feature-gate";
import { AVATAR_MANIFEST } from "@/lib/library/avatars.manifest";
import { signScopedKey } from "@/services/assets.service";
import * as avatarsService from "@/services/avatars.service";
import {
  assignAvatarSchema,
  avatarAssetId,
  avatarAvailableOnPlan,
  listAvatarsSchema,
  syncAvatarsSchema,
  type AvatarAssetSet,
} from "@/lib/types/avatar";
import { libraryAssetId } from "@/lib/types/background";

export const avatarsRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: avatars.list, LOCKED_NOT_HIDDEN
   *
   * WHAT:  The whole active catalogue, each character marked locked or not,
   *        with a thumbnail.
   * WHY:   The thumbnail is the RESTING frame, because that is what a character
   *        looks like when it is not doing anything and is therefore the honest
   *        tile. It goes through `signScopedKey`, which is also what decides
   *        CDN versus signed — avatar artwork is a library asset, so it comes
   *        back as a permanent public URL when a CDN is configured
   *        (LIBRARY_IS_SERVED_FROM_THE_CDN) and this handler does not need to
   *        know which it got.
   * WHERE: The cast panel's character picker.
   */
  list: protectedProcedure({ requirePermission: permissions.AVATARS_READ })
    .input(listAvatarsSchema)
    .query(async ({ ctx, input }) => {
      const [tier, rows] = await Promise.all([
        getOrganizationTier(input.organizationId),
        avatarsService.listAvatars(ctx.db),
      ]);

      const items = await Promise.all(
        rows.map(async (row) => {
          const states = avatarsService.resolveAvatarSet(row);
          return {
            id: row.id,
            name: row.name,
            minPlan: row.minPlan,
            locked: !avatarAvailableOnPlan(row.minPlan, tier.tier),
            /* A_SET_IS_COMPLETE_OR_REFUSED — a row whose artwork does not
             * parse is reported as undrawable rather than offered. */
            usable: states !== null,
            thumbUrl:
              states === null
                ? null
                : await thumbFor(ctx.db, states, input.organizationId),
          };
        }),
      );

      return { plan: tier.tier, items };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: avatars.assign, ASSIGN_IS_THE_BOUNDARY,
   *   NULL_CLEARS_THE_FACE
   *
   * WHAT:  Gives a speaker a character, or takes it away.
   * WHY:   NULL_CLEARS_THE_FACE rather than a second mutation: a speaker with
   *        no avatar is a real and common choice — a narrator who is never on
   *        screen — and the write is the same.
   *
   *        The refusal order is the one that makes the message useful: a
   *        character that no longer exists is NOT_FOUND (which is also the
   *        right answer for a guessed id), one above the plan is FORBIDDEN, and
   *        a speaker from another workspace matches nothing and is NOT_FOUND.
   *
   *        It does not touch the document. A face is read at GENERATE time
   *        from the speaker row (CAST_IS_A_FACT), so changing it applies to the
   *        next generation — the handler says so in its return value rather
   *        than leaving the customer to notice.
   * WHERE: The cast panel.
   */
  assign: protectedProcedure({
    requirePermission: permissions.AVATARS_ASSIGN,
    audit: { action: "assign" },
  })
    .input(assignAvatarSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.avatarId !== null) {
        const avatar = await avatarsService.findAvatar(ctx.db, input.avatarId);
        if (avatar === null) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That character is no longer available.",
          });
        }

        const tier = await getOrganizationTier(input.organizationId);
        if (!avatarAvailableOnPlan(avatar.minPlan, tier.tier)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `${avatar.name} is included from the ${avatar.minPlan} plan upward.`,
          });
        }

        if (avatarsService.resolveAvatarSet(avatar) === null) {
          /* Reachable: a row synced before its artwork finished ingesting, or
           * one written by a newer release with a state this build cannot
           * draw. Refused rather than assigned, because the alternative is a
           * video with a hole where a character should be. */
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "That character's artwork is not ready yet. Try again in a few minutes.",
          });
        }
      }

      const updated = await avatarsService.assignSpeakerAvatar(
        ctx.db,
        input.organizationId,
        input.speakerId,
        input.avatarId,
      );
      if (updated === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That speaker no longer exists.",
        });
      }

      return { avatarId: input.avatarId, appliesToNextGeneration: true };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: avatars.sync, PORTAL_ONLY_SYNC,
   *   ARTWORK_MUST_EXIST_FIRST, MANIFEST_IS_THE_REVIEW
   *
   * WHAT:  Imports the avatar manifest, resolving each character's three
   *        library manifest keys to the Asset ids its artwork landed on.
   *
   * WHY:   ARTWORK_MUST_EXIST_FIRST. The frames are library assets created by
   *        `backgroundLibrary.sync` from the BACKGROUND manifest (they are
   *        `kind: 'avatar'` entries there), so this sync runs SECOND and
   *        refuses any character whose frames are not yet `ready`. Writing the
   *        row anyway would put a character in the picker that renders as three
   *        gaps — and `signDocumentAssets` would quite correctly resolve every
   *        one of them to `url: null`.
   *
   *        The refusal is per CHARACTER rather than per run: a manifest of six
   *        where one artist is late should import five and name the sixth,
   *        because the alternative is six characters nobody can use until the
   *        last file lands.
   *
   *        It does NOT deactivate on a dry run, and it does not deactivate at
   *        all when the manifest is empty — an empty `keep` list would withdraw
   *        the entire catalogue, which is exactly what a half-failed deploy
   *        looks like. See DEACTIVATE_NEVER_DELETE.
   * WHERE: Called as the portal workspace. There is no screen for it yet — the
   *        same state `voices.sync` and `backgroundLibrary.sync` are in, and
   *        deliberately: the manifest is empty until the artwork is
   *        commissioned, so a console would be a button with nothing to do.
   */
  sync: protectedProcedure({
    requirePermission: permissions.AVATARS_SYNC,
    audit: { action: "sync" },
    txTimeout: 60_000,
  })
    .input(syncAvatarsSchema)
    .mutation(async ({ ctx, input }) => {
      /* PORTAL_ONLY_SYNC — the permission is necessary and not sufficient. */
      const organization = await ctx.db.organization.findUnique({
        where: { id: input.organizationId },
        select: { isPortalOrganization: true },
      });
      if (organization?.isPortalOrganization !== true) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The character catalogue can only be synced from the portal.",
        });
      }

      const dryRun = input.dryRun === true;
      let created = 0;
      let updated = 0;
      const kept: string[] = [];
      const missingArtwork: string[] = [];

      for (const entry of AVATAR_MANIFEST) {
        const states: AvatarAssetSet = {
          neutral: libraryAssetId(entry.states.neutral),
          talking: libraryAssetId(entry.states.talking),
          reaction: libraryAssetId(entry.states.reaction),
        };

        /* ARTWORK_MUST_EXIST_FIRST — every frame has to be an ingested library
         * asset before the character is offered. */
        const ready = await ctx.db.asset.count({
          where: {
            id: { in: [states.neutral, states.talking, states.reaction] },
            organizationId: null,
            kind: "avatar",
            status: "ready",
          },
        });
        if (ready < 3) {
          missingArtwork.push(entry.key);
          continue;
        }

        const id = avatarAssetId(entry.key);
        kept.push(id);
        if (dryRun) continue;

        const result = await avatarsService.upsertAvatar(ctx.db, {
          id,
          name: entry.name,
          minPlan: entry.minPlan,
          assetSet: states,
        });
        if (result.created) created += 1;
        else updated += 1;
      }

      /* Never on a dry run, and never on an empty keep list — see the WHY. */
      const deactivated =
        dryRun || kept.length === 0
          ? 0
          : await avatarsService.deactivateMissingAvatars(ctx.db, kept);

      return {
        dryRun,
        found: AVATAR_MANIFEST.length,
        created,
        updated,
        deactivated,
        /* Named, not counted: an operator needs to know WHICH artist is late. */
        missingArtwork,
      };
    }),
});

/**
 * SOURCE OF TRUTH KEYWORDS: thumbFor, RESTING_FRAME_IS_THE_TILE
 *
 * WHAT:  A URL for a character's resting frame.
 * WHY:   RESTING_FRAME_IS_THE_TILE — what the character looks like doing
 *        nothing, which is the honest picker tile. It signs the asset's own
 *        object rather than a `thumb` variant, because avatar artwork is
 *        already a small transparent PNG and a poster of a PNG is the same
 *        picture at a worse resolution.
 *
 *        `signAssetUrl` is deliberately NOT used: that takes an asset id and
 *        re-reads the row, and this handler has already listed the ids. One
 *        read, then the key check that `signScopedKey` applies anyway
 *        (SIGNING_BOUNDARY).
 * WHERE: `avatars.list`.
 */
async function thumbFor(
  db: Parameters<typeof avatarsService.listAvatars>[0],
  states: AvatarAssetSet,
  organizationId: string,
): Promise<string | null> {
  const row = await db.asset.findFirst({
    where: { id: states.neutral, organizationId: null },
    select: { storageKey: true },
  });
  if (row === null) return null;
  return signScopedKey(row.storageKey, organizationId);
}
