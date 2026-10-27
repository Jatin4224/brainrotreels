/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: officialRedditAdapter, fetchThread, accessToken,
 *   TOKEN_IS_CACHED, FIVE_FAILURES_NOT_ONE, DELETED_IS_NOT_MISSING,
 *   RESPECT_THE_RATE_LIMIT, LISTING_SHAPE_IS_PARSED
 *
 * WHAT:  The Reddit implementation of RedditAdapter, against the official API
 *        with an OAuth application.
 *
 * WHY:   The documented, authenticated API and nothing else. Scraping the HTML
 *        or reading the unauthenticated `.json` endpoints is against Reddit's
 *        terms, breaks without notice, and has no rate limit anybody can
 *        reason about — see OFFICIAL_API_ONLY on the selector.
 *
 *        TOKEN_IS_CACHED. A client-credentials token lasts an hour, so minting
 *        one per thread would double every request and burn the token endpoint's
 *        own (much tighter) limit. It is cached in module scope with a safety
 *        margin, and a 401 clears it and retries ONCE — a token can be revoked
 *        before it expires, and the only way to find out is to be refused.
 *
 *        DELETED_IS_NOT_MISSING, and this is where FIVE_FAILURES_NOT_ONE is
 *        actually earned. Reddit does not answer 404 for a deleted post: it
 *        answers 200 with a listing whose author is `[deleted]` or whose
 *        selftext is `[removed]`, and a naive client makes a video out of the
 *        word "removed". The five cases are therefore read from THREE places —
 *        the status code, the API's own `reason` field, and the post's author
 *        and body sentinels — and each is mapped to its own union member.
 *
 *        RESPECT_THE_RATE_LIMIT. 429 is reported as `rate_limited`, which the
 *        caller treats as transient, and the `x-ratelimit-remaining` header is
 *        logged when it runs low so an operator sees the wall coming rather
 *        than discovering it in a customer's failed generation.
 *
 *        LISTING_SHAPE_IS_PARSED. Reddit's response is a deeply nested array of
 *        listings of "things", and it is parsed with a zod schema rather than
 *        indexed — `json[1].data.children[0].data.body` is four assumptions
 *        about somebody else's API in one expression, and when one of them
 *        changes the failure is a TypeError inside a workflow step rather than
 *        a readable refusal.
 * WHERE: Loaded by ../index.ts through a dynamic import.
 */

import "server-only";

import { z } from "zod";

import {
  REDDIT_BODY_MAX_CHARS,
  REDDIT_COMMENT_MAX_CHARS,
  REDDIT_TOP_COMMENTS,
  RedditError,
  type RedditAdapter,
  type RedditComment,
  type RedditThread,
} from "../types";
import { parseRedditThreadUrl } from "../url";
import {
  REDDIT_API_BASE,
  REDDIT_TOKEN_URL,
  redditConfig,
  type RedditConfig,
} from "./config";

/** A thread fetch is one request; the budget is a page load, not a job. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * SOURCE OF TRUTH KEYWORDS: DELETED_SENTINELS, DELETED_IS_NOT_MISSING
 *
 * The strings Reddit substitutes for content that is gone. They are the
 * CONTENT of a successful response, which is why a status-code check alone
 * cannot tell a deleted thread from a live one.
 */
const DELETED_AUTHOR = "[deleted]";
const DELETED_BODIES = new Set(["[deleted]", "[removed]"]);

/**
 * SOURCE OF TRUTH KEYWORDS: tokenResponseSchema, listingSchema,
 *   LISTING_SHAPE_IS_PARSED
 *
 * WHAT:  The two response shapes this adapter reads.
 * WHY:   Only the fields we use, each one `.optional()` where Reddit's own
 *        answer legitimately omits it — a link post has no `selftext`, a
 *        comment stub has no `body`. Unknown fields pass through rather than
 *        failing the parse (no `.strict()`), which is the opposite of the
 *        model-output schemas: there, an extra field means the model
 *        misunderstood; here it means Reddit shipped something, and refusing a
 *        thread because the API grew a field would be an outage we chose.
 */
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

const postDataSchema = z.object({
  title: z.string().optional(),
  selftext: z.string().optional(),
  author: z.string().optional(),
  subreddit: z.string().optional(),
  permalink: z.string().optional(),
  removed_by_category: z.string().nullish(),
  quarantine: z.boolean().optional(),
});

const commentDataSchema = z.object({
  author: z.string().optional(),
  body: z.string().optional(),
  score: z.number().optional(),
  stickied: z.boolean().optional(),
});

