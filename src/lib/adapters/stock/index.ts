/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getStockAdapter, StockAdapter, STOCK_PROVIDER,
 *   PROVIDER_ISOLATION, dynamic import, PURE_HALF_IS_EXPORTED
 *
 * WHAT:  The only sanctioned way to reach a stock library, plus the pure host
 *        allowlist re-exported so a caller needs one import.
 *
 * WHY:   The dynamic `import()` is the isolation guarantee, as in every other
 *        seam: the implementation module — the one that reads `STOCK_API_KEY` —
 *        is never evaluated in a process that does not search for footage.
 *
 *        PURE_HALF_IS_EXPORTED, and the split matters as much here as in the
 *        Reddit seam. `./hosts` is pure: no network, no credential, no
 *        `server-only`. It holds the DOWNLOAD HOST ALLOWLIST, which is the
 *        check with security consequences (NO_SSRF_THROUGH_A_STORED_URL), so it
 *        has to be importable by a router that validates a swap, by the
 *        workflow that fetches, and by a test alike.
 * WHERE: src/services/visuals.service.ts (the search) and
 *        src/inngest/functions/visual-ingest.ts (the fetch).
 */

import "server-only";

import { STOCK_PROVIDER } from "./provider";
import type { StockAdapter } from "./types";

export type {
  StockAdapter,
  StockFetchError,
  StockProviderId,
  StockResult,
  StockSearchOptions,
} from "./types";
export { STOCK_FETCH_ERRORS, STOCK_PROVIDER_IDS, StockError } from "./types";
export { STOCK_PROVIDER, DEFAULT_STOCK_PROVIDER } from "./provider";
export {
  STOCK_DOWNLOAD_HOSTS,
  assertStockDownloadUrl,
  isStockDownloadHost,
} from "./hosts";
export type { StockUrlRefusal } from "./hosts";

let adapterPromise: Promise<StockAdapter> | null = null;

async function loadAdapter(): Promise<StockAdapter> {
  /* Exhaustive over StockProviderId — a new id without a case here is a
   * compile error at the `never` branch. */
  switch (STOCK_PROVIDER) {
    case "pexels": {
      const mod = await import("./pexels");
      return mod.pexelsStockAdapter;
    }
    default: {
      const exhaustive: never = STOCK_PROVIDER;
      throw new Error(
        `[adapters/stock] No adapter registered for "${String(exhaustive)}".`,
      );
    }
  }
}

export async function getStockAdapter(): Promise<StockAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter();
  }
  return adapterPromise;
}
