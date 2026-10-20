/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: STORAGE_PROVIDER, storageSelector,
 *   assertStorageProviderActive, DEFAULT_STORAGE_PROVIDER
 *
 * WHAT:  Resolves which object store is selected, once.
 * WHY:   Server-only, like JOBS_PROVIDER: the browser receives signed URLs,
 *        never bucket configuration. Same shape as every other non-auth seam
 *        — see src/lib/adapters/select-provider.ts for why these cannot share
 *        the auth machinery.
 * WHERE: Used by ./index.ts and asserted at module scope by ./r2.
 */

import { createProviderSelector } from "../select-provider";
import { STORAGE_PROVIDER_IDS, type StorageProviderId } from "./types";

export const DEFAULT_STORAGE_PROVIDER: StorageProviderId = "r2";

export const storageSelector = createProviderSelector<StorageProviderId>({
  label: "storage",
  envVar: "STORAGE_PROVIDER",
  rawValue: process.env["STORAGE_PROVIDER"],
  ids: STORAGE_PROVIDER_IDS,
  fallback: DEFAULT_STORAGE_PROVIDER,
});

export const STORAGE_PROVIDER: StorageProviderId = storageSelector.provider;

export function assertStorageProviderActive(id: StorageProviderId): void {
  storageSelector.assertActive(id);
}
