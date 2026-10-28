/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: RedditAdapter, RedditThread, RedditComment,
 *   RedditFetchError, REDDIT_FETCH_ERRORS, RedditError, REDDIT_PROVIDER_IDS,
 *   RedditProviderId, FIVE_FAILURES_NOT_ONE, AUTHOR_IS_DISPLAY_ONLY,
 *   THREAD_TEXT_IS_UNTRUSTED
 *
 * WHAT:  The contract for turning a Reddit thread URL into the title, body and
 *        top comments a video is made from.
 *
 * WHY:   FIVE_FAILURES_NOT_ONE, and this is the decision the whole seam is
 *        shaped around. A thread can be unavailable for five distinct reasons
 *        and FOUR of them are things the customer can act on: a deleted post
 *        means pick another thread, a removed one means the same, a private
 *        subreddit means they cannot use it at all, a quarantined one means we
 *        will not, and a 404 usually means a mistyped link. Collapsing those
 *        into "could not fetch thread" turns four actionable situations into
 *        one dead end — so the error is a closed UNION and the message is
 *        chosen per case, by the caller, from the code.
 *
 *        `rate_limited` is the fifth and is the only one that is OURS rather
 *        than the thread's: it means we have asked Reddit for too much, which
 *        the customer did not cause and cannot fix. It is kept in the same
 *        union because every caller has to handle it, and a separate exception
 *        type would be the one case somebody forgets.
 *
 *        THREAD_TEXT_IS_UNTRUSTED. Every string that comes back here is
 *        attacker-controlled: anyone can post a comment reading "ignore
 *        previous instructions". The adapter does NOT sanitise it, because
 *        sanitising prose is a losing game and a half-sanitised string invites
 *        a caller to trust it. It is fenced at the prompt instead
 *        (wrapUntrusted in src/lib/script/prompt.ts), and the schema is the
 *        boundary that actually holds (SCHEMA_IS_THE_CONTRACT). Grep
 *        THREAD_TEXT_IS_UNTRUSTED before writing anything that reads these
 *        fields.
 *
 *        AUTHOR_IS_DISPLAY_ONLY. `author` is carried so a card can say who
 *        posted it, and it is NEVER synthesised as a voice — the phase says so
 *        in the contract itself. A real person's username read aloud by a
 *        cloned-sounding voice is a likeness problem we have no need to create;
 *        the narration says "the original poster", and the speaker TAGS are
 *        roles rather than usernames.
 *
 *        ONE METHOD, like every other seam here. A thread is one
 *        request-shaped question with a known answer shape; a richer interface
 *        (search, subreddit listings, user history) would be surface nothing
 *        uses and a far larger terms-of-service footprint.
 * WHERE: Implemented by ./official. Reached through getRedditAdapter() in
 *        ./index. Consumed by src/lib/script/ingest.ts.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: RedditComment, AUTHOR_IS_DISPLAY_ONLY
 *
 * WHAT:  One top-level comment.
 * WHY:   `score` is carried because it is the only ordering signal that means
 *        anything to a viewer — a thread's value is in its top replies, and
 *        the condensation is allowed to drop the rest. Replies to replies are
 *        deliberately NOT modelled: a nested tree read aloud is incoherent,
 *        and flattening it would attribute a reply's words to the wrong
 *        speaker.
 * WHERE: RedditThread.comments.
 */
