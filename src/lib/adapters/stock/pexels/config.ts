/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: pexelsConfig, isPexelsConfigured, PEXELS_API_BASE,
 *   PEXELS_LICENSE, CREDENTIAL_IS_FENCED, LAZY_CONFIG,
 *   LICENCE_IS_A_CONSTANT_NOT_A_GUESS
 *
 * WHAT:  Everything the Pexels client needs from the environment, and the
 *        licence every result it returns is under.
 *
 * WHY:   CREDENTIAL_IS_FENCED. `STOCK_API_KEY` may be read only inside this
 *        folder, and eslint enforces it with a SYNTAX rule rather than an
 *        import restriction — the same mechanism as `ELEVENLABS_API_KEY` and
 *        `REDDIT_CLIENT_SECRET`, and for the same reason: this adapter uses
 *        `fetch` and has no SDK to restrict.
 *
 *        LICENCE_IS_A_CONSTANT_NOT_A_GUESS. Pexels does not return a per-clip
 *        licence field, because every item in its library is under one licence.
 *        That is exactly the situation where an adapter is tempted to leave the
 *        field empty or write "stock" — and LICENCE_IS_NEVER_INFERRED in
 *        ../types.ts forbids both. So the licence is a NAMED CONSTANT in this
 *        file, beside the API base, where it is obvious that it belongs to this
 *        provider and has to be revisited if the provider's terms change. It is
 *        the string that ends up on the asset row and in front of a customer,
 *        so it names the licence and nothing else — no summary of what it
 *        permits, because a paraphrase of somebody else's terms in our UI is a
 *        claim we would be making on their behalf.
 *
 *        LAZY_CONFIG, matching every other provider here: nothing throws at
 *        import. Stock footage is OPTIONAL by design — the phase requires a
 *        video to complete with this seam unconfigured — so a module-scope
 *        throw would crash the setup checklist, which is the one screen whose
 *        job is to report which variables are missing.
 * WHERE: ./index.ts, on every search.
 */

import { assertStockProviderActive } from "../provider";

assertStockProviderActive("pexels");

/**
 * SOURCE OF TRUTH KEYWORDS: PEXELS_API_BASE
 *
 * The videos endpoint lives under the same host as the photos one; this is the
 * API host and is NOT where files are served from — the delivery hosts are the
 * allowlist in ../hosts.ts, and the two are deliberately separate.
 */
export const PEXELS_API_BASE = "https://api.pexels.com";

/**
 * SOURCE OF TRUTH KEYWORDS: PEXELS_LICENSE, LICENCE_IS_A_CONSTANT_NOT_A_GUESS
 *
 * The licence every result is under. See the file header for why this is a
 * constant rather than a field read off the response.
 */
export const PEXELS_LICENSE = "Pexels License";

export interface PexelsConfig {
  apiKey: string;
}

export function isPexelsConfigured(): boolean {
  return Boolean(process.env["STOCK_API_KEY"]?.trim());
}

export function pexelsConfig(): PexelsConfig {
  const apiKey = process.env["STOCK_API_KEY"]?.trim();

  if (!apiKey) {
    throw new Error(
      "[stock/pexels] STOCK_API_KEY is not set. Create a free key at " +
        "https://www.pexels.com/api/ — stock footage is unavailable until it is configured, " +
        "and videos fall back to generated images or the styled backdrop.",
    );
  }

  return { apiKey };
}
