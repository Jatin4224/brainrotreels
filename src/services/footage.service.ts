/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: moderateFootagePrompt, findCachedFootage,
 *   createFootageAsset, recordFootageProvenance, listFootage,
 *   SERVICES_OWN_THE_DATABASE, MODERATE_BEFORE_THE_MODEL,
 *   PROMPT_IS_THE_CACHE_KEY, A_FAILED_CLIP_IS_STILL_SHOWN
 *
 * WHAT:  The `Asset` rows behind generated footage: classifying a prompt before
 *        anything is spent, reusing a clip this workspace already paid for,
 *        creating the row the workflow fills, recording its provenance, and
 *        listing them for the screen.
 *
 * WHY:   MODERATE_BEFORE_THE_MODEL is the phase's step 3 and it is not
 *        optional: "moderate before the model call, specifically for
 *        trademarks and real people. This is the most expensive operation in
 *        the product and the most legally exposed; the check is not optional
 *        and it fails closed." The implementation is deliberately the same
 *        shape as `moderateImagePrompt` — context `prompt`, subject type
 *        `prompt`, the hash as the subject id — because this is the same
 *        decision about a more expensive call, and two different
 *        implementations of one safety rule is how one of them ends up weaker.
 *
 *        `moderateText` never throws and FAILS CLOSED, so a classifier outage
 *        blocks the generation. That is the right failure here: the
 *        alternative is sending an unclassified prompt to a video model and
 *        publishing the result in our name.
 *
 *        PROMPT_IS_THE_CACHE_KEY, as in Phase 14's images and Phase 07's
 *        narration. An identical prompt in the same workspace reuses the clip
 *        rather than paying the most expensive call in the product twice.
 *        Scoped to the workspace and never across tenants: the bytes sit under
 *        that customer's storage quota, the row is theirs to delete, and
 *        sharing a generated clip between workspaces would leak what one of
 *        them asked for.
 *
 *        A_FAILED_CLIP_IS_STILL_SHOWN. `listFootage` returns failed rows with
 *        their reason, because a customer who spent credits and got nothing
 *        needs to know whether to reword or retry — and a row that vanished
 *        would read as the request never having happened.
 *
 *        SERVICES_OWN_THE_DATABASE — this is the only layer here that touches
 *        Prisma, which is why the workflow and the router hold no queries.
 * WHERE: src/inngest/functions/footage-generate.ts and
 *        src/trpc/routers/footage.ts.
 */

import "server-only";

import type { DbClient } from "@/lib/config/prisma";
import { visualPromptHash } from "@/lib/types/visual";
import type { FootageClip } from "@/lib/types/footage";
import { signAssetUrl, signVariantUrl } from "./assets.service";
import { moderateText } from "./moderation.service";

/**
 * SOURCE OF TRUTH KEYWORDS: footagePromptHash, PROMPT_IS_THE_CACHE_KEY
 *
 * WHAT:  The identity of a prompt, for caching and for the moderation record.
 * WHY:   The SAME normalisation the image path uses, reused rather than
 *        reimplemented: trimmed, lowercased, whitespace collapsed. Two
 *        normalisations of one idea would mean a prompt that hits the cache for
 *        an image and misses it for a clip.
 *
 *        An image prompt and a footage prompt with the same text therefore
 *        share a hash, which is harmless and deliberate: every lookup filters
 *        on `kind` as well, so the two never collide, and a shared hash is one
 *        fewer function to keep in step.
 * WHERE: Everything in this file.
 */
export function footagePromptHash(prompt: string): string {
  return visualPromptHash(prompt);
}

/**
 * SOURCE OF TRUTH KEYWORDS: moderateFootagePrompt, MODERATE_BEFORE_THE_MODEL,
 *   TRADEMARKS_AND_REAL_PEOPLE, FAILS_CLOSED
 *
 * WHAT:  Whether this prompt may be sent to a video model. Records the decision
 *        either way.
 * WHY:   See the file header. The record is written whether or not it passed,
 *        because a refusal is exactly what somebody investigating later needs
 *        to find — and the subject is the PROMPT rather than an asset, because
 *        no asset exists yet and must not be created if this fails.
 * WHERE: The workflow's first step, before anything is held or spent.
 */
export async function moderateFootagePrompt(
  db: DbClient,
  args: { organizationId: string; prompt: string },
): Promise<boolean> {
  const outcome = await moderateText(db, {
    organizationId: args.organizationId,
    subjectType: "prompt",
    /* The hash rather than a row id: there is no row yet, and the hash is the
     * identity the cache uses, so two refusals of the same prompt are visibly
     * the same prompt in the queue. */
    subjectId: footagePromptHash(args.prompt),
    text: args.prompt,
    /* The stricter standard. This is a REQUEST somebody is making of a
     * generator, judged harder than source material, because what comes out is
     * published in our name. */
    context: "prompt",
    purpose: "footage.prompt",
  });

  if (outcome.blocked) {
    console.warn(
      `[footage.service] prompt blocked (${outcome.status}): ${
        outcome.reason ?? "no reason recorded"
      }`,
    );
  }

  return !outcome.blocked;
}

/**
 * SOURCE OF TRUTH KEYWORDS: findCachedFootage, PROMPT_IS_THE_CACHE_KEY,
 *   REUSE_WITHIN_THE_WORKSPACE
 *
 * WHAT:  A ready clip this workspace already has for the same prompt.
 * WHY:   Restricted to `ready` rows, as the narration and image caches are: a
 *        pending or failed row has no usable file behind it, and reusing one
 *        would hand the customer a tile that plays nothing. Newest first,
 *        because an older row is likelier to have been superseded.
 * WHERE: The workflow, before it holds a single credit.
 */
