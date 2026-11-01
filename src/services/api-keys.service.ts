/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: createApiKey, listApiKeys, revokeApiKey,
 *   findActiveApiKey, touchApiKey, SERVICES_OWN_THE_DATABASE,
 *   REVOKED_NOT_DELETED, REVOCATION_IS_CHECKED_EVERY_REQUEST,
 *   THE_SECRET_IS_NEVER_STORED, LAST_USED_IS_BEST_EFFORT
 *
 * WHAT:  The `ApiKey` rows: minting one, listing them for a workspace,
 *        revoking one, and verifying a presented key on every API request.
 *
 * WHY:   REVOCATION_IS_CHECKED_EVERY_REQUEST. The phase file is specific —
 *        "a revoked key stops working immediately — check `revokedAt` on every
 *        request, do not cache the lookup past a few seconds" — and the
 *        reason is that this is the ONLY off switch a customer has. A key is
 *        in a deploy config somewhere; when it leaks, revoking it has to be
 *        effective now rather than at the end of a cache window. So
 *        `findActiveApiKey` filters on `revokedAt` in the query itself and
 *        there is deliberately no cache in this file at all. One indexed read
 *        on a unique column is cheap enough that caching would be trading the
 *        product's only safety property for a saved millisecond.
 *
 *        REVOKED_NOT_DELETED. Revoking sets the column and keeps the row,
 *        because the audit trail has to answer "which key did this" months
 *        after somebody turned it off. A deleted row makes every past action
 *        anonymous at exactly the moment somebody is investigating.
 *
 *        THE_SECRET_IS_NEVER_STORED — this file never sees a plaintext key
 *        except as an argument to hash it. `createApiKey` takes an
 *        already-minted hash and prefix, so the format lives in
 *        src/lib/api/keys.ts where it can be tested without a database, and
 *        this layer is only about rows.
 *
 *        LAST_USED_IS_BEST_EFFORT. `touchApiKey` is fire-and-forget and its
 *        failure is swallowed: `lastUsedAt` exists so a customer can tell
 *        which of four keys is still in use before revoking one, and a write
 *        that fails must not fail the API call it was observing. Writing it
 *        synchronously on the request path would also add a write to every
 *        read-only API call, which is the wrong trade for a field nobody reads
 *        in real time.
 * WHERE: `apiKeys.*` in src/trpc/routers/api-keys.ts, and the REST
 *        authenticator in src/app/api/v1/_lib/authenticate.ts.
 */

import "server-only";

import type { DbClient } from "@/lib/config/prisma";
import { prisma } from "@/lib/config/prisma";
import { hashApiKey } from "@/lib/api/keys";

/**
 * SOURCE OF TRUTH KEYWORDS: ApiKeyRow, THE_SECRET_IS_NEVER_STORED
 *
 * One key as a customer may see it. The `hash` is deliberately absent from
 * this shape: nothing outside verification has a use for it, and a type that
 * carried it would eventually be returned to a client by somebody spreading
 * the row.
 */
export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  dailyQuota: number;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const ROW_SELECT = {
  id: true,
  name: true,
  prefix: true,
  dailyQuota: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

/**
 * SOURCE OF TRUTH KEYWORDS: createApiKey
 *
 * WHAT:  Stores a minted key's digest and metadata.
 * WHY:   Takes the hash and prefix rather than minting them, so the format is
 *        decided by the pure module and this function cannot accidentally
 *        store a digest for a different string than the one handed out.
 * WHERE: `apiKeys.create`.
 */
export async function createApiKey(
  db: DbClient,
  args: {
    organizationId: string;
    createdByUserId: string;
    name: string;
    prefix: string;
    hash: string;
  },
): Promise<ApiKeyRow> {
  return db.apiKey.create({
    data: {
      organizationId: args.organizationId,
      createdByUserId: args.createdByUserId,
      name: args.name,
      prefix: args.prefix,
      hash: args.hash,
    },
    select: ROW_SELECT,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: listApiKeys, REVOKED_NOT_DELETED
 *
 * WHAT:  Every key a workspace has ever minted, revoked ones included.
 * WHY:   Revoked keys are RETURNED rather than filtered, because the screen's
 *        job is to let somebody understand their own history — "I revoked that
 *        one in March" is the answer to "why did my script stop working". The
 *        UI greys them; hiding them would make a revocation look like a
 *        deletion.
 * WHERE: `apiKeys.list`; the developers screen.
 */
export async function listApiKeys(
  db: DbClient,
  organizationId: string,
): Promise<ApiKeyRow[]> {
  return db.apiKey.findMany({
    where: { organizationId },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    select: ROW_SELECT,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: revokeApiKey, REVOKED_NOT_DELETED, IDEMPOTENT_REVOKE
 *
 * WHAT:  Turns one key off. Returns whether this call was the one that did it.
 *
 * WHY:   IDEMPOTENT_REVOKE — the `revokedAt: null` filter means a second
 *        revoke of the same key matches no rows and returns false, rather than
 *        moving the timestamp forward. The first revocation is the one that
 *        matters to an investigation, and a double-click must not rewrite it.
 *
 *        Scoped by `organizationId` as well as id, so a guessed key id from
 *        another workspace matches nothing.
 * WHERE: `apiKeys.revoke`.
 */
export async function revokeApiKey(
  db: DbClient,
  organizationId: string,
  id: string,
): Promise<boolean> {
  const result = await db.apiKey.updateMany({
    where: { id, organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * SOURCE OF TRUTH KEYWORDS: findActiveApiKey, REVOCATION_IS_CHECKED_EVERY_REQUEST,
 *   NO_CACHE_HERE
 *
 * WHAT:  The key a presented secret belongs to, or null — where null covers
 *        "no such key", "revoked" and "wrong" without distinguishing them.
 *
 * WHY:   NO_CACHE_HERE, by design. See the file header: this is the only off
 *        switch, and a cache would delay it.
 *
 *        It looks up by DIGEST on a unique index, so this is one indexed read
 *        and no comparison loop — and the collapse of the three failure cases
 *        into `null` is what stops the endpoint telling an attacker which key
 *        ids are real or which have been revoked.
 *
 *        `prisma` rather than a passed `DbClient`: this runs BEFORE any
 *        transaction exists, as the first thing a request does, and there is
 *        nothing for it to join.
 * WHERE: The REST authenticator.
 */
export async function findActiveApiKey(presented: string): Promise<{
  id: string;
  organizationId: string;
  prefix: string;
  dailyQuota: number;
  createdByUserId: string;
} | null> {
  const row = await prisma.apiKey.findFirst({
    where: { hash: hashApiKey(presented), revokedAt: null },
    select: {
      id: true,
      organizationId: true,
      prefix: true,
      dailyQuota: true,
      createdByUserId: true,
    },
  });

  return row;
}

/**
 * SOURCE OF TRUTH KEYWORDS: touchApiKey, LAST_USED_IS_BEST_EFFORT
 *
 * WHAT:  Records that a key was used, without the caller waiting or caring.
 * WHY:   See LAST_USED_IS_BEST_EFFORT in the file header. It swallows its own
 *        failure on purpose: the field is a convenience for deciding which key
 *        is safe to revoke, and a failed write must never fail the request it
 *        was observing.
 * WHERE: The REST authenticator, not awaited.
 */
export async function touchApiKey(id: string): Promise<void> {
  try {
    await prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  } catch (error) {
    console.warn(
      `[api-keys.service] Could not record use of key ${id}: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
