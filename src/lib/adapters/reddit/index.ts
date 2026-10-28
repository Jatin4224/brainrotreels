/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getRedditAdapter, RedditAdapter, REDDIT_PROVIDER,
 *   PROVIDER_ISOLATION, dynamic import, PURE_HALF_IS_EXPORTED
 *
 * WHAT:  The only sanctioned way to reach Reddit, plus the pure URL parser
 *        re-exported so a caller needs one import.
 *
 * WHY:   The dynamic `import()` is the isolation guarantee, as in every other
 *        seam: the implementation module — the one that reads
 *        `REDDIT_CLIENT_SECRET` — is never evaluated in a process that does not
 *        fetch a thread.
 *
 *        PURE_HALF_IS_EXPORTED, and the split matters as much here as it does
 *        in the storage seam. `./url` is pure: no network, no credential, no
 *        `server-only`. It holds the HOST ALLOWLIST, which is the check with
 *        security consequences, so it has to be importable by a form
 *        validator, by a test and by a workflow alike. A caller that only
 *        needs to know whether a string is a Reddit link must not drag the
 *        OAuth credential's module into its graph to find out.
 * WHERE: src/lib/script/ingest.ts (the fetch) and src/lib/types/reddit.ts (the
 *        form-level validation).
 */

import "server-only";

import { REDDIT_PROVIDER } from "./provider";
import type { RedditAdapter } from "./types";

export type {
  RedditAdapter,
  RedditComment,
  RedditFetchError,
  RedditProviderId,
  RedditThread,
} from "./types";
export {
  REDDIT_BODY_MAX_CHARS,
  REDDIT_COMMENT_MAX_CHARS,
  REDDIT_FETCH_ERRORS,
  REDDIT_PROVIDER_IDS,
  REDDIT_TOP_COMMENTS,
  RedditError,
} from "./types";
export { REDDIT_PROVIDER, DEFAULT_REDDIT_PROVIDER } from "./provider";
export {
  REDDIT_HOSTS,
  REDDIT_URL_REFUSALS,
  isRedditHost,
  parseRedditThreadUrl,
} from "./url";
export type { RedditUrlParse, RedditUrlRefusal } from "./url";

let adapterPromise: Promise<RedditAdapter> | null = null;

async function loadAdapter(): Promise<RedditAdapter> {
  /* Exhaustive over RedditProviderId — a new id without a case here is a
   * compile error at the `never` branch. */
  switch (REDDIT_PROVIDER) {
    case "official": {
      const mod = await import("./official");
      return mod.officialRedditAdapter;
    }
    default: {
      const exhaustive: never = REDDIT_PROVIDER;
      throw new Error(
        `[adapters/reddit] No adapter registered for "${String(exhaustive)}".`,
      );
    }
  }
}

export async function getRedditAdapter(): Promise<RedditAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter();
  }
  return adapterPromise;
}
