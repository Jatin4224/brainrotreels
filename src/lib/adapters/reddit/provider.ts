/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_PROVIDER, redditSelector,
 *   assertRedditProviderActive, DEFAULT_REDDIT_PROVIDER, OFFICIAL_API_ONLY
 *
 * WHAT:  Resolves which Reddit client is selected, once.
 *
 * WHY:   Selected exactly like the jobs, storage, media, render, llm, tts, stt
 *        and moderation seams — see src/lib/adapters/select-provider.ts for why
 *        these cannot share the auth machinery. No client half: a browser never
 *        fetches a thread, and an endpoint that let one would be an open proxy
 *        with our OAuth app's rate limit behind it.
 *
 *        OFFICIAL_API_ONLY, and the single registered id says so on purpose.
 *        The seam exists because the alternative implementation is obvious and
 *        forbidden: scraping the HTML, or hitting the public `.json` endpoints
 *        unauthenticated. Both are against Reddit's terms, both break without
 *        warning, and neither has a rate limit we can reason about. A seam with
 *        one implementation still earns its keep here — it is where the next
 *        person looks when the API changes, and it is the fence that keeps the
 *        credential in one folder.
 * WHERE: Used by ./index.ts and asserted at module scope by ./official.
 */

import { createProviderSelector } from "../select-provider";
import { REDDIT_PROVIDER_IDS, type RedditProviderId } from "./types";

export const DEFAULT_REDDIT_PROVIDER: RedditProviderId = "official";

export const redditSelector = createProviderSelector<RedditProviderId>({
  label: "reddit",
  envVar: "REDDIT_PROVIDER",
  rawValue: process.env["REDDIT_PROVIDER"],
  ids: REDDIT_PROVIDER_IDS,
  fallback: DEFAULT_REDDIT_PROVIDER,
});

export const REDDIT_PROVIDER: RedditProviderId = redditSelector.provider;

export function assertRedditProviderActive(id: RedditProviderId): void {
  redditSelector.assertActive(id);
}
