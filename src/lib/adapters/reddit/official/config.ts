/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: redditConfig, isRedditConfigured, REDDIT_API_BASE,
 *   REDDIT_TOKEN_URL, REDDIT_USER_AGENT, CREDENTIAL_IS_FENCED, LAZY_CONFIG,
 *   USER_AGENT_IS_REQUIRED
 *
 * WHAT:  Everything the Reddit client needs from the environment.
 *
 * WHY:   CREDENTIAL_IS_FENCED. `REDDIT_CLIENT_SECRET` may be read only inside
 *        this folder, and eslint enforces it with a SYNTAX rule rather than an
 *        import restriction — the same mechanism as `ELEVENLABS_API_KEY`, and
 *        for the same reason: this adapter uses `fetch` and has no SDK to
 *        restrict.
 *
 *        USER_AGENT_IS_REQUIRED, and it is not a nicety. Reddit's API terms
 *        require a descriptive User-Agent naming the application and a contact
 *        or platform; requests with a generic or absent one are rate-limited
 *        far harder and may be blocked outright. It is built from the app's own
 *        branding and the client id, so it identifies this deployment rather
 *        than this codebase — which is what makes a block something an operator
 *        can get lifted.
 *
 *        LAZY_CONFIG, matching every other provider here: nothing throws at
 *        import. The Reddit format is optional until somebody uses it, and a
 *        module-scope throw would crash the setup checklist — the one screen
 *        whose job is to report which variables are missing.
 * WHERE: ./index.ts, on every request.
 */

import { APP_NAME } from "@/lib/config/branding";
import { assertRedditProviderActive } from "../provider";

assertRedditProviderActive("official");

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_API_BASE, REDDIT_TOKEN_URL
 *
 * Two hosts, and they are not interchangeable. The token is minted at
 * `www.reddit.com` and every authenticated read goes to `oauth.reddit.com`;
 * calling the first with a bearer token, or the second with basic auth,
 * fails in ways that read like a credential problem.
 */
export const REDDIT_API_BASE = "https://oauth.reddit.com";
export const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

export interface RedditConfig {
  clientId: string;
  clientSecret: string;
  userAgent: string;
}

export function isRedditConfigured(): boolean {
  return Boolean(
    process.env["REDDIT_CLIENT_ID"]?.trim() &&
      process.env["REDDIT_CLIENT_SECRET"]?.trim(),
  );
}

export function redditConfig(): RedditConfig {
  const clientId = process.env["REDDIT_CLIENT_ID"]?.trim();
  const clientSecret = process.env["REDDIT_CLIENT_SECRET"]?.trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      "[reddit/official] REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are not set. " +
        "Create a 'script' app at https://www.reddit.com/prefs/apps — Reddit story videos are unavailable until both are configured.",
    );
  }

  /* USER_AGENT_IS_REQUIRED — the shape Reddit's own guidance asks for:
   * platform:app-id:version (by /u/owner). The client id stands in for the
   * owner, because it identifies this deployment's app and is not a secret. */
  const configured = process.env["REDDIT_USER_AGENT"]?.trim();
  const userAgent =
    configured !== undefined && configured.length > 0
      ? configured
      : `web:${slug(APP_NAME)}:1.0 (by app ${clientId})`;

  return { clientId, clientSecret, userAgent };
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "app"
  );
}
