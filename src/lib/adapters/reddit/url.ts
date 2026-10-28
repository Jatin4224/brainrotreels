/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: parseRedditThreadUrl, REDDIT_HOSTS, isRedditHost,
 *   RedditUrlRefusal, HOST_IS_AN_ALLOWLIST, A_QUERY_PARAM_IS_NOT_A_HOST,
 *   SHARE_LINKS_ARE_REFUSED, POST_ID_IS_BASE36
 *
 * WHAT:  Decides whether a string is a Reddit thread URL, and which post it
 *        names.
 *
 * WHY:   HOST_IS_AN_ALLOWLIST, and the phase says why in one line: "a URL that
 *        merely contains 'reddit' in a query parameter is not a Reddit URL".
 *        The obvious implementations are all wrong in the same way —
 *        `url.includes('reddit.com')` matches
 *        `https://evil.example/?next=reddit.com`, and
 *        `hostname.endsWith('reddit.com')` matches `notreddit.com` and
 *        `reddit.com.evil.example`. So the HOSTNAME is compared against a
 *        fixed list of exact strings, and nothing else is consulted. Grep
 *        A_QUERY_PARAM_IS_NOT_A_HOST.
 *
 *        This is a separate check from the SSRF guard rather than a
 *        replacement for it. They answer different questions and both have to
 *        hold: this one says "is this the service we meant to call", and
 *        `assertFetchableUrl` says "is this address one our server may reach"
 *        (SSRF_GUARD in src/lib/script/url-guard.ts). A host allowlist alone
 *        is not an SSRF defence, because `www.reddit.com` could be made to
 *        resolve to a private address by a hostile resolver — and the guard
 *        alone is not enough either, because every public URL passes it.
 *
 *        POST_ID_IS_BASE36. A thread id is a short base-36 string, and it ends
 *        up in a request path — so it is validated against a character class
 *        rather than passed through. Without that, a crafted permalink could
 *        put a `../` or a query string into the API path we build.
 *
 *        SHARE_LINKS_ARE_REFUSED with a message that says what to do.
 *        Reddit's `/r/<sub>/s/<code>` share links carry no post id: resolving
 *        one means following a redirect, which is a second network call
 *        against a URL the customer supplied, and the id would then come from
 *        a `Location` header rather than from anything we validated. Telling
 *        somebody to paste the full link is a two-second fix; quietly
 *        following a redirect to find out what they meant is a new attack
 *        surface for a convenience.
 *
 *        PURE. No network, no SDK, no env — so every refusal above is unit
 *        tested with no credentials, which is the point of keeping the thing
 *        with security consequences out of the implementation folder (the same
 *        split as `keys.ts` for storage and `url-guard.ts` for ingest).
 * WHERE: ./official reads the post id from it; the scripts router validates a
 *        pasted URL with it before anything is fetched.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_HOSTS, HOST_IS_AN_ALLOWLIST
 *
 * WHAT:  Every hostname that is Reddit.
 * WHY:   Exact strings, compared with equality. Each entry is here because a
 *        real person pastes it: `old.` is the classic interface, `np.` is the
 *        "no participation" prefix link aggregators use, `m.` and `i.` come
 *        from phones, and `redd.it` is the short form. `oauth.reddit.com` is
 *        deliberately ABSENT — that is the API host we call, not a host a
 *        customer pastes, and accepting it would let somebody hand us a URL
 *        aimed at the authenticated API.
 * WHERE: isRedditHost.
 */
export const REDDIT_HOSTS: readonly string[] = [
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "new.reddit.com",
  "np.reddit.com",
  "m.reddit.com",
  "i.reddit.com",
  "redd.it",
  "www.redd.it",
];

/**
 * SOURCE OF TRUTH KEYWORDS: isRedditHost, A_QUERY_PARAM_IS_NOT_A_HOST
 *
 * WHAT:  True only when this hostname IS one of Reddit's.
 * WHY:   Equality against the list, lower-cased, with the trailing dot of a
 *        fully-qualified name removed — `www.reddit.com.` is the same host and
 *        a resolver accepts it. No `includes`, no `endsWith`: see the file
 *        header for what each of those lets through.
 * WHERE: parseRedditThreadUrl.
 */
export function isRedditHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return REDDIT_HOSTS.includes(host);
}

/**
 * SOURCE OF TRUTH KEYWORDS: RedditUrlRefusal, SHARE_LINKS_ARE_REFUSED
 *
 * WHAT:  Why a URL is not usable as a thread link.
 * WHY:   A closed union, like RedditFetchError and for the same reason: the
 *        COPY belongs with the UI, and three of these four refusals have a
 *        different action behind them (fix the scheme, paste a full link, pick
 *        a thread rather than a subreddit).
 * WHERE: The `refusal` field of a failed parse.
 */