const listingSchema = z.array(
  z.object({
    data: z
      .object({
        children: z
          .array(
            z.object({
              kind: z.string().optional(),
              data: z.unknown().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  }),
);

/* The API's own refusal body, which carries a machine-readable reason for a
 * private or quarantined subreddit. Reddit answers 403 for both, so the
 * status alone cannot tell them apart. */
const refusalSchema = z.object({
  reason: z.string().optional(),
  message: z.string().optional(),
  error: z.number().optional(),
});

/**
 * SOURCE OF TRUTH KEYWORDS: cachedToken, TOKEN_IS_CACHED
 *
 * Module scope, because a worker serves many threads and a token lasts an
 * hour. Expiry is held 60 seconds EARLY, so a token is never used in the
 * window where it might expire mid-flight.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

const TOKEN_SAFETY_MARGIN_MS = 60_000;

async function accessToken(
  config: RedditConfig,
  options: { force?: boolean } = {},
): Promise<string> {
  if (
    options.force !== true &&
    cachedToken !== null &&
    cachedToken.expiresAt > Date.now()
  ) {
    return cachedToken.value;
  }

  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const basic = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString("base64");

  const response = await withTimeout((signal) =>
    fetch(REDDIT_TOKEN_URL, {
      method: "POST",
      signal,
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": config.userAgent,
      },
      body,
    }),
  );

  if (!response.ok) {
    /* A bad client id or secret, or an app Reddit has disabled. Not something
     * a retry fixes, and not something a customer caused — but it presents as
     * "unavailable" to them, and the detail is what an operator needs. */
    throw new RedditError(
      "unavailable",
      `token endpoint answered ${response.status} ${response.statusText}`,
    );
  }

  const parsed = tokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new RedditError(
      "unavailable",
      `token response did not parse: ${parsed.error.message}`,
    );
  }

  const ttlMs = (parsed.data.expires_in ?? 3600) * 1000;
  cachedToken = {
    value: parsed.data.access_token,
    expiresAt: Date.now() + Math.max(0, ttlMs - TOKEN_SAFETY_MARGIN_MS),
  };

  return cachedToken.value;
}

export const officialRedditAdapter: RedditAdapter = {
  id: "official",

  async fetchThread(url: string): Promise<RedditThread> {
    /* The URL is parsed by the PURE module, so the host allowlist and the id
     * validation are the same ones the form used — and neither depends on this
     * adapter being configured. */
    const parsed = parseRedditThreadUrl(url);
    if (!parsed.ok) {
      /* The caller has already shown a specific refusal for every one of these
       * before spending a request; reaching here means a stored URL that was
       * valid when it was saved. `not_found` is the honest mapping. */
      throw new RedditError(
        "not_found",
        `url refused by the parser: ${parsed.refusal}`,
      );
    }

    const config = redditConfig();
    const path = `/comments/${parsed.postId}?limit=${REDDIT_TOP_COMMENTS}&depth=1&sort=top&raw_json=1`;

    let response = await authorizedGet(config, path, false);
    if (response.status === 401) {
      /* A token revoked before its expiry. One forced refresh, then believe
       * the answer — a loop here would hammer the token endpoint. */
      response = await authorizedGet(config, path, true);
    }

    reportRateLimit(response);

    if (!response.ok) {
      throw await errorForStatus(response);
    }

    const json: unknown = await response.json();
    const listing = listingSchema.safeParse(json);
    if (!listing.success || listing.data.length === 0) {
      throw new RedditError(
        "unavailable",
        `listing did not parse: ${listing.success ? "empty array" : listing.error.message}`,
      );
    }

    const postChild = listing.data[0]?.data?.children?.[0];
    const post = postDataSchema.safeParse(postChild?.data);
    if (!post.success || post.data.title === undefined) {
      /* A valid id that names nothing — the usual cause is a mistyped link. */
      throw new RedditError("not_found", "listing carried no post");
    }

    if (post.data.quarantine === true) {
      throw new RedditError("quarantined", "post.quarantine is true");
    }

    /* DELETED_IS_NOT_MISSING. Both of these arrive as a 200. */
    if (post.data.author === DELETED_AUTHOR) {
      throw new RedditError("deleted", "author is [deleted]");
    }
    if (
      typeof post.data.removed_by_category === "string" &&
      post.data.removed_by_category.length > 0
    ) {
      throw new RedditError(
        "removed",
        `removed_by_category=${post.data.removed_by_category}`,
      );
    }
    if (
      post.data.selftext !== undefined &&
      DELETED_BODIES.has(post.data.selftext.trim())
    ) {
      throw new RedditError("removed", "selftext is a removal sentinel");
    }

    const comments = readComments(listing.data[1]);

    return {
      title: post.data.title.trim(),
      subreddit: (post.data.subreddit ?? parsed.subreddit ?? "").trim(),
      /* Empty is normal for a link or image post — not a failure. */
      body: (post.data.selftext ?? "").trim().slice(0, REDDIT_BODY_MAX_CHARS),
      author: (post.data.author ?? "").trim(),
      comments,
      /* OUR canonical form, not the API's: see CANONICAL_DROPS_THE_QUERY. */
      permalink: parsed.canonical,
    };
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: readComments, SKIP_THE_SENTINELS,
 *   SKIP_THE_MODERATOR_STICKY
 *
 * WHAT:  The usable top-level comments, best first.
 * WHY:   Three kinds of row are dropped, each for a reason a viewer would
 *        recognise:
 *          - `more` stubs, which are a pagination marker and not a comment;
 *          - deleted and removed bodies, which would otherwise be narrated as
 *            the literal word "[removed]";
 *          - the STICKIED comment, which on almost every thread is a
 *            moderator's rules post and is never part of the story.
 *        Sorted by score because the API's `sort=top` orders the tree but we
 *        have filtered it, and a video should lead with the best reply.
 * WHERE: fetchThread.
 */
function readComments(section: unknown): RedditComment[] {
  const parsedSection = z
    .object({
      data: z
        .object({
          children: z
            .array(
              z.object({ kind: z.string().optional(), data: z.unknown().optional() }),
            )
            .optional(),
        })
        .optional(),
    })
    .safeParse(section);

  const children = parsedSection.success
    ? (parsedSection.data.data?.children ?? [])
    : [];

  const comments: RedditComment[] = [];

  for (const child of children) {
    if (child.kind === "more") continue;

    const parsed = commentDataSchema.safeParse(child.data);
    if (!parsed.success) continue;

    const body = (parsed.data.body ?? "").trim();
    if (body.length === 0 || DELETED_BODIES.has(body)) continue;
    if (parsed.data.stickied === true) continue;

    comments.push({
      author: (parsed.data.author ?? "").trim(),
      body: body.slice(0, REDDIT_COMMENT_MAX_CHARS),
      score: parsed.data.score ?? 0,
    });
  }

  return comments
    .sort((a, b) => b.score - a.score)
    .slice(0, REDDIT_TOP_COMMENTS);
}

async function authorizedGet(
  config: RedditConfig,
  path: string,
  force: boolean,
): Promise<Response> {
  const token = await accessToken(config, force ? { force: true } : {});

  return withTimeout((signal) =>
    fetch(`${REDDIT_API_BASE}${path}`, {
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": config.userAgent,
        accept: "application/json",
      },
    }),
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: errorForStatus, FIVE_FAILURES_NOT_ONE
 *
 * WHAT:  The status code and refusal body as one of the union's members.
 * WHY:   403 is the interesting one: Reddit answers it for a private
 *        subreddit AND for a quarantined one, and the difference is only in
 *        the body's `reason`. Both are refusals a customer can understand and
 *        they lead to different actions, so reading the body is worth the
 *        parse.
 * WHERE: fetchThread, on any non-ok response.
 */
async function errorForStatus(response: Response): Promise<RedditError> {
  const detail = `${response.status} ${response.statusText}`;

  if (response.status === 429) {
    return new RedditError("rate_limited", detail);
  }
  if (response.status === 404) {
    return new RedditError("not_found", detail);
  }

  if (response.status === 403 || response.status === 451) {
    const body = await response
      .json()
      .then((value: unknown) => refusalSchema.safeParse(value))
      .catch(() => null);

    const reason = body?.success === true ? (body.data.reason ?? "") : "";
    if (reason.includes("quarantin")) {
      return new RedditError("quarantined", `${detail} reason=${reason}`);
    }
    if (reason.includes("banned") || reason.includes("gated")) {
      return new RedditError("removed", `${detail} reason=${reason}`);
    }
    /* `private` is the default reading of a 403 on a listing: the subreddit
     * exists and we are not allowed in. */
    return new RedditError("private", `${detail} reason=${reason || "none"}`);
  }

  return new RedditError("unavailable", detail);
}

/**
 * SOURCE OF TRUTH KEYWORDS: reportRateLimit, RESPECT_THE_RATE_LIMIT
 *
 * Logs when the remaining budget runs low. A 429 is the symptom; this is the
 * warning, and it is the difference between an operator seeing the wall coming
 * and finding out from a customer's failed generation.
 */
const RATE_LIMIT_WARN_AT = 20;

function reportRateLimit(response: Response): void {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  if (!Number.isFinite(remaining) || remaining > RATE_LIMIT_WARN_AT) return;

  console.warn(
    `[reddit/official] rate limit is low: ${remaining} requests remaining, resets in ${response.headers.get("x-ratelimit-reset") ?? "?"}s.`,
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: withTimeout, NO_UNBOUNDED_PROVIDER_CALL
 *
 * Every call here is bounded. An adapter without a timeout is a workflow step
 * held open by somebody else's outage, and Inngest's own timeout is a far
 * blunter instrument than a refusal we can explain.
 */
async function withTimeout(
  run: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new RedditError(
        "rate_limited",
        `request timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );
    }
    throw new RedditError(
      "unavailable",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}