export interface RedditComment {
  /** Display only — never synthesised, never a speaker tag. */
  author: string;
  body: string;
  score: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: RedditThread, THREAD_TEXT_IS_UNTRUSTED
 *
 * WHAT:  A thread as this product uses it.
 * WHY:   Exactly the fields a video needs and nothing more. No ids, no
 *        timestamps, no awards, no flair: every extra field is one more piece
 *        of somebody else's content we would be storing, and the retention
 *        window exists precisely because storing it at all has a clock on it
 *        (see REDDIT_RETENTION_DAYS in src/lib/types/reddit.ts).
 *
 *        `body` may be EMPTY and that is normal rather than a failure — a link
 *        post or an image post has a title and comments and no self-text, and
 *        those make perfectly good videos.
 * WHERE: Returned by RedditAdapter.fetchThread.
 */
export interface RedditThread {
  title: string;
  subreddit: string;
  /** Empty for a link or image post. Not an error. */
  body: string;
  /** Display only. See AUTHOR_IS_DISPLAY_ONLY. */
  author: string;
  comments: RedditComment[];
  /** The canonical permalink, for attribution and for the project's source. */
  permalink: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_FETCH_ERRORS, RedditFetchError,
 *   FIVE_FAILURES_NOT_ONE
 *
 * WHAT:  Why a thread could not be used.
 * WHY:   See FIVE_FAILURES_NOT_ONE in the file header. A closed union rather
 *        than a message, so the CALLER chooses the copy — the wording belongs
 *        with the UI that shows it, and an adapter inventing customer-facing
 *        sentences is how two surfaces end up explaining the same failure
 *        differently.
 *
 *        `unavailable` is the sixth and is the honest catch-all: Reddit
 *        answered with something this build does not recognise. It is
 *        deliberately NOT one of the five the phase enumerates, so a count of
 *        `unavailable` in the logs is a prompt to add a case rather than noise
 *        inside a case that already existed.
 * WHERE: RedditError.reason; mapped to copy by REDDIT_ERROR_COPY in
 *        src/lib/types/reddit.ts.
 */
export const REDDIT_FETCH_ERRORS = [
  "deleted",
  "removed",
  "private",
  "quarantined",
  "not_found",
  "rate_limited",
  "unavailable",
] as const;

export type RedditFetchError = (typeof REDDIT_FETCH_ERRORS)[number];

/**
 * SOURCE OF TRUTH KEYWORDS: RedditError, PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  A thread that could not be fetched, carrying which of the cases it
 *        was.
 * WHY:   PERMANENT_VS_TRANSIENT_FAILURE, the same distinction every other
 *        adapter here draws, and here it is DERIVED from the reason rather than
 *        passed separately: a deleted post does not come back on a retry and a
 *        rate limit does. Deriving it means a new reason cannot be added
 *        without deciding which kind it is.
 *
 *        `detail` is for the operator and is never rendered: it carries the
 *        status code and the URL, which is a probe if shown to whoever supplied
 *        the URL. The same split as UrlGuardError.
 * WHERE: Thrown by the adapter; caught in src/lib/script/ingest.ts.
 */
export class RedditError extends Error {
  readonly reason: RedditFetchError;
  readonly detail: string;

  constructor(reason: RedditFetchError, detail = "") {
    super(`[reddit] ${reason}${detail.length > 0 ? `: ${detail}` : ""}`);
    this.name = "RedditError";
    this.reason = reason;
    this.detail = detail;
  }

  /** Only a rate limit and an unrecognised answer can improve by waiting. */
  get transient(): boolean {
    return this.reason === "rate_limited" || this.reason === "unavailable";
  }
}

export interface RedditAdapter {
  readonly id: RedditProviderId;

  /**
   * Throws `RedditError` for every documented failure. Never returns a partial
   * thread: a thread with no title is not something to make a video from, and
   * returning one would push the refusal into whichever caller forgot to check.
   */
  fetchThread(url: string): Promise<RedditThread>;
}

export const REDDIT_PROVIDER_IDS = ["official"] as const;

export type RedditProviderId = (typeof REDDIT_PROVIDER_IDS)[number];

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_TOP_COMMENTS, REDDIT_COMMENT_MAX_CHARS,
 *   REDDIT_BODY_MAX_CHARS, BOUND_WHAT_WE_STORE
 *
 * WHAT:  How much of a thread is ever read.
 * WHY:   BOUND_WHAT_WE_STORE, for three independent reasons: an unbounded
 *        thread is an unbounded model BILL per generation (the same argument as
 *        SOURCE_TEXT_MAX_CHARS), a thread with four thousand comments dilutes
 *        the few that matter, and every character kept is somebody else's
 *        content sitting in our database under a retention clock.
 *
 *        Twelve comments is a judgement: enough that a multi-voice thread has
 *        several participants, few enough that the condensation is choosing
 *        between good options rather than wading. The per-comment cap is
 *        generous because a single long top comment IS often the whole story.
 * WHERE: The adapter's request parameters and its mapping.
 */
export const REDDIT_TOP_COMMENTS = 12;
export const REDDIT_COMMENT_MAX_CHARS = 4_000;
export const REDDIT_BODY_MAX_CHARS = 12_000;
