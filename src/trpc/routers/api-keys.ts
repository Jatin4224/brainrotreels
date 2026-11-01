/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: apiKeysRouter, apiKeys.create, apiKeys.list,
 *   apiKeys.revoke, SHOWN_ONCE_NEVER_AGAIN, THE_SCREEN_IS_NOT_GATED,
 *   MINTING_IS_NOT_USING, REVOKED_NOT_DELETED
 *
 * WHAT:  Managing the credentials for the public API: mint one, list them,
 *        revoke one.
 *
 * WHY:   MINTING_IS_NOT_USING, which is why this router is NOT mounted under
 *        `apiAccess`. The flag that decides whether a workspace may CALL the
 *        API is checked by the REST layer on every request; this screen is
 *        about the keys themselves and is gated by the `apiKeys` resource's
 *        own permissions instead. The two are separate on purpose: an owner
 *        should be able to decide which teammates may mint a credential that
 *        acts for the whole workspace, independently of which plan they are
 *        on.
 *
 *        THE_SCREEN_IS_NOT_GATED, per the phase file's `requireFlag: false`. A
 *        workspace without API access still reaches this screen and is told
 *        what the feature is and what upgrading would buy. Hiding it means the
 *        only people who discover the API are the ones already paying for it.
 *        A free workspace can therefore MINT a key and get 403 from the API
 *        when it uses one, which reads worse than it is — so the screen says
 *        so, and `create` leaves the entitlement check to the surface that can
 *        actually answer it per request.
 *
 *        SHOWN_ONCE_NEVER_AGAIN. `create` is the only call that ever returns a
 *        plaintext key, and nothing stores it. That makes the response of this
 *        one mutation the most sensitive payload in the product, which is why
 *        there is no "show key" query anywhere: a customer who loses it mints
 *        a new one and revokes the old.
 * WHERE: Mounted as `apiKeys` in src/trpc/routers/_app.ts; consumed by
 *        /dashboard/settings/developers.
 */

import { TRPCError } from "@trpc/server";

import { mintApiKey } from "@/lib/api/keys";
import { permissions } from "@/lib/permissions";
import {
  createApiKeySchema,
  listApiKeysSchema,
  revokeApiKeySchema,
} from "@/lib/types/api";
import * as apiKeysService from "@/services/api-keys.service";

import { createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";

export const apiKeysRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: apiKeys.list, REVOKED_NOT_DELETED
   *
   * WHAT:  Every key this workspace has minted, revoked ones included.
   * WHY:   Revoked keys are shown greyed rather than hidden — see
   *        `listApiKeys`. A query, so it is cheap to re-read after a mint.
   * WHERE: The developers screen's table.
   */
  list: protectedProcedure({ requirePermission: permissions.API_KEYS_READ })
    .input(listApiKeysSchema)
    .query(async ({ ctx, input }) => ({
      keys: await apiKeysService.listApiKeys(ctx.db, input.organizationId),
    })),

  /**
   * SOURCE OF TRUTH KEYWORDS: apiKeys.create, SHOWN_ONCE_NEVER_AGAIN,
   *   THE_FORMAT_IS_NOT_THE_CLIENTS_CHOICE
   *
   * WHAT:  A new key. Returns the plaintext exactly once.
   *
   * WHY:   THE_FORMAT_IS_NOT_THE_CLIENTS_CHOICE — the secret, its length, its
   *        prefix and its quota are all decided here, from the pure minting
   *        module. The input is a NAME, because that is the only part the
   *        person knows and the only part that helps them revoke the right key
   *        later.
   *
   *        The rate limit (five an hour, from the registry) is enforced by the
   *        factory from the path. It is not a guard against abuse so much as
   *        against a loop: a key is minted once and lives in a deploy config,
   *        so anything minting dozens is a script, and every one of them is a
   *        live credential until somebody notices.
   *
   *        `output.prefix` is what the audit template records, which is why
   *        the row is returned rather than a bare success — and it is the only
   *        part of the key that still exists after this response.
   * WHERE: The "Create key" dialog.
   */
  create: protectedProcedure({
    requirePermission: permissions.API_KEYS_CREATE,
  })
    .input(createApiKeySchema)
    .mutation(async ({ ctx, input }) => {
      const minted = mintApiKey();

      const key = await apiKeysService.createApiKey(ctx.db, {
        organizationId: input.organizationId,
        createdByUserId: ctx.user.id,
        name: input.name,
        prefix: minted.prefix,
        hash: minted.hash,
      });

      /* The ONLY time the plaintext leaves this process. The screen must show
       * it immediately and must not store it — see SHOWN_ONCE_NEVER_AGAIN. */
      return { key, secret: minted.secret };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: apiKeys.revoke, REVOKED_NOT_DELETED,
   *   IDEMPOTENT_REVOKE
   *
   * WHAT:  Turns one key off, immediately.
   * WHY:   A `NOT_FOUND` when nothing matched, which covers both "no such key
   *        here" and "already revoked". Those are deliberately the same
   *        answer: the second is not an error worth a different screen, and
   *        distinguishing them would have the UI explain a race the customer
   *        does not care about. The first revocation's timestamp is the one
   *        that matters and a second call does not move it.
   * WHERE: The row menu's "Revoke" action.
   */
  revoke: protectedProcedure({
    requirePermission: permissions.API_KEYS_DELETE,
  })
    .input(revokeApiKeySchema)
    .mutation(async ({ ctx, input }) => {
      const revoked = await apiKeysService.revokeApiKey(
        ctx.db,
        input.organizationId,
        input.id,
      );

      if (!revoked) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That key is already revoked, or no longer exists.",
        });
      }

      return { id: input.id, revoked: true };
    }),
});