export async function findCachedFootage(
  db: DbClient,
  args: { organizationId: string; promptHash: string; durationSec: number },
): Promise<{ id: string } | null> {
  return db.asset.findFirst({
    where: {
      organizationId: args.organizationId,
      kind: "ai_footage",
      source: "generated",
      status: "ready",
      promptHash: args.promptHash,
      /* The LENGTH is part of the identity. The same prompt at five and ten
       * seconds are two different clips and two different prices, so matching
       * on the prompt alone would hand somebody a five-second clip they paid
       * ten seconds for. */
      durationSec: args.durationSec,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: createFootageAsset, THE_ROW_EXISTS_BEFORE_THE_SPEND
 *
 * WHAT:  The `processing` row a generation fills in.
 *
 * WHY:   THE_ROW_EXISTS_BEFORE_THE_SPEND, which is what makes the screen
 *        honest. The row is created before the model is called, carrying the
 *        prompt, so a customer watching the footage screen sees their request
 *        appear immediately and sees it fail if it fails. Creating it only on
 *        success would mean a minute of a blank screen and then either a clip
 *        or nothing, with no way to tell a slow generation from a lost one.
 *
 *        `bytes: 0` because nothing has been uploaded yet; the upload step
 *        writes the real figure. `durationSec` is what was ASKED for, which is
 *        also what was charged — the provider may produce a little more and
 *        the ingest's probe corrects it.
 * WHERE: The workflow, after moderation and the hold.
 */
export async function createFootageAsset(
  db: DbClient,
  args: {
    organizationId: string;
    prompt: string;
    promptHash: string;
    durationSec: number;
    storageKey: string;
    filename: string;
  },
): Promise<{ id: string }> {
  const asset = await db.asset.create({
    data: {
      organizationId: args.organizationId,
      /* The product's kind for footage it was not given by the customer. The
       * same kind Phase 14's stock clips use; `source` is what distinguishes
       * them. */
      kind: "ai_footage",
      source: "generated",
      filename: args.filename,
      storageKey: args.storageKey,
      contentType: "video/mp4",
      bytes: 0,
      durationSec: args.durationSec,
      license: "generated",
      /* The audit trail the phase's step 4 asks for. `modelVersion` is written
       * later, because only the provider can say what it actually ran. */
      promptText: args.prompt,
      promptHash: args.promptHash,
    },
    select: { id: true },
  });

  return asset;
}

/**
 * SOURCE OF TRUTH KEYWORDS: recordFootageProvenance,
 *   MODEL_VERSION_IS_RETURNED_NOT_ASSUMED, PROVENANCE_IS_NOT_OPTIONAL
 *
 * WHAT:  Records which model actually made this clip, and how big it is.
 * WHY:   Written in one update after the upload, because both facts are only
 *        known then: the version comes back from the provider (never from our
 *        config — a provider resolves aliases and rolls models forward) and the
 *        byte count from the upload. Two updates would leave a window in which
 *        a clip exists with no record of what produced it.
 * WHERE: The workflow's upload step.
 */
export async function recordFootageProvenance(
  db: DbClient,
  args: {
    assetId: string;
    modelVersion: string;
    sourceProvider: string;
    bytes: number;
  },
): Promise<void> {
  await db.asset.update({
    where: { id: args.assetId },
    data: {
      modelVersion: args.modelVersion,
      sourceProvider: args.sourceProvider,
      bytes: args.bytes,
    },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: listFootage, A_FAILED_CLIP_IS_STILL_SHOWN,
 *   SIGNED_ON_READ
 *
 * WHAT:  This workspace's generated clips, newest first, with playable URLs.
 *
 * WHY:   SIGNED_ON_READ. The URLs are signed per request rather than stored,
 *        so revoking access is a matter of not signing again — the same rule
 *        the media grid and the render panel follow.
 *
 *        The POSTER is the `thumb` variant and the playable file is the
 *        `proxy_480` when one exists, falling back to the original. That is
 *        not cosmetic: a grid of a dozen clips playing the full-size masters
 *        is tens of megabytes per tile, and the proxy exists precisely so a
 *        browser never has to.
 *
 *        A row still `processing` gets null URLs rather than being filtered
 *        out — see A_FAILED_CLIP_IS_STILL_SHOWN.
 * WHERE: `footage.list`.
 */
export async function listFootage(
  db: DbClient,
  organizationId: string,
): Promise<FootageClip[]> {
  const rows = await db.asset.findMany({
    where: {
      organizationId,
      kind: "ai_footage",
      source: "generated",
    },
    orderBy: { createdAt: "desc" },
    /* A library screen, not a feed. Enough that a customer can see what they
     * have made without a paginated read for a feature capped at a few dozen
     * clips a month. */
    take: 60,
    select: {
      id: true,
      promptText: true,
      durationSec: true,
      status: true,
      error: true,
      createdAt: true,
    },
  });

  return Promise.all(
    rows.map(async (row): Promise<FootageClip> => {
      const ready = row.status === "ready";

      const [proxyUrl, originalUrl, posterUrl] = ready
        ? await Promise.all([
            signVariantUrl(row.id, "proxy_480", organizationId),
            signAssetUrl(row.id, organizationId),
            signVariantUrl(row.id, "thumb", organizationId),
          ])
        : [null, null, null];

      return {
        id: row.id,
        /* The prompt is what a person recognises a clip by. Empty rather than
         * null for a row written before the column existed — the screen renders
         * a string. */
        prompt: row.promptText ?? "",
        durationSec: row.durationSec,
        status: row.status,
        error: row.error,
        createdAt: row.createdAt,
        url: proxyUrl ?? originalUrl,
        posterUrl,
      };
    }),
  );
}