export const REDDIT_URL_REFUSALS = [
  "unparseable",
  "wrong_scheme",
  "not_reddit",
  "share_link",
  "no_post_id",
] as const;

export type RedditUrlRefusal = (typeof REDDIT_URL_REFUSALS)[number];

export type RedditUrlParse =
  | {
      ok: true;
      postId: string;
      /** Present when the permalink carried it; the API returns it anyway. */
      subreddit: string | null;
      /** The normalised https URL, host and path only. */
      canonical: string;
    }
  | { ok: false; refusal: RedditUrlRefusal };

/* A base-36 thing id. Reddit's are 5–8 characters today; the bound is loose
 * enough to survive them growing and tight enough that nothing path-shaped
 * gets through (POST_ID_IS_BASE36). */
const POST_ID = /^[a-z0-9]{4,16}$/i;

/**
 * SOURCE OF TRUTH KEYWORDS: parseRedditThreadUrl, POST_ID_IS_BASE36
 *
 * WHAT:  The post id inside a Reddit thread URL, or why there is not one.
 *
 * WHY:   Four shapes are accepted because four shapes are what people paste:
 *
 *          /r/<sub>/comments/<id>/<slug>   the canonical permalink
 *          /comments/<id>                  the short in-site form
 *          /r/<sub>/comments/<id>          a permalink with the slug trimmed
 *          redd.it/<id>                    the share-shortener
 *
 *        Everything else is refused BY NAME rather than guessed at. A
 *        subreddit URL with no `/comments/` segment is the common mistake and
 *        it gets its own refusal, because "that is a subreddit, not a thread"
 *        is a sentence somebody can act on and "invalid URL" is not.
 *
 *        It returns a RESULT rather than throwing. The caller is a validator
 *        in a form and a step in a workflow, and both want to branch on the
 *        reason — an exception for an invalid URL would make the common case
 *        the exceptional one.
 * WHERE: See the file header.
 */
export function parseRedditThreadUrl(raw: string): RedditUrlParse {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, refusal: "unparseable" };
  }

  /* https only, matching the SSRF guard's own allowlist. A customer pasting
   * `http://` gets told, rather than silently upgraded — an upgrade is a guess
   * about what they meant. */
  if (url.protocol !== "https:") {
    return { ok: false, refusal: "wrong_scheme" };
  }

  if (!isRedditHost(url.hostname)) {
    return { ok: false, refusal: "not_reddit" };
  }

  const segments = url.pathname.split("/").filter((part) => part.length > 0);

  /* SHARE_LINKS_ARE_REFUSED — `/r/<sub>/s/<code>` carries no post id. */
  if (segments.length >= 3 && segments[0] === "r" && segments[2] === "s") {
    return { ok: false, refusal: "share_link" };
  }

  const commentsAt = segments.indexOf("comments");
  if (commentsAt >= 0) {
    const candidate = segments[commentsAt + 1];
    if (candidate === undefined || !POST_ID.test(candidate)) {
      return { ok: false, refusal: "no_post_id" };
    }
    const subreddit =
      segments[0] === "r" && segments[1] !== undefined ? segments[1] : null;
    return {
      ok: true,
      postId: candidate.toLowerCase(),
      subreddit,
      canonical: canonicalUrl(candidate, subreddit),
    };
  }

  /* The shortener: the whole path is the id. */
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "redd.it" || host === "www.redd.it") {
    const candidate = segments[0];
    if (candidate === undefined || !POST_ID.test(candidate)) {
      return { ok: false, refusal: "no_post_id" };
    }
    return {
      ok: true,
      postId: candidate.toLowerCase(),
      subreddit: null,
      canonical: canonicalUrl(candidate, null),
    };
  }

  return { ok: false, refusal: "no_post_id" };
}

/**
 * SOURCE OF TRUTH KEYWORDS: canonicalUrl, CANONICAL_DROPS_THE_QUERY
 *
 * WHAT:  The permalink we store and attribute.
 * WHY:   CANONICAL_DROPS_THE_QUERY. Built from the id rather than normalised
 *        from the input, so a pasted link's tracking parameters, its
 *        `?context=3`, its session junk and its `utm_` tail never reach the
 *        database or a Reddit card on screen. It also means the stored
 *        `sourceRef` is one string per thread, which is what makes "has this
 *        workspace already made a video from this thread" answerable.
 * WHERE: parseRedditThreadUrl's success result.
 */
function canonicalUrl(postId: string, subreddit: string | null): string {
  const id = postId.toLowerCase();
  return subreddit === null
    ? `https://www.reddit.com/comments/${id}`
    : `https://www.reddit.com/r/${subreddit}/comments/${id}`;
}
