/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: StorageAdapter, STORAGE_PROVIDER_IDS, StorageProviderId,
 *   putObject, signedGetUrl, signedPutUrl, deleteObject, SIGNED_URL_TTL
 *
 * WHAT:  The contract for object storage.
 * WHY:   Small on purpose — put, sign for read, sign for write, delete, head.
 *        Uploads go DIRECT from the browser to the bucket via a presigned PUT:
 *        routing a 200MB video through a serverless function would blow both
 *        the request body limit and the execution budget, so `signedPutUrl`
 *        is the primary write path and `putObject` exists for server-side
 *        writes like a transcoded variant.
 *        `signedPutUrl` takes `maxBytes` and `contentType` because they are
 *        signed INTO the URL — the bucket itself then rejects an oversized or
 *        mistyped upload. Checking only in the app would leave the signed URL
 *        usable for anything until it expires.
 * WHERE: Implemented by ./r2. Reached through getStorageAdapter() in ./index.
 */

/** Short by default: a leaked URL should stop working quickly. */
export const DEFAULT_SIGNED_GET_TTL_SECONDS = 900;

/** Long enough for a slow mobile upload, short enough to limit reuse. */
export const DEFAULT_SIGNED_PUT_TTL_SECONDS = 3600;

export interface StorageObjectInfo {
  key: string;
  bytes: number;
  contentType: string | undefined;
  lastModified: Date | undefined;
}

export interface SignedPutOptions {
  contentType: string;
  maxBytes: number;
  ttlSeconds?: number;
}

export interface StorageAdapter {
  readonly id: StorageProviderId;

  putObject(args: {
    key: string;
    body: Uint8Array | Buffer;
    contentType: string;
  }): Promise<void>;

  signedGetUrl(key: string, ttlSeconds?: number): Promise<string>;

  signedPutUrl(key: string, options: SignedPutOptions): Promise<string>;

  deleteObject(key: string): Promise<void>;

  /** Batch delete — removing a render means removing its whole prefix. */
  deleteObjects(keys: readonly string[]): Promise<void>;

  /** Returns null when absent, so a caller can distinguish missing from failed. */
  head(key: string): Promise<StorageObjectInfo | null>;

  /**
   * SOURCE OF TRUTH KEYWORDS: publicUrl, PUBLIC_IS_NOT_SIGNED,
   *   CDN_IS_OPTIONAL
   *
   * WHAT:  The permanent CDN URL for an object, or null when there is none.
   *
   * WHY:   PUBLIC_IS_NOT_SIGNED. Library objects — curated backgrounds, music
   *        beds, voice previews — are public by definition: every workspace is
   *        served the identical bytes, so signing them per request buys no
   *        access control and costs the whole CDN cache. A signed URL carries a
   *        unique query string, which means every tenant (and every page load)
   *        is a cache miss on an object that could be edge-cached forever.
   *
   *        SYNCHRONOUS and not a Promise, unlike every other method here, and
   *        that is the shape of the thing rather than an inconsistency: there
   *        is nothing to sign and nobody to ask. It is string concatenation
   *        against a configured origin.
   *
   *        CDN_IS_OPTIONAL. Returns null when no public origin is configured,
   *        which is the normal state of a development checkout — the caller
   *        then falls back to signing, so a bucket with no CDN in front of it
   *        still works and is merely slower. A thrown error here would make an
   *        optional variable required.
   *
   *        It does NOT check whether the key is public. The adapter knows the
   *        origin; the key convention knows what is shared (isLibraryKey), and
   *        the one caller allowed to make that decision is `signScopedKey` in
   *        src/services/assets.service.ts.
   */
  publicUrl(key: string): string | null;
}

export const STORAGE_PROVIDER_IDS = ["r2"] as const;

export type StorageProviderId = (typeof STORAGE_PROVIDER_IDS)[number];
