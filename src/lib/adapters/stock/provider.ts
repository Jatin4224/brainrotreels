/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: STOCK_PROVIDER, stockSelector,
 *   assertStockProviderActive, DEFAULT_STOCK_PROVIDER, LICENSED_LIBRARIES_ONLY
 *
 * WHAT:  Resolves which stock library is selected, once.
 *
 * WHY:   Selected exactly like the jobs, storage, media, render, llm, tts, stt,
 *        moderation and reddit seams — see src/lib/adapters/select-provider.ts
 *        for why these cannot share the auth machinery. That file's own header
 *        names `stock` as one of the seams it was built for, so this is the
 *        anticipated shape rather than a new one.
 *
 *        LICENSED_LIBRARIES_ONLY, and the single registered id says so on
 *        purpose. The seam exists because the alternative implementation is
 *        obvious and forbidden: scraping a video platform, or pulling from an
 *        image search. Both put footage with no licence into customers' videos,
 *        which is the one failure in this phase that cannot be fixed later — a
 *        published video is published. A seam with one implementation still
 *        earns its keep: it is where the next person looks when the provider
 *        changes, and it is the fence that keeps the credential in one folder.
 * WHERE: Used by ./index.ts and asserted at module scope by ./pexels.
 */

import { createProviderSelector } from "../select-provider";
import { STOCK_PROVIDER_IDS, type StockProviderId } from "./types";

export const DEFAULT_STOCK_PROVIDER: StockProviderId = "pexels";

export const stockSelector = createProviderSelector<StockProviderId>({
  label: "stock",
  envVar: "STOCK_PROVIDER",
  rawValue: process.env["STOCK_PROVIDER"],
  ids: STOCK_PROVIDER_IDS,
  fallback: DEFAULT_STOCK_PROVIDER,
});

export const STOCK_PROVIDER: StockProviderId = stockSelector.provider;

export function assertStockProviderActive(id: StockProviderId): void {
  stockSelector.assertActive(id);
}
