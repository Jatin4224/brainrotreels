/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getStorageAdapter, StorageAdapter, storage keys,
 *   PROVIDER_ISOLATION, dynamic import, STORAGE_PROVIDER
 *
 * WHAT:  The only sanctioned way for app code to reach object storage, plus
 *        the key builders re-exported so a caller needs one import.
 * WHY:   The dynamic `import()` is the isolation guarantee — the S3 SDK is
 *        never evaluated in a process that does not touch storage, which also
 *        keeps it out of any bundle that merely imports a key builder. That
 *        matters: `keys.ts` is pure and safe to import anywhere, and splitting
 *        it from the SDK is what keeps it that way.
 * WHERE: Used by the asset services from Phase 02 onward.
 */

import "server-only";

import { STORAGE_PROVIDER } from "./provider";
import type { StorageAdapter } from "./types";

export type {
  StorageAdapter,
  StorageObjectInfo,
  StorageProviderId,
  SignedPutOptions,
} from "./types";
export {
  STORAGE_PROVIDER_IDS,
  DEFAULT_SIGNED_GET_TTL_SECONDS,
  DEFAULT_SIGNED_PUT_TTL_SECONDS,
} from "./types";
export { STORAGE_PROVIDER, DEFAULT_STORAGE_PROVIDER } from "./provider";
export {
  assertKeySegment,
  assetObjectKey,
  isLibraryKey,
  isOwnedByOrganization,
  libraryKey,
  libraryKindForAssetKind,
  LIBRARY_KIND_BY_ASSET_KIND,
  LIBRARY_KINDS,
  projectKey,
  renderKey,
  tmpKey,
  TMP_PREFIX,
  type AssetKeyOwner,
  type LibraryKind,
  type ProjectAssetKind,
} from "./keys";
export { uploadKey } from "./keys";

let adapterPromise: Promise<StorageAdapter> | null = null;

async function loadAdapter(): Promise<StorageAdapter> {
  /* Exhaustive over StorageProviderId — a new id without a case here is a
   * compile error at the `never` branch. */
  switch (STORAGE_PROVIDER) {
    case "r2": {
      const mod = await import("./r2");
      return mod.r2StorageAdapter;
    }
    default: {
      const exhaustive: never = STORAGE_PROVIDER;
      throw new Error(
        `[adapters/storage] No adapter registered for "${String(exhaustive)}".`,
      );
    }
  }
}

export async function getStorageAdapter(): Promise<StorageAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter();
  }
  return adapterPromise;
}
